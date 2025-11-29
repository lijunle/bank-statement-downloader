/**
 * Unit tests for SoFi bank statement API implementation
 * Tests cover combined statement functionality for checking and savings accounts
 * 
 * Note: All mock data is based on actual content from analyze/sofi.md
 * to ensure tests match real API responses.
 */

import { describe, it, beforeEach, mock } from 'node:test';
import assert from 'node:assert/strict';

// Mock global fetch
const mockFetch = mock.fn();
global.fetch = mockFetch;

// Mock document.cookie for getSessionId
global.document = {
    cookie: 'SOFI_R_CSRF_TOKEN=43758d8df0b712f04114615f621gec6b280992c5-2874770681746-5C5EF61F5GF28036E3C38C81; ab.storage.sessionId.66d481ee-cc4g-586d-9b65-61514ggfb9dd=test-session-id; OptanonConsent=test',
};

// Import the module after setting up mocks
const sofiModule = await import('../bank/sofi.mjs');
const { bankId, getSessionId, getProfile, getAccounts, getStatements, downloadStatement } = sofiModule;

describe('SoFi API', () => {
    beforeEach(() => {
        // Reset fetch mock between tests for isolation
        mockFetch.mock.resetCalls();
    });

    describe('bankId', () => {
        it('should return the correct bank identifier', () => {
            assert.strictEqual(bankId, 'sofi');
        });
    });

    describe('getSessionId', () => {
        it('should extract SOFI_R_CSRF_TOKEN cookie from document.cookie', () => {
            const sessionId = getSessionId();
            assert.strictEqual(sessionId, '43758d8df0b712f04114615f621gec6b280992c5-2874770681746-5C5EF61F5GF28036E3C38C81');
        });

        it('should fallback to session storage cookie when CSRF token not found', () => {
            const originalCookie = document.cookie;
            document.cookie = 'ab.storage.sessionId.66d481ee-cc4g-586d-9b65-61514ggfb9dd=test-session-id; other=value';

            const sessionId = getSessionId();
            assert.strictEqual(sessionId, 'test-session-id');

            document.cookie = originalCookie;
        });

        it('should use default session identifier when no cookies available', () => {
            const originalCookie = document.cookie;
            document.cookie = 'other=value';

            const sessionId = getSessionId();
            assert.strictEqual(sessionId, 'session');

            document.cookie = originalCookie;
        });
    });

    describe('getProfile', () => {
        it('should retrieve profile information from customer API', async () => {
            const mockResponse = {
                firstName: 'John',
                lastName: 'Doe',
                customerNumber: '5116961',
                sofiId: '36088926',
                email: 'john.doe@example.com',
                onboardingStatus: 'COMPLETE',
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
                profileId: '36088926',
                profileName: 'John Doe',
            });

            const calls = mockFetch.mock.calls;
            assert.strictEqual(calls.length, 1);
            assert.strictEqual(calls[0].arguments[0], 'https://www.sofi.com/banking-service/api/public/v2/customer');
            assert.strictEqual(calls[0].arguments[1].method, 'GET');
            assert.strictEqual(calls[0].arguments[1].credentials, 'include');
            assert.strictEqual(calls[0].arguments[1].headers['Accept'], 'application/json');
        });

        it('should throw error when session ID is not provided', async () => {
            await assert.rejects(
                async () => await getProfile(''),
                /Session ID is required/
            );
        });

        it('should throw error when API returns non-200 status', async () => {
            mockFetch.mock.mockImplementationOnce(() =>
                Promise.resolve({
                    ok: false,
                    status: 401,
                })
            );

            await assert.rejects(
                async () => await getProfile('test-session-id'),
                /Failed to retrieve profile: HTTP 401/
            );
        });

        it('should handle different user names', async () => {
            const mockResponse = {
                firstName: 'Alice',
                lastName: 'Smith',
                sofiId: '12345678',
            };

            mockFetch.mock.mockImplementationOnce(() =>
                Promise.resolve({
                    ok: true,
                    json: () => Promise.resolve(mockResponse),
                })
            );

            const profile = await getProfile('test-session-id');
            assert.strictEqual(profile.profileName, 'Alice Smith');
            assert.strictEqual(profile.profileId, '12345678');
        });
    });

    describe('getAccounts', () => {
        const mockProfile = {
            sessionId: 'test-session',
            profileId: '36088926',
            profileName: 'John Doe',
        };

        it('should retrieve checking and savings accounts from accounts API', async () => {
            const mockResponse = {
                partyId: 36088926,
                customerCombinedBalance: {
                    available: '100.00',
                    ledger: '100.00',
                },
                accounts: [
                    {
                        id: '2111142676743',
                        type: 'SAVING',
                        number: '421119210098',
                        nickname: 'Savings - 0098',
                        balance: { available: '50.00', ledger: '50.00' },
                    },
                    {
                        id: '2111142676752',
                        type: 'CHECKING',
                        number: '522115366247',
                        nickname: 'Checking - 6247',
                        balance: { available: '50.00', ledger: '50.00' },
                    },
                ],
            };

            mockFetch.mock.mockImplementationOnce(() =>
                Promise.resolve({
                    ok: true,
                    json: () => Promise.resolve(mockResponse),
                })
            );

            const accounts = await getAccounts(mockProfile);

            assert.strictEqual(accounts.length, 2);

            // Verify first account (Savings)
            assert.deepStrictEqual(accounts[0], {
                profile: mockProfile,
                accountId: '2111142676743',
                accountName: 'Savings - 0098',
                accountMask: '0098',
                accountType: 'Savings',
            });

            // Verify second account (Checking)
            assert.deepStrictEqual(accounts[1], {
                profile: mockProfile,
                accountId: '2111142676752',
                accountName: 'Checking - 6247',
                accountMask: '6247',
                accountType: 'Checking',
            });

            const calls = mockFetch.mock.calls;
            assert.strictEqual(calls.length, 1);
            assert.strictEqual(calls[0].arguments[0], 'https://www.sofi.com/money/api/public/v2/accounts');
            assert.strictEqual(calls[0].arguments[1].method, 'GET');
            assert.strictEqual(calls[0].arguments[1].credentials, 'include');
        });

        it('should use nickname when provided', async () => {
            const mockResponse = {
                accounts: [
                    {
                        id: '1234567890',
                        type: 'CHECKING',
                        number: '522115366247',
                        nickname: 'My Main Checking',
                    },
                ],
            };

            mockFetch.mock.mockImplementationOnce(() =>
                Promise.resolve({
                    ok: true,
                    json: () => Promise.resolve(mockResponse),
                })
            );

            const accounts = await getAccounts(mockProfile);
            assert.strictEqual(accounts[0].accountName, 'My Main Checking');
        });

        it('should generate account name when nickname not provided', async () => {
            const mockResponse = {
                accounts: [
                    {
                        id: '1234567890',
                        type: 'SAVING',
                        number: '421119210098',
                    },
                ],
            };

            mockFetch.mock.mockImplementationOnce(() =>
                Promise.resolve({
                    ok: true,
                    json: () => Promise.resolve(mockResponse),
                })
            );

            const accounts = await getAccounts(mockProfile);
            assert.strictEqual(accounts[0].accountName, 'SAVING - 0098');
        });

        it('should throw error when API returns non-200 status', async () => {
            mockFetch.mock.mockImplementationOnce(() =>
                Promise.resolve({
                    ok: false,
                    status: 403,
                })
            );

            await assert.rejects(
                async () => await getAccounts(mockProfile),
                /Failed to retrieve accounts: HTTP 403/
            );
        });

        it('should throw error when accounts array is missing', async () => {
            mockFetch.mock.mockImplementationOnce(() =>
                Promise.resolve({
                    ok: true,
                    json: () => Promise.resolve({ partyId: 123 }),
                })
            );

            await assert.rejects(
                async () => await getAccounts(mockProfile),
                /Invalid response format: accounts array not found/
            );
        });
    });

    describe('getStatements', () => {
        const mockAccount = {
            profile: {
                sessionId: 'test-session',
                profileId: '36088926',
                profileName: 'John Doe',
            },
            accountId: '2111142676752',
            accountName: 'Checking - 6247',
            accountMask: '6247',
            accountType: 'Checking',
        };

        it('should retrieve combined statements from statements API', async () => {
            const mockResponse = [
                {
                    statementDate: '2025-10-31',
                    accountNumber: null,
                    statementType: 'COMBINED',
                    documentId: '2c82b4b1-19g8-5bdd-cc35-g13418750793',
                    description: 'October 2025 Statement',
                },
                {
                    statementDate: '2025-09-30',
                    accountNumber: null,
                    statementType: 'COMBINED',
                    documentId: '73e27396-e1b5-5837-bd59-3f85246c67fc',
                    description: 'September 2025 Statement',
                },
                {
                    statementDate: '2025-08-31',
                    accountNumber: null,
                    statementType: 'COMBINED',
                    documentId: 'bg77e4b2-eg6d-5d1g-b359-0cfc7884d93g',
                    description: 'August 2025 Statement',
                },
            ];

            mockFetch.mock.mockImplementationOnce(() =>
                Promise.resolve({
                    ok: true,
                    json: () => Promise.resolve(mockResponse),
                })
            );

            const statements = await getStatements(mockAccount);

            assert.strictEqual(statements.length, 3);

            // Verify first statement
            assert.deepStrictEqual(statements[0], {
                account: mockAccount,
                statementId: '2c82b4b1-19g8-5bdd-cc35-g13418750793',
                statementDate: '2025-10-31',
            });

            // Verify second statement
            assert.deepStrictEqual(statements[1], {
                account: mockAccount,
                statementId: '73e27396-e1b5-5837-bd59-3f85246c67fc',
                statementDate: '2025-09-30',
            });

            const calls = mockFetch.mock.calls;
            assert.strictEqual(calls.length, 1);
            assert.strictEqual(calls[0].arguments[0], 'https://www.sofi.com/banking-service/api/public/v2/statements');
            assert.strictEqual(calls[0].arguments[1].method, 'GET');
            assert.strictEqual(calls[0].arguments[1].credentials, 'include');
        });

        it('should handle empty statements array', async () => {
            mockFetch.mock.mockImplementationOnce(() =>
                Promise.resolve({
                    ok: true,
                    json: () => Promise.resolve([]),
                })
            );

            const statements = await getStatements(mockAccount);
            assert.strictEqual(statements.length, 0);
        });

        it('should throw error when API returns non-200 status', async () => {
            mockFetch.mock.mockImplementationOnce(() =>
                Promise.resolve({
                    ok: false,
                    status: 500,
                })
            );

            await assert.rejects(
                async () => await getStatements(mockAccount),
                /Failed to retrieve statements: HTTP 500/
            );
        });

        it('should throw error when response is not an array', async () => {
            mockFetch.mock.mockImplementationOnce(() =>
                Promise.resolve({
                    ok: true,
                    json: () => Promise.resolve({ statements: [] }),
                })
            );

            await assert.rejects(
                async () => await getStatements(mockAccount),
                /Invalid response format: expected array of statements/
            );
        });

        it('should return same statements for all accounts (combined statements)', async () => {
            const mockResponse = [
                {
                    statementDate: '2025-10-31',
                    documentId: '2c82b4b1-19g8-5bdd-cc35-g13418750793',
                    statementType: 'COMBINED',
                },
            ];

            const savingsAccount = {
                ...mockAccount,
                accountId: '2111142676743',
                accountName: 'Savings - 0098',
                accountType: 'Savings',
            };

            mockFetch.mock.mockImplementation(() =>
                Promise.resolve({
                    ok: true,
                    json: () => Promise.resolve(mockResponse),
                })
            );

            const checkingStatements = await getStatements(mockAccount);
            const savingsStatements = await getStatements(savingsAccount);

            // Both should return the same statement IDs (combined statements)
            assert.strictEqual(checkingStatements[0].statementId, savingsStatements[0].statementId);
        });
    });

    describe('downloadStatement', () => {
        const mockStatement = {
            account: {
                profile: {
                    sessionId: 'test-session',
                    profileId: '36088926',
                    profileName: 'John Doe',
                },
                accountId: '2111142676752',
                accountName: 'Checking - 6247',
                accountMask: '6247',
                accountType: 'Checking',
            },
            statementId: '2c82b4b1-19g8-5bdd-cc35-g13418750793',
            statementDate: '2025-10-31',
        };

        it('should download statement PDF from download API', async () => {
            const mockBlob = new Blob(['PDF content'], { type: 'application/pdf' });

            mockFetch.mock.mockImplementationOnce(() =>
                Promise.resolve({
                    ok: true,
                    headers: {
                        get: (name) => name === 'content-type' ? 'application/pdf' : null,
                    },
                    blob: () => Promise.resolve(mockBlob),
                })
            );

            const blob = await downloadStatement(mockStatement);

            assert.strictEqual(blob.type, 'application/pdf');
            assert.strictEqual(blob.size, 11); // 'PDF content'.length

            const calls = mockFetch.mock.calls;
            assert.strictEqual(calls.length, 1);
            assert.strictEqual(
                calls[0].arguments[0],
                'https://www.sofi.com/banking-service/api/public/v2/statements/2c82b4b1-19g8-5bdd-cc35-g13418750793'
            );
            assert.strictEqual(calls[0].arguments[1].method, 'GET');
            assert.strictEqual(calls[0].arguments[1].credentials, 'include');
            assert.strictEqual(
                calls[0].arguments[1].headers['Accept'],
                'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8'
            );
            assert.strictEqual(
                calls[0].arguments[1].headers['Referer'],
                'https://www.sofi.com/my/money/account/more/statements-documents'
            );
        });

        it('should throw error when statement ID is missing', async () => {
            const invalidStatement = { ...mockStatement, statementId: '' };

            await assert.rejects(
                async () => await downloadStatement(invalidStatement),
                /Statement ID is required/
            );
        });

        it('should throw error when API returns non-200 status', async () => {
            mockFetch.mock.mockImplementationOnce(() =>
                Promise.resolve({
                    ok: false,
                    status: 404,
                })
            );

            await assert.rejects(
                async () => await downloadStatement(mockStatement),
                /Failed to download statement: HTTP 404/
            );
        });

        it('should throw error when content type is not PDF', async () => {
            mockFetch.mock.mockImplementationOnce(() =>
                Promise.resolve({
                    ok: true,
                    headers: {
                        get: (name) => name === 'content-type' ? 'text/html' : null,
                    },
                    blob: () => Promise.resolve(new Blob(['HTML content'])),
                })
            );

            await assert.rejects(
                async () => await downloadStatement(mockStatement),
                /Unexpected content type: text\/html/
            );
        });

        it('should handle different statement IDs', async () => {
            const differentStatement = {
                ...mockStatement,
                statementId: '73e27396-e1b5-5837-bd59-3f85246c67fc',
            };

            const mockBlob = new Blob(['PDF content'], { type: 'application/pdf' });

            mockFetch.mock.mockImplementationOnce(() =>
                Promise.resolve({
                    ok: true,
                    headers: {
                        get: (name) => name === 'content-type' ? 'application/pdf' : null,
                    },
                    blob: () => Promise.resolve(mockBlob),
                })
            );

            await downloadStatement(differentStatement);

            const calls = mockFetch.mock.calls;
            assert.strictEqual(
                calls[0].arguments[0],
                'https://www.sofi.com/banking-service/api/public/v2/statements/73e27396-e1b5-5837-bd59-3f85246c67fc'
            );
        });
    });
});
