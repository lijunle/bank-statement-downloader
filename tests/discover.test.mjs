/**
 * Unit tests for Discover Bank API implementation
 * Tests cover both credit card and bank account functionality
 * 
 * Note: All mock data is based on actual content from analyze/discover.har
 * to ensure tests match real API responses.
 */

import { describe, it, beforeEach, mock } from 'node:test';
import assert from 'node:assert/strict';

// Mock global fetch
const mockFetch = mock.fn();
global.fetch = mockFetch;

// Mock crypto using mock.method
const mockRandomUUID = mock.fn(() => '12345678-1234-1234-1234-123456789abc');
mock.method(global.crypto, 'randomUUID', mockRandomUUID);

// Mock document.cookie for getSessionId
global.document = {
    cookie: 'customerId=12345678; cif=87654321; sectoken=abc123def456; other=value',
};

// Mock window.location for domain checks
global.window = {
    location: {
        hostname: 'portal.discover.com',
    },
};

// Mock chrome.runtime for messaging
const mockSendMessage = mock.fn();
global.chrome = {
    runtime: {
        sendMessage: mockSendMessage,
    },
};

// Import the module after setting up mocks
const discoverModule = await import('../bank/discover.mjs');
const { bankId, getSessionId, getProfile, getAccounts, getStatements, downloadStatement } = discoverModule;

