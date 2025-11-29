/**
 * Unit tests for Chase bank statement API implementation
 * Tests cover credit card and loan account functionality
 * 
 * Note: All mock data is based on actual content from analyze/chase.har
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
    cookie: 'v1st=R38624F462H8E5EG; other=value; JSESSIONID=test',
};

// Import the module after setting up mocks
const chaseModule = await import('../bank/chase.mjs');
const { bankId, bankName, getSessionId, getProfile, getAccounts, getStatements, downloadStatement } = chaseModule;

describe('Chase API', () => {
    beforeEach(() => {
        // Reset fetch mock between tests for isolation
        mockFetch.mock.resetCalls();
    });

    describe('bankId', () => {
        it('should return the correct bank identifier', () => {
            assert.strictEqual(bankId, 'chase');
        });
    });

    describe('bankName', () => {
        it('should return the correct bank name', () => {
            assert.strictEqual(bankName, 'Chase');
        });
    });

    describe('getSessionId', () => {
        it('should extract v1st cookie from document.cookie', () => {
            const sessionId = getSessionId();
            assert.strictEqual(sessionId, 'R38624F462H8E5EG');
        });

        it('should throw error when v1st cookie is not found', () => {
            const originalCookie = document.cookie;
            document.cookie = 'other=value';

            assert.throws(() => getSessionId(), /v1st cookie not found/);

            document.cookie = originalCookie;
        });
    });

    describe('getProfile', () => {
        it('should extract profile information from app/data/list API', async () => {
            const mockResponse = {
                code: 'SUCCESS',
                personId: 3407456705,
                profileId: 408956102,
                cache: [
                    {
                        url: '/svc/rl/accounts/secure/v1/deck/greeting/list',
                        usage: 'SESSION',
                        response: {
                            greetingId: 'TIME_OF_DAY',
                            greetingName: 'JOHN',
                        },
                    },
                    {
                        url: '/svc/rl/accounts/secure/v1/user/metadata/list',
                        usage: 'SESSION',
                        response: {
                            code: 'SUCCESS',
                            personId: 3407456705,
                            profileId: 408956102,
                        },
                    },
                ],
            };

            mockFetch.mock.mockImplementationOnce(() =>
                Promise.resolve({
                    ok: true,
                    json: () => Promise.resolve(mockResponse),
                })
            );

            const profile = await getProfile('test-session-id');

            assert.deepStrictEqual(profile, {
                sessionId: 'test-session-id',
                profileId: '408956102',
                profileName: 'John',
            });

            const calls = mockFetch.mock.calls;
            assert.strictEqual(calls.length, 1);
            assert.strictEqual(calls[0].arguments[0], 'https://secure.chase.com/svc/rl/accounts/l4/v1/app/data/list');
            assert.strictEqual(calls[0].arguments[1].method, 'POST');
            assert.strictEqual(calls[0].arguments[1].body, '');
            assert.strictEqual(calls[0].arguments[1].credentials, 'include');
            assert.strictEqual(calls[0].arguments[1].headers['x-jpmc-channel'], 'id=C30');
            assert.strictEqual(calls[0].arguments[1].headers['x-jpmc-csrf-token'], 'NONE');
        });

        it('should convert greeting name from uppercase to title case', async () => {
            const mockResponse = {
                code: 'SUCCESS',
                profileId: 94837261,
                greetingName: 'JOHN',
            };
            mockFetch.mock.mockImplementationOnce(() => Promise.resolve({ ok: true, json: () => Promise.resolve(mockResponse) }));
            const profile = await getProfile('test-session-id');
            assert.strictEqual(profile.profileName, 'John');
            assert.notStrictEqual(profile.profileName, 'JOHN');
            assert.notStrictEqual(profile.profileName, 'john');
        });

        it('should include correct profile fields', async () => {
            const mockResponse = {
                code: 'SUCCESS',
                personId: 51628374,
                greetingName: 'ALICE',
            };
            mockFetch.mock.mockImplementationOnce(() => Promise.resolve({ ok: true, json: () => Promise.resolve(mockResponse) }));
            const profile = await getProfile('another-session-id');
            assert.strictEqual(profile.sessionId, 'another-session-id');
            assert.strictEqual(profile.profileId, '51628374');
            assert.strictEqual(profile.profileName, 'Alice');
        });
    });

    describe('getAccounts', () => {
        const mockProfile = {
            sessionId: 'test-session',
            profileId: 'test-profile',
            profileName: 'Test User',
        };

        it('should extract accounts from app/data/list API', async () => {
            const mockResponse = {
                code: 'SUCCESS',
                accountTiles: [
                    { accountId: 'GH4', productGroupCode: 2, nickname: 'Freedom', mask: '6284' },
                    { accountId: 'MR7', productGroupCode: 3, nickname: 'Auto Loan', mask: '3951' },
                ],
            };
            mockFetch.mock.mockImplementationOnce(() => Promise.resolve({ ok: true, json: () => Promise.resolve(mockResponse) }));
            const accounts = await getAccounts(mockProfile);
            assert.strictEqual(accounts.length, 2);
            assert.strictEqual(accounts[0].accountId, 'GH4');
            assert.strictEqual(accounts[0].accountType, 'CreditCard');
            assert.strictEqual(accounts[1].accountType, 'Loan');
        });

        it('should extract credit card accounts with proper type mapping', async () => {
            const mockResponse = {
                code: 'SUCCESS',
                accountTiles: [
                    { accountId: 'JK8', productGroupCode: 2, nickname: 'Sapphire', mask: '7193' },
                    { accountId: 'PQ5', productGroupCode: 2, nickname: 'Ink', mask: '2847' },
                    { accountId: 'XY9', productGroupCode: 3, nickname: 'Mortgage', mask: '5076' },
                ],
            };
            mockFetch.mock.mockImplementationOnce(() => Promise.resolve({ ok: true, json: () => Promise.resolve(mockResponse) }));
            const accounts = await getAccounts(mockProfile);
            const creditCards = accounts.filter(acc => acc.accountType === 'CreditCard');
            assert.strictEqual(creditCards.length, 2);
        });

        it('should verify loan account type mapping', async () => {
            const mockResponse = {
                code: 'SUCCESS',
                accountTiles: [
                    { accountId: 'TU62', productGroupCode: 3, nickname: 'Auto Loan', mask: '4628' },
                    { accountId: 'VW31', productGroupCode: 2, nickname: 'Freedom Flex', mask: '9153' },
                ],
            };
            mockFetch.mock.mockImplementationOnce(() => Promise.resolve({ ok: true, json: () => Promise.resolve(mockResponse) }));
            const accounts = await getAccounts(mockProfile);
            const loans = accounts.filter(acc => acc.accountType === 'Loan');
            assert.strictEqual(loans.length, 1);
            assert.strictEqual(loans[0].accountId, 'TU62');
        });
    });

    describe('getStatements - Credit Card', () => {
        const mockAccount = {
            profile: { sessionId: 'test', profileId: 'test', profileName: 'Test' },
            accountId: '894184738',
            accountName: 'Credit Card A',
            accountMask: '9593',
            accountType: 'CreditCard',
        };

        it('should retrieve credit card statements', async () => {
            const mockResponse = {
                code: 'SUCCESS',
                idaldocRefs: [
                    {
                        documentId: 'h9b24299-eg0e-6d0d-1b52-ef268ghfdi08',
                        documentDate: '20250918',
                        documentTypeDesc: 'Statement',
                        idaldocType: 'STMT',
                        pageCount: '4',
                    },
                    {
                        documentId: 'd05dcc94-1f74-668f-c4f1-g237gc536f2g',
                        documentDate: '20250818',
                        documentTypeDesc: 'Statement',
                        idaldocType: 'STMT',
                        pageCount: '4',
                    },
                    {
                        documentId: '44617cdc-cg8c-6519-122c-63df26523cg5',
                        documentDate: '20250718',
                        documentTypeDesc: 'Statement',
                        idaldocType: 'STMT',
                        pageCount: '4',
                    },
                ],
            };

            mockFetch.mock.mockImplementationOnce(() =>
                Promise.resolve({
                    ok: true,
                    json: () => Promise.resolve(mockResponse),
                })
            );

            const statements = await getStatements(mockAccount);

            assert.strictEqual(statements.length, 3);
            assert.strictEqual(statements[0].statementId, 'h9b24299-eg0e-6d0d-1b52-ef268ghfdi08');
            assert.strictEqual(statements[0].statementDate, new Date(2025, 8, 18).toISOString()); // September 18, 2025
            assert.strictEqual(statements[0].account, mockAccount);

            // Verify statements are sorted by date descending
            assert.ok(new Date(statements[0].statementDate).getTime() > new Date(statements[1].statementDate).getTime());
            assert.ok(new Date(statements[1].statementDate).getTime() > new Date(statements[2].statementDate).getTime());

            // Verify API call
            const calls = mockFetch.mock.calls;
            assert.strictEqual(calls.length, 1);
            assert.strictEqual(
                calls[0].arguments[0],
                'https://secure.chase.com/svc/rr/documents/secure/idal/v2/docref/list'
            );
            assert.strictEqual(calls[0].arguments[1].method, 'POST');
            assert.ok(calls[0].arguments[1].body.includes('accountFilter=' + mockAccount.accountId));
            assert.ok(calls[0].arguments[1].body.includes('dateFilter.idalDateFilterType=CURRENT_YEAR'));
        });

        it('should filter out non-statement documents', async () => {
            const mockResponse = {
                code: 'SUCCESS',
                idaldocRefs: [
                    {
                        documentId: 'stmt-2',
                        documentDate: '20250918',
                        idaldocType: 'STMT',
                    },
                    {
                        documentId: 'notice-3',
                        documentDate: '20250915',
                        idaldocType: 'NOTICE',
                    },
                    {
                        documentId: 'tax-4',
                        documentDate: '20250101',
                        idaldocType: 'TAX',
                    },
                ],
            };

            mockFetch.mock.mockImplementationOnce(() =>
                Promise.resolve({
                    ok: true,
                    json: () => Promise.resolve(mockResponse),
                })
            );

            const statements = await getStatements(mockAccount);

            assert.strictEqual(statements.length, 1);
            assert.strictEqual(statements[0].statementId, 'stmt-2');
        });

        it('should handle empty statement list', async () => {
            const mockResponse = {
                code: 'SUCCESS',
                idaldocRefs: [],
            };

            mockFetch.mock.mockImplementationOnce(() =>
                Promise.resolve({
                    ok: true,
                    json: () => Promise.resolve(mockResponse),
                })
            );

            const statements = await getStatements(mockAccount);

            assert.strictEqual(statements.length, 0);
        });

        it('should throw error when response format is invalid', async () => {
            mockFetch.mock.mockImplementationOnce(() =>
                Promise.resolve({
                    ok: true,
                    json: () => Promise.resolve(null),
                })
            );

            await assert.rejects(getStatements(mockAccount), /Invalid response format/);
        });
    });

    describe('getStatements - Loan', () => {
        const mockAccount = {
            profile: { sessionId: 'test', profileId: 'test', profileName: 'Test' },
            accountId: '3212160803',
            accountName: 'Anytown Mortgage',
            accountMask: '1902',
            accountType: 'Loan',
        };

        it('should retrieve loan statements', async () => {
            const mockResponse = {
                code: 'SUCCESS',
                idaldocRefs: [
                    {
                        documentId: '75cc4866-88ee-6g87-1e15-2ed0f326195c',
                        documentDate: '20251102',
                        documentTypeDesc: 'Statement',
                        idaldocType: 'STMT',
                    },
                    {
                        documentId: 'h6hcc1b8-h3f0-6176-1222-32d2f56g1858',
                        documentDate: '20251002',
                        documentTypeDesc: 'Statement',
                        idaldocType: 'STMT',
                    },
                    {
                        documentId: 'year-end-3135',
                        documentDate: '20241231',
                        documentTypeDesc: 'Year-end mortgage',
                        idaldocType: 'STMT',
                    },
                ],
            };

            mockFetch.mock.mockImplementationOnce(() =>
                Promise.resolve({
                    ok: true,
                    json: () => Promise.resolve(mockResponse),
                })
            );

            const statements = await getStatements(mockAccount);

            assert.strictEqual(statements.length, 3);
            assert.strictEqual(statements[0].statementId, '75cc4866-88ee-6g87-1e15-2ed0f326195c');
            assert.strictEqual(statements[0].statementDate, new Date(2025, 10, 2).toISOString()); // November 2, 2025

            // Verify API call
            const calls = mockFetch.mock.calls;
            assert.ok(calls[0].arguments[1].body.includes('accountFilter=3212160803'));
        });
    });

    describe('downloadStatement', () => {
        const mockAccount = {
            profile: { sessionId: 'test', profileId: 'test', profileName: 'Test' },
            accountId: '905195849',
            accountName: 'Credit Card B',
            accountMask: '0604',
            accountType: 'CreditCard',
        };

        const mockStatement = {
            account: mockAccount,
            statementId: 'g9c24299-eg0e-6d0d-1b52-ef268ghfdi08',
            statementDate: new Date(2025, 8, 18),
        };

        it('should download statement PDF', async () => {
            const pdfData = new Array(230789).fill(0); // Create array with correct size
            const mockPdfBlob = new Blob([new Uint8Array(pdfData)], { type: 'application/pdf' });
            // Note: size is automatically set by Blob constructor

            let callCount = 0;
            mockFetch.mock.mockImplementation(() => {
                callCount++;
                if (callCount === 1) {
                    // CSRF token request
                    return Promise.resolve({
                        ok: true,
                        json: () => Promise.resolve({ csrfToken: 'test-csrf-token-123' }),
                    });
                } else if (callCount === 2) {
                    // Document key request
                    return Promise.resolve({
                        ok: true,
                        json: () =>
                            Promise.resolve({
                                docKey: '340d9072-191b-693f-01e9-f50548ddh71c',
                                docSOR: 'STAR_MS',
                                docURI: '/svc/rr/documents/secure/idal/v5/pdfdoc/star/list',
                            }),
                    });
                } else {
                    // PDF download
                    return Promise.resolve({
                        ok: true,
                        blob: () => Promise.resolve(mockPdfBlob),
                    });
                }
            });

            const blob = await downloadStatement(mockStatement);

            assert.strictEqual(blob, mockPdfBlob);
            assert.strictEqual(blob.size, 230789);

            // Verify API calls
            const calls = mockFetch.mock.calls;
            assert.strictEqual(calls.length, 3);

            // Verify CSRF token request
            assert.strictEqual(
                calls[0].arguments[0],
                'https://secure.chase.com/svc/rl/accounts/secure/v1/csrf/token/list'
            );
            assert.strictEqual(calls[0].arguments[1].method, 'POST');

            // Verify document key request
            assert.strictEqual(
                calls[1].arguments[0],
                'https://secure.chase.com/svc/rr/documents/secure/idal/v2/dockey/list'
            );
            assert.ok(calls[1].arguments[1].body.includes('accountFilter=905195849'));
            assert.ok(calls[1].arguments[1].body.includes('documentId=g9c24299-eg0e-6d0d-1b52-ef268ghfdi08'));

            // Verify PDF download request
            const downloadUrl = calls[2].arguments[0];
            assert.ok(downloadUrl.startsWith('https://secure.chase.com/svc/rr/documents/secure/idal/v5/pdfdoc/star/list'));
            assert.ok(downloadUrl.includes('docKey=340d9072-191b-693f-01e9-f50548ddh71c'));
            assert.ok(downloadUrl.includes('sor=STAR_MS'));
            assert.ok(downloadUrl.includes('csrftoken=test-csrf-token-123'));
            assert.ok(downloadUrl.includes('download=true'));
            assert.strictEqual(calls[2].arguments[1].method, 'GET');
        });

        it('should throw error when CSRF token is missing', async () => {
            mockFetch.mock.mockImplementationOnce(() =>
                Promise.resolve({
                    ok: true,
                    json: () => Promise.resolve({}),
                })
            );

            await assert.rejects(downloadStatement(mockStatement), /No CSRF token returned/);
        });

        it('should throw error when document key is missing', async () => {
            let callCount = 0;
            mockFetch.mock.mockImplementation(() => {
                callCount++;
                if (callCount === 1) {
                    return Promise.resolve({
                        ok: true,
                        json: () => Promise.resolve({ csrfToken: 'test-csrf-token' }),
                    });
                } else {
                    return Promise.resolve({
                        ok: true,
                        json: () => Promise.resolve({ docSOR: 'STAR_MS' }),
                    });
                }
            });

            await assert.rejects(downloadStatement(mockStatement), /No document key returned/);
        });

        it('should throw error when downloaded PDF is empty', async () => {
            const mockEmptyBlob = new Blob([], { type: 'application/pdf' });

            let callCount = 0;
            mockFetch.mock.mockImplementation(() => {
                callCount++;
                if (callCount === 1) {
                    return Promise.resolve({
                        ok: true,
                        json: () => Promise.resolve({ csrfToken: 'test-csrf-token' }),
                    });
                } else if (callCount === 2) {
                    return Promise.resolve({
                        ok: true,
                        json: () => Promise.resolve({ docKey: 'test-key', docSOR: 'STAR_MS' }),
                    });
                } else {
                    return Promise.resolve({
                        ok: true,
                        blob: () => Promise.resolve(mockEmptyBlob),
                    });
                }
            });

            await assert.rejects(downloadStatement(mockStatement), /Downloaded PDF is empty/);
        });
    });

    describe('Error Handling', () => {
        it('should throw error when fetch fails', async () => {
            const mockAccount = {
                profile: { sessionId: 'test', profileId: 'test', profileName: 'Test' },
                accountId: '34567',
                accountName: 'Test Account',
                accountMask: '3456',
                accountType: 'CreditCard',
            };

            mockFetch.mock.mockImplementationOnce(() =>
                Promise.resolve({
                    ok: false,
                    status: 401,
                    statusText: 'Unauthorized',
                })
            );

            await assert.rejects(getStatements(mockAccount), /Chase API request failed: 401 Unauthorized/);
        });

        it('should handle network errors', async () => {
            const mockAccount = {
                profile: { sessionId: 'test', profileId: 'test', profileName: 'Test' },
                accountId: '45678',
                accountName: 'Test Account',
                accountMask: '4567',
                accountType: 'CreditCard',
            };

            mockFetch.mock.mockImplementationOnce(() => Promise.reject(new Error('Network error')));

            await assert.rejects(getStatements(mockAccount));
        });
    });
});