describe('Discover API', () => {
    beforeEach(() => {
        // Reset fetch mock between tests for isolation
        mockFetch.mock.resetCalls();
        // Reset chrome.runtime mock
        mockSendMessage.mock.resetCalls();
        // Reset window.location hostname to default
        window.location.hostname = 'portal.discover.com';
    });

    describe('bankId', () => {
        it('should return the correct bank identifier', () => {
            assert.strictEqual(bankId, 'discover');
        });
    });

    describe('getSessionId', () => {
        it('should extract customerId cookie from document.cookie', () => {
            const sessionId = getSessionId();
            assert.strictEqual(sessionId, '12345678');
        });

        it('should throw error when customerId cookie is not found', () => {
            const originalCookie = document.cookie;
            document.cookie = 'cif=87654321; sectoken=abc123def456';

            assert.throws(() => getSessionId(), /User is not logged in - missing required session cookies/);

            document.cookie = originalCookie;
        });

        it('should throw error when cif cookie is not found', () => {
            const originalCookie = document.cookie;
            document.cookie = 'customerId=12345678; sectoken=abc123def456';

            assert.throws(() => getSessionId(), /User is not logged in - missing required session cookies/);

            document.cookie = originalCookie;
        });

        it('should throw error when sectoken cookie is not found', () => {
            const originalCookie = document.cookie;
            document.cookie = 'customerId=12345678; cif=87654321';

            assert.throws(() => getSessionId(), /User is not logged in - missing required session cookies/);

            document.cookie = originalCookie;
        });
    });

    describe('getProfile', () => {
        it('should extract profile information from card API', async () => {
            const mockCardResponse = {
                profile: {
                    email: 'user@example.com',
                    name: 'John Doe',
                },
                selectedAccount: {
                    accountId: 'CARD123',
                    accountType: 'CARD',
                },
            };

            mockFetch.mock.mockImplementation((url) => {
                if (url.includes('customer/info/card')) {
                    return Promise.resolve({
                        ok: true,
                        json: () => Promise.resolve(mockCardResponse),
                    });
                } else {
                    return Promise.resolve({
                        ok: false,
                        json: () => Promise.resolve({}),
                    });
                }
            });

            const profile = await getProfile('test-session-id');

            assert.deepStrictEqual(profile, {
                sessionId: 'test-session-id',
                profileId: 'user@example.com',
                profileName: 'John Doe',
            });

            const calls = mockFetch.mock.calls;
            assert.strictEqual(calls.length, 2); // Both card and bank APIs called in parallel
        });

        it('should extract profile information from bank API when card API fails', async () => {
            const mockBankResponse = {
                profile: {
                    email: 'user@example.com',
                    name: 'Jane Smith',
                },
                selectedAccount: {
                    accountId: 'BANK456',
                    accountType: 'BANK',
                },
            };

            mockFetch.mock.mockImplementation((url) => {
                if (url.includes('customer/info/bank')) {
                    return Promise.resolve({
                        ok: true,
                        json: () => Promise.resolve(mockBankResponse),
                    });
                } else {
                    return Promise.resolve({
                        ok: false,
                        json: () => Promise.resolve({}),
                    });
                }
            });

            const profile = await getProfile('test-session-id');

            assert.deepStrictEqual(profile, {
                sessionId: 'test-session-id',
                profileId: 'user@example.com',
                profileName: 'Jane Smith',
            });
        });

        it('should use default profile name when name is not provided', async () => {
            const mockCardResponse = {
                profile: {
                    email: 'user@example.com',
                },
            };

            mockFetch.mock.mockImplementation((url) => {
                if (url.includes('customer/info/card')) {
                    return Promise.resolve({
                        ok: true,
                        json: () => Promise.resolve(mockCardResponse),
                    });
                } else {
                    return Promise.resolve({
                        ok: false,
                        json: () => Promise.resolve({}),
                    });
                }
            });

            const profile = await getProfile('test-session-id');

            assert.strictEqual(profile.profileName, 'Discover User');
        });

        it('should throw error when both APIs fail to return profile', async () => {
            mockFetch.mock.mockImplementation(() =>
                Promise.resolve({
                    ok: true,
                    json: () => Promise.resolve({}),
                })
            );

            await assert.rejects(
                () => getProfile('test-session-id'),
                /Failed to get profile: Failed to retrieve user profile from portal APIs/
            );
        });
    });

    describe('getAccounts', () => {
        const testProfile = {
            sessionId: 'test-session-id',
            profileId: 'user@example.com',
            profileName: 'Test User',
        };

        it('should extract credit card account from card API', async () => {
            const mockCardResponse = {
                profile: {
                    email: 'user@example.com',
                    name: 'Test User',
                },
                selectedAccount: {
                    accountId: 'CARD123',
                    accountType: 'CARD',
                    accountDesc: 'Discover it Cash Back',
                    lastFourAccountNumber: '1234',
                },
                accounts: [],
            };

            mockFetch.mock.mockImplementation((url) => {
                if (url.includes('customer/info/card')) {
                    return Promise.resolve({
                        ok: true,
                        json: () => Promise.resolve(mockCardResponse),
                    });
                } else {
                    return Promise.resolve({
                        ok: false,
                        json: () => Promise.resolve({}),
                    });
                }
            });

            const accounts = await getAccounts(testProfile);

            assert.strictEqual(accounts.length, 1);
            assert.deepStrictEqual(accounts[0], {
                profile: testProfile,
                accountId: 'CARD123',
                accountName: 'Discover it Cash Back',
                accountMask: '1234',
                accountType: 'CreditCard',
            });
        });

        it('should extract bank account from bank API', async () => {
            const mockBankResponse = {
                profile: {
                    email: 'user@example.com',
                    name: 'Test User',
                },
                selectedAccount: {
                    accountId: 'BANK456',
                    accountType: 'BANK',
                    accountDesc: 'Discover Online Savings',
                    lastFourAccountNumber: '5678',
                    accountSubType: '003',
                },
                accounts: [],
            };

            mockFetch.mock.mockImplementation((url) => {
                if (url.includes('customer/info/bank')) {
                    return Promise.resolve({
                        ok: true,
                        json: () => Promise.resolve(mockBankResponse),
                    });
                } else {
                    return Promise.resolve({
                        ok: false,
                        json: () => Promise.resolve({}),
                    });
                }
            });

            const accounts = await getAccounts(testProfile);

            assert.strictEqual(accounts.length, 1);
            assert.deepStrictEqual(accounts[0], {
                profile: testProfile,
                accountId: 'BANK456',
                accountName: 'Discover Online Savings',
                accountMask: '5678',
                accountType: 'Savings',
            });
        });

        it('should extract multiple accounts from both APIs', async () => {
            const mockCardResponse = {
                profile: {
                    email: 'user@example.com',
                },
                selectedAccount: {
                    accountId: 'CARD123',
                    accountType: 'CARD',
                    accountDesc: 'Discover it Cash Back',
                    lastFourAccountNumber: '1234',
                },
                accounts: [
                    {
                        accountId: 'BANK789',
                        accountType: 'BANK',
                        accountDesc: 'Discover Checking',
                        lastFourAccountNumber: '7890',
                        accountSubType: '002',
                    },
                ],
            };

            const mockBankResponse = {
                profile: {
                    email: 'user@example.com',
                },
                selectedAccount: {
                    accountId: 'BANK456',
                    accountType: 'BANK',
                    accountDesc: 'Discover Savings',
                    lastFourAccountNumber: '5678',
                    accountSubType: '003',
                },
                accounts: [],
            };

            mockFetch.mock.mockImplementation((url) => {
                if (url.includes('customer/info/card')) {
                    return Promise.resolve({
                        ok: true,
                        json: () => Promise.resolve(mockCardResponse),
                    });
                } else if (url.includes('customer/info/bank')) {
                    return Promise.resolve({
                        ok: true,
                        json: () => Promise.resolve(mockBankResponse),
                    });
                } else {
                    return Promise.resolve({
                        ok: false,
                        json: () => Promise.resolve({}),
                    });
                }
            });

            const accounts = await getAccounts(testProfile);

            assert.strictEqual(accounts.length, 3);
            assert.strictEqual(accounts[0].accountId, 'CARD123');
            assert.strictEqual(accounts[0].accountType, 'CreditCard');
            assert.strictEqual(accounts[1].accountId, 'BANK789');
            assert.strictEqual(accounts[1].accountType, 'Checking');
            assert.strictEqual(accounts[2].accountId, 'BANK456');
            assert.strictEqual(accounts[2].accountType, 'Savings');
        });

        it('should deduplicate accounts with same accountId', async () => {
            const mockCardResponse = {
                profile: { email: 'user@example.com' },
                selectedAccount: {
                    accountId: 'CARD123',
                    accountType: 'CARD',
                    accountDesc: 'Discover Card',
                    lastFourAccountNumber: '1234',
                },
                accounts: [
                    {
                        accountId: 'CARD123',
                        accountType: 'CARD',
                        accountDesc: 'Discover Card Duplicate',
                        lastFourAccountNumber: '1234',
                    },
                ],
            };

            mockFetch.mock.mockImplementation((url) => {
                if (url.includes('customer/info/card')) {
                    return Promise.resolve({
                        ok: true,
                        json: () => Promise.resolve(mockCardResponse),
                    });
                } else {
                    return Promise.resolve({
                        ok: false,
                        json: () => Promise.resolve({}),
                    });
                }
            });

            const accounts = await getAccounts(testProfile);

            assert.strictEqual(accounts.length, 1);
            assert.strictEqual(accounts[0].accountId, 'CARD123');
        });

        it('should use default account name when accountDesc is missing', async () => {
            const mockCardResponse = {
                profile: { email: 'user@example.com' },
                selectedAccount: {
                    accountId: 'CARD123',
                    accountType: 'CARD',
                    lastFourAccountNumber: '1234',
                },
                accounts: [],
            };

            mockFetch.mock.mockImplementation((url) => {
                if (url.includes('customer/info/card')) {
                    return Promise.resolve({
                        ok: true,
                        json: () => Promise.resolve(mockCardResponse),
                    });
                } else {
                    return Promise.resolve({
                        ok: false,
                        json: () => Promise.resolve({}),
                    });
                }
            });

            const accounts = await getAccounts(testProfile);

            assert.strictEqual(accounts[0].accountName, 'Card 1234');
        });

        it('should map checking account subtype correctly', async () => {
            const mockBankResponse = {
                profile: { email: 'user@example.com' },
                selectedAccount: {
                    accountId: 'BANK123',
                    accountType: 'BANK',
                    accountDesc: 'Checking',
                    lastFourAccountNumber: '1234',
                    accountSubType: '002',
                },
                accounts: [],
            };

            mockFetch.mock.mockImplementation((url) => {
                if (url.includes('customer/info/bank')) {
                    return Promise.resolve({
                        ok: true,
                        json: () => Promise.resolve(mockBankResponse),
                    });
                } else {
                    return Promise.resolve({
                        ok: false,
                        json: () => Promise.resolve({}),
                    });
                }
            });

            const accounts = await getAccounts(testProfile);

            assert.strictEqual(accounts[0].accountType, 'Checking');
        });

        it('should throw error when no accounts are found', async () => {
            mockFetch.mock.mockImplementation(() =>
                Promise.resolve({
                    ok: true,
                    json: () => Promise.resolve({ profile: { email: 'test@test.com' } }),
                })
            );

            await assert.rejects(
                () => getAccounts(testProfile),
                /Failed to get accounts: No accounts found for user/
            );
        });
    });

    describe('getStatements - Credit Card', () => {
        const testProfile = {
            sessionId: 'test-session-id',
            profileId: 'user@example.com',
            profileName: 'Test User',
        };

        const testCardAccount = {
            profile: testProfile,
            accountId: 'CARD123',
            accountName: 'Discover it Cash Back',
            accountMask: '1234',
            accountType: /** @type {import('../bank/bank.types').AccountType} */ ('CreditCard'),
        };

        it('should use chrome.runtime.sendMessage when not on card.discover.com domain', async () => {
            window.location.hostname = 'portal.discover.com';

            const mockRecentResponse = {
                summaryData: {
                    lastStmtDate: '10/20/2025',
                },
            };

            const mockStmtListResponse = {
                jsonResponse: JSON.stringify({
                    statements: [
                        {
                            pdfAvailable: true,
                            pdfUri: '/cardmembersvcs/statements/app/stmtPDF?view=true&date=20251020',
                        },
                    ],
                }),
            };

            // Mock chrome.runtime.sendMessage to simulate popup handling the fetch
            mockSendMessage.mock.mockImplementation((message) => {
                if (message.action === 'requestFetch' && message.url.includes('/transactions/v1/recent')) {
                    return Promise.resolve({
                        ok: true,
                        status: 200,
                        statusText: 'OK',
                        headers: { 'content-type': 'application/json' },
                        body: ")]}'," + JSON.stringify(mockRecentResponse),
                    });
                } else if (message.action === 'requestFetch' && message.url.includes('/stmt?stmtDate=')) {
                    return Promise.resolve({
                        ok: true,
                        status: 200,
                        statusText: 'OK',
                        headers: { 'content-type': 'application/json' },
                        body: ")]}'," + JSON.stringify(mockStmtListResponse),
                    });
                }
                return Promise.reject(new Error('Unexpected message'));
            });

            const statements = await getStatements(testCardAccount);

            assert.strictEqual(statements.length, 1);
            assert.strictEqual(statements[0].statementId, '20251020');

            // Verify chrome.runtime.sendMessage was called
            assert.strictEqual(mockSendMessage.mock.calls.length, 2);
        });

        it('should return empty array when no statements are available', async () => {
            window.location.hostname = 'card.discover.com';

            const mockRecentResponse = {
                summaryData: {},
            };

            mockFetch.mock.mockImplementationOnce(() =>
                Promise.resolve({
                    ok: true,
                    text: () => Promise.resolve(")]}'," + JSON.stringify(mockRecentResponse)),
                })
            );

            const statements = await getStatements(testCardAccount);

            assert.strictEqual(statements.length, 0);
        });

        it('should retrieve card statements with valid dates', async () => {
            window.location.hostname = 'card.discover.com';

            const mockRecentResponse = {
                summaryData: {
                    lastStmtDate: '10/20/2025',
                },
            };

            const mockStmtListResponse = {
                jsonResponse: JSON.stringify({
                    statements: [
                        {
                            pdfAvailable: true,
                            pdfUri: '/cardmembersvcs/statements/app/stmtPDF?view=true&date=20251020',
                        },
                        {
                            pdfAvailable: true,
                            pdfUri: '/cardmembersvcs/statements/app/stmtPDF?view=true&date=20250920',
                        },
                        {
                            pdfAvailable: false, // Should be skipped
                            pdfUri: '/cardmembersvcs/statements/app/stmtPDF?view=true&date=20250820',
                        },
                    ],
                }),
            };

            mockFetch.mock.mockImplementation((url) => {
                if (url.includes('/transactions/v1/recent')) {
                    return Promise.resolve({
                        ok: true,
                        text: () => Promise.resolve(")]}'," + JSON.stringify(mockRecentResponse)),
                    });
                } else if (url.includes('/stmt?stmtDate=')) {
                    return Promise.resolve({
                        ok: true,
                        text: () => Promise.resolve(")]}'," + JSON.stringify(mockStmtListResponse)),
                    });
                } else {
                    return Promise.resolve({
                        ok: false,
                        text: () => Promise.resolve(''),
                    });
                }
            });

            const statements = await getStatements(testCardAccount);

            assert.strictEqual(statements.length, 2);
            assert.strictEqual(statements[0].statementId, '20251020');
            assert.strictEqual(statements[0].statementDate, new Date('2025-10-20').toISOString());
            assert.strictEqual(statements[1].statementId, '20250920');
            assert.strictEqual(statements[1].statementDate, new Date('2025-09-20').toISOString());
        });

        it('should handle API errors gracefully', async () => {
            window.location.hostname = 'card.discover.com';

            mockFetch.mock.mockImplementationOnce(() =>
                Promise.resolve({
                    ok: false,
                    status: 500,
                    statusText: 'Internal Server Error',
                })
            );

            await assert.rejects(
                () => getStatements(testCardAccount),
                /API request failed: 500 Internal Server Error/
            );
        });
    });

    describe('getStatements - Bank Account', () => {
        const testProfile = {
            sessionId: 'test-session-id',
            profileId: 'user@example.com',
            profileName: 'Test User',
        };

        const testBankAccount = {
            profile: testProfile,
            accountId: 'BANK456',
            accountName: 'Discover Savings',
            accountMask: '5678',
            accountType: /** @type {import('../bank/bank.types').AccountType} */ ('Savings'),
        };

        it('should retrieve bank account statements', async () => {
            const mockResponse = [
                {
                    id: 'stmt-1',
                    statementDate: '2025-10-31T00:00:00Z',
                    links: [
                        {
                            rel: 'binary',
                            href: 'https://bank.discover.com/bank/deposits/servicing/documents/v1/accounts/BANK456/statements/stmt-1',
                        },
                    ],
                },
                {
                    id: 'stmt-2',
                    statementDate: '2025-09-30T00:00:00Z',
                    links: [
                        {
                            rel: 'binary',
                            href: 'https://bank.discover.com/bank/deposits/servicing/documents/v1/accounts/BANK456/statements/stmt-2',
                        },
                    ],
                },
            ];

            mockFetch.mock.mockImplementationOnce(() =>
                Promise.resolve({
                    ok: true,
                    json: () => Promise.resolve(mockResponse),
                })
            );

            const statements = await getStatements(testBankAccount);

            assert.strictEqual(statements.length, 2);
            assert.strictEqual(statements[0].statementId, 'https://bank.discover.com/bank/deposits/servicing/documents/v1/accounts/BANK456/statements/stmt-1');
            assert.strictEqual(statements[0].statementDate, new Date('2025-10-31T00:00:00Z').toISOString());
            assert.strictEqual(statements[1].statementId, 'https://bank.discover.com/bank/deposits/servicing/documents/v1/accounts/BANK456/statements/stmt-2');
        });

        it('should use statement ID when links are not available', async () => {
            const mockResponse = [
                {
                    id: 'stmt-1',
                    statementDate: '2025-10-31T00:00:00Z',
                },
            ];

            mockFetch.mock.mockImplementationOnce(() =>
                Promise.resolve({
                    ok: true,
                    json: () => Promise.resolve(mockResponse),
                })
            );

            const statements = await getStatements(testBankAccount);

            assert.strictEqual(statements.length, 1);
            assert.strictEqual(statements[0].statementId, 'stmt-1');
        });

        it('should handle API errors gracefully', async () => {
            mockFetch.mock.mockImplementationOnce(() =>
                Promise.resolve({
                    ok: false,
                    status: 403,
                    statusText: 'Forbidden',
                })
            );

            await assert.rejects(
                () => getStatements(testBankAccount),
                /API request failed: 403 Forbidden/
            );
        });

        it('should throw error for invalid response format', async () => {
            mockFetch.mock.mockImplementationOnce(() =>
                Promise.resolve({
                    ok: true,
                    json: () => Promise.resolve({ error: 'Invalid format' }),
                })
            );

            await assert.rejects(
                () => getStatements(testBankAccount),
                /Invalid response format: expected array of statements/
            );
        });
    });

    describe('downloadStatement - Credit Card', () => {
        const testProfile = {
            sessionId: 'test-session-id',
            profileId: 'user@example.com',
            profileName: 'Test User',
        };

        const testCardAccount = {
            profile: testProfile,
            accountId: 'CARD123',
            accountName: 'Discover it Cash Back',
            accountMask: '1234',
            accountType: /** @type {import('../bank/bank.types').AccountType} */ ('CreditCard'),
        };

        const testCardStatement = {
            account: testCardAccount,
            statementId: '20251020',
            statementDate: new Date('2025-10-20'),
        };

        it('should use chrome.runtime.sendMessage when not on card.discover.com domain', async () => {
            window.location.hostname = 'portal.discover.com';

            // Simulate base64 encoded PDF data
            const base64Data = 'data:application/pdf;base64,UERGIGNvbnRlbnQ=';
            const mockPdfBlob = new Blob(['PDF content'], { type: 'application/pdf' });

            // Mock chrome.runtime.sendMessage to simulate popup handling the fetch
            mockSendMessage.mock.mockImplementationOnce((message) => {
                if (message.action === 'requestFetch' && message.url.includes('stmtPDF')) {
                    return Promise.resolve({
                        ok: true,
                        status: 200,
                        statusText: 'OK',
                        headers: { 'content-type': 'application/pdf' },
                        body: base64Data,
                    });
                }
                return Promise.reject(new Error('Unexpected message'));
            });

            // Mock fetch for data URL conversion (used by blob() in fetchViaPopup)
            mockFetch.mock.mockImplementationOnce((url) => {
                if (url === base64Data) {
                    return Promise.resolve({
                        ok: true,
                        blob: () => Promise.resolve(mockPdfBlob),
                    });
                }
                return Promise.reject(new Error('Unexpected fetch URL'));
            });

            const blob = await downloadStatement(testCardStatement);

            assert.ok(blob instanceof Blob);

            // Verify chrome.runtime.sendMessage was called
            assert.strictEqual(mockSendMessage.mock.calls.length, 1);
            assert.ok(mockSendMessage.mock.calls[0].arguments[0].url.includes('stmtPDF'));
        });

        it('should download credit card statement PDF', async () => {
            window.location.hostname = 'card.discover.com';

            const mockPdfBlob = new Blob(['PDF content'], { type: 'application/pdf' });

            mockFetch.mock.mockImplementationOnce(() =>
                Promise.resolve({
                    ok: true,
                    headers: {
                        get: (name) => (name === 'content-type' ? 'application/pdf' : null),
                    },
                    blob: () => Promise.resolve(mockPdfBlob),
                })
            );

            const blob = await downloadStatement(testCardStatement);

            assert.strictEqual(blob, mockPdfBlob);

            const calls = mockFetch.mock.calls;
            assert.strictEqual(calls.length, 1);
            assert.ok(calls[0].arguments[0].includes('stmtPDF?view=true&date=20251020'));
            assert.ok(calls[0].arguments[0].includes('card.discover.com'));

            // Verify cookie was set
            assert.ok(document.cookie.includes('dfsedskey=CARD123'));
        });

        it('should handle PDF download errors', async () => {
            window.location.hostname = 'card.discover.com';

            mockFetch.mock.mockImplementationOnce(() =>
                Promise.resolve({
                    ok: false,
                    status: 404,
                    statusText: 'Not Found',
                })
            );

            await assert.rejects(
                () => downloadStatement(testCardStatement),
                /PDF download failed: 404 Not Found/
            );
        });

        it('should throw error when response is not a PDF', async () => {
            window.location.hostname = 'card.discover.com';

            mockFetch.mock.mockImplementationOnce(() =>
                Promise.resolve({
                    ok: true,
                    headers: {
                        get: (name) => (name === 'content-type' ? 'text/html' : null),
                    },
                    blob: () => Promise.resolve(new Blob(['HTML content'])),
                })
            );

            await assert.rejects(
                () => downloadStatement(testCardStatement),
                /Response is not a PDF file/
            );
        });
    });

    describe('downloadStatement - Bank Account', () => {
        const testProfile = {
            sessionId: 'test-session-id',
            profileId: 'user@example.com',
            profileName: 'Test User',
        };

        const testBankAccount = {
            profile: testProfile,
            accountId: 'BANK456',
            accountName: 'Discover Savings',
            accountMask: '5678',
            accountType: /** @type {import('../bank/bank.types').AccountType} */ ('Savings'),
        };

        const testBankStatement = {
            account: testBankAccount,
            statementId: 'https://bank.discover.com/bank/deposits/servicing/documents/v1/accounts/BANK456/statements/stmt-1',
            statementDate: new Date('2025-10-31'),
        };

        it('should download bank statement PDF using full URL', async () => {
            const mockPdfBlob = new Blob(['PDF content'], { type: 'application/pdf' });

            mockFetch.mock.mockImplementationOnce(() =>
                Promise.resolve({
                    ok: true,
                    headers: {
                        get: (name) => (name === 'content-type' ? 'application/pdf' : null),
                    },
                    blob: () => Promise.resolve(mockPdfBlob),
                })
            );

            const blob = await downloadStatement(testBankStatement);

            assert.strictEqual(blob, mockPdfBlob);

            const calls = mockFetch.mock.calls;
            assert.strictEqual(calls.length, 1);
            assert.strictEqual(calls[0].arguments[0], testBankStatement.statementId);
        });

        it('should construct URL when statement ID is not a full URL', async () => {
            const mockPdfBlob = new Blob(['PDF content'], { type: 'application/pdf' });

            const simpleStatement = {
                account: testBankAccount,
                statementId: 'stmt-123',
                statementDate: new Date('2025-10-31'),
            };

            mockFetch.mock.mockImplementationOnce(() =>
                Promise.resolve({
                    ok: true,
                    headers: {
                        get: (name) => (name === 'content-type' ? 'application/pdf' : null),
                    },
                    blob: () => Promise.resolve(mockPdfBlob),
                })
            );

            const blob = await downloadStatement(simpleStatement);

            assert.strictEqual(blob, mockPdfBlob);

            const calls = mockFetch.mock.calls;
            assert.strictEqual(calls.length, 1);
            assert.ok(calls[0].arguments[0].includes('BANK456/statements/stmt-123'));
        });

        it('should handle download errors', async () => {
            mockFetch.mock.mockImplementationOnce(() =>
                Promise.resolve({
                    ok: false,
                    status: 500,
                    statusText: 'Internal Server Error',
                })
            );

            await assert.rejects(
                () => downloadStatement(testBankStatement),
                /Failed to download bank statement: PDF download failed: 500 Internal Server Error/
            );
        });

        it('should throw error when response is not a PDF', async () => {
            mockFetch.mock.mockImplementationOnce(() =>
                Promise.resolve({
                    ok: true,
                    headers: {
                        get: (name) => (name === 'content-type' ? 'application/json' : null),
                    },
                    blob: () => Promise.resolve(new Blob(['{}'])),
                })
            );

            await assert.rejects(
                () => downloadStatement(testBankStatement),
                /Failed to download bank statement: Response is not a PDF file/
            );
        });
    });
});
