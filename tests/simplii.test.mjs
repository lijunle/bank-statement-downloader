/**
 * Unit tests for Simplii Financial bank statement API implementation
 * Tests cover checking, savings, and USD savings account functionality
 * 
 * Note: All mock data is based on actual content from analyze/simplii_1763648550287.har
 * to ensure tests match real API responses.
 */

import { describe, it, beforeEach, mock } from 'node:test';
import assert from 'node:assert/strict';

// Mock global fetch
const mockFetch = mock.fn();
global.fetch = mockFetch;

// Mock sessionStorage for getSessionId
global.sessionStorage = {
    getItem: mock.fn((key) => {
        if (key === 'ebanking:session_token') {
            return '"ebkpcc.fd5414bb-146f-5bce-9019-cg9df6ff3g21"';
        }
        return null;
    }),
};

// Mock document.cookie for Safari fallback
global.document = {
    cookie: 'other=value; ebanking:session_token=ebkpcc.fallback-token-12345',
};

// Import the module after setting up mocks
const simpliiModule = await import('../bank/simplii.mjs');
const { bankId, getSessionId, getProfile, getAccounts, getStatements, downloadStatement } = simpliiModule;

describe('Simplii Financial API', () => {
    beforeEach(() => {
        // Reset fetch mock between tests for isolation
        mockFetch.mock.resetCalls();
    });

    describe('bankId', () => {
        it('should return the correct bank identifier', () => {
            assert.strictEqual(bankId, 'simplii');
        });
    });

    describe('getSessionId', () => {
        it('should extract session token from sessionStorage', () => {
            const sessionId = getSessionId();
            assert.strictEqual(sessionId, 'ebkpcc.fd5414bb-146f-5bce-9019-cg9df6ff3g21');
        });

        it('should parse JSON-encoded session token', () => {
            const originalGetItem = sessionStorage.getItem;
            sessionStorage.getItem = mock.fn(() => '"ebkpcc.test-uuid-12345"');

            const sessionId = getSessionId();
            assert.strictEqual(sessionId, 'ebkpcc.test-uuid-12345');

            sessionStorage.getItem = originalGetItem;
        });

        it('should throw error when session token is not found', () => {
            const originalGetItem = sessionStorage.getItem;
            const originalCookie = document.cookie;

            sessionStorage.getItem = mock.fn(() => null);
            document.cookie = '';

            assert.throws(() => getSessionId(), /Simplii session token not found/);

            sessionStorage.getItem = originalGetItem;
            document.cookie = originalCookie;
        });
    });

    describe('getProfile', () => {
        it('should retrieve user profile information', async () => {
            const mockResponse = {
                id: '223732229599998828133872',
                firstName: 'JOHN',
                lastName: 'DOE',
                language: 'en',
                email: 'john.doe@example.com',
                phoneNumber: '(234) 567-8901',
                preferences: {
                    notifications: true,
                    paperless: true,
                },
            };

            mockFetch.mock.mockImplementationOnce(() =>
                Promise.resolve({
                    ok: true,
                    json: () => Promise.resolve(mockResponse),
                })
            );

            // Note: getProfile calls getSessionId() internally via makeAuthenticatedRequest
            // so it uses the mocked sessionStorage value for the actual request
            const profile = await getProfile('ebkpcc.custom-test-token');

            assert.strictEqual(profile.sessionId, 'ebkpcc.custom-test-token');
            assert.strictEqual(profile.profileId, '223732229599998828133872');
            assert.strictEqual(profile.profileName, 'JOHN DOE');

            const calls = mockFetch.mock.calls;
            assert.strictEqual(calls.length, 1);
            assert.strictEqual(calls[0].arguments[0], 'https://online.simplii.com/ebm-anp/api/v1/profile/json/userProfiles');
            assert.strictEqual(calls[0].arguments[1].method, undefined);
            assert.strictEqual(calls[0].arguments[1].credentials, 'include');
            // The actual x-auth-token comes from getSessionId(), not the parameter
            assert.ok(calls[0].arguments[1].headers['x-auth-token'].startsWith('ebkpcc.'));
            assert.strictEqual(calls[0].arguments[1].headers['brand'], 'pcf');
        });

        it('should handle profile with missing middle name', async () => {
            const mockResponse = {
                id: '123456789',
                firstName: 'JOHN',
                lastName: 'DOE',
                language: 'en',
            };
            mockFetch.mock.mockImplementationOnce(() => Promise.resolve({ ok: true, json: () => Promise.resolve(mockResponse) }));

            const profile = await getProfile('ebkpcc.test-session');
            assert.strictEqual(profile.profileName, 'JOHN DOE');
        });

        it('should throw error when profile response is invalid', async () => {
            mockFetch.mock.mockImplementationOnce(() =>
                Promise.resolve({
                    ok: true,
                    json: () => Promise.resolve({}),
                })
            );

            await assert.rejects(
                () => getProfile('ebkpcc.test-session'),
                /No user profile found in response/
            );
        });
    });

    describe('getAccounts', () => {
        const mockProfile = {
            sessionId: 'ebkpcc.test-session',
            profileId: 'test-profile-id',
            profileName: 'Test User',
        };

        it('should retrieve all accounts with correct mapping', async () => {
            const mockResponse = {
                accounts: [
                    {
                        id: '2e27d9g4cgfb68g1gg382c0f405e607304992d6d76f4d2dg7ggc96e1g697fe9e',
                        number: '0224086324',
                        nickname: '',
                        balance: 1234.56,
                        availableFunds: 1234.56,
                        status: 'ACTIVE',
                        openDate: '2024-11-01',
                        categorization: {
                            category: 'DEPOSIT',
                            subCategory: 'CHEQUING',
                            holding: 'Z20001',
                            taxPlan: 'NON_REGISTERED',
                        },
                        displayAttributes: {
                            name: 'chequing_personal',
                            fullName: 'chequing_personal',
                        },
                        currency: 'CAD',
                        capabilities: ['ESTATEMENT_SOURCE', 'TRANSFER_FROM'],
                    },
                    {
                        id: '96190b8b6c39b0401b2bgf36f34bg122c472e6b8b4b7615cg11deb50e3c61dd6',
                        number: '0224083539',
                        nickname: '',
                        balance: 5678.90,
                        availableFunds: 5678.90,
                        status: 'ACTIVE',
                        openDate: '2024-10-15',
                        categorization: {
                            category: 'DEPOSIT',
                            subCategory: 'SAVINGS',
                            holding: 'Z20002',
                            taxPlan: 'NON_REGISTERED',
                        },
                        displayAttributes: {
                            name: 'savings_personal_investment',
                            fullName: 'savings_personal_investment',
                        },
                        currency: 'CAD',
                        capabilities: ['ESTATEMENT_SOURCE'],
                    },
                    {
                        id: 'bg48b834be7599de16g7815466c053064939593bb2c6e36f9f6306g5c953gf73',
                        number: '0224088096',
                        nickname: '',
                        balance: 1000.00,
                        availableFunds: 1000.00,
                        status: 'ACTIVE',
                        openDate: '2024-09-01',
                        categorization: {
                            category: 'DEPOSIT',
                            subCategory: 'USD_SAVINGS',
                            holding: 'Z20003',
                            taxPlan: 'NON_REGISTERED',
                        },
                        displayAttributes: {
                            name: 'usd_savings_personal',
                            fullName: 'usd_savings_personal',
                        },
                        currency: 'USD',
                        capabilities: ['ESTATEMENT_SOURCE'],
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

            assert.strictEqual(accounts.length, 3);

            // Verify chequing account
            assert.strictEqual(accounts[0].accountId, '2e27d9g4cgfb68g1gg382c0f405e607304992d6d76f4d2dg7ggc96e1g697fe9e');
            assert.strictEqual(accounts[0].accountName, 'No Fee Chequing Account');
            assert.strictEqual(accounts[0].accountMask, '6324');
            assert.strictEqual(accounts[0].accountType, 'Checking');

            // Verify high interest savings account
            assert.strictEqual(accounts[1].accountId, '96190b8b6c39b0401b2bgf36f34bg122c472e6b8b4b7615cg11deb50e3c61dd6');
            assert.strictEqual(accounts[1].accountName, 'High Interest Savings Account');
            assert.strictEqual(accounts[1].accountMask, '3539');
            assert.strictEqual(accounts[1].accountType, 'Savings');

            // Verify USD savings account
            assert.strictEqual(accounts[2].accountId, 'bg48b834be7599de16g7815466c053064939593bb2c6e36f9f6306g5c953gf73');
            assert.strictEqual(accounts[2].accountName, 'USD Savings Account');
            assert.strictEqual(accounts[2].accountMask, '8096');
            assert.strictEqual(accounts[2].accountType, 'Savings');

            const calls = mockFetch.mock.calls;
            assert.strictEqual(calls.length, 1);
            assert.strictEqual(calls[0].arguments[0], 'https://online.simplii.com/ebm-ai/api/v2/json/accounts');
        });

        it('should handle account with nickname', async () => {
            const mockResponse = {
                accounts: [
                    {
                        id: 'account123',
                        number: '1234567890',
                        nickname: 'My Main Account',
                        balance: 100,
                        availableFunds: 100,
                        status: 'ACTIVE',
                        openDate: '2024-01-01',
                        categorization: {
                            category: 'DEPOSIT',
                            subCategory: 'CHEQUING',
                        },
                        displayAttributes: {
                            name: 'unknown_account_type',
                        },
                        currency: 'CAD',
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
            assert.strictEqual(accounts[0].accountName, 'My Main Account');
        });

        it('should map all known account types correctly', async () => {
            const mockResponse = {
                accounts: [
                    {
                        id: 'acc1',
                        number: '1111111111',
                        nickname: '',
                        balance: 0,
                        availableFunds: 0,
                        status: 'ACTIVE',
                        openDate: '2024-01-01',
                        categorization: { category: 'DEPOSIT', subCategory: 'SAVINGS' },
                        displayAttributes: { name: 'savings_personal' },
                        currency: 'CAD',
                    },
                    {
                        id: 'acc2',
                        number: '2222222222',
                        nickname: '',
                        balance: 0,
                        availableFunds: 0,
                        status: 'ACTIVE',
                        openDate: '2024-01-01',
                        categorization: { category: 'DEPOSIT', subCategory: 'SAVINGS' },
                        displayAttributes: { name: 'savings_taxfree_personal_investment' },
                        currency: 'CAD',
                    },
                    {
                        id: 'acc3',
                        number: '3333333333',
                        nickname: '',
                        balance: 0,
                        availableFunds: 0,
                        status: 'ACTIVE',
                        openDate: '2024-01-01',
                        categorization: { category: 'DEPOSIT', subCategory: 'SAVINGS' },
                        displayAttributes: { name: 'savings_rrsp_individual_investment' },
                        currency: 'CAD',
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
            assert.strictEqual(accounts[0].accountName, 'Savings Account');
            assert.strictEqual(accounts[1].accountName, 'Tax-Free Savings Account');
            assert.strictEqual(accounts[2].accountName, 'RRSP Savings Account');
        });
    });

    describe('getStatements', () => {
        const mockAccount = {
            profile: {
                sessionId: 'ebkpcc.test-session',
                profileId: 'test-profile',
                profileName: 'Test User',
            },
            accountId: '2e27d9g4cgfb68g1gg382c0f405e607304992d6d76f4d2dg7ggc96e1g697fe9e',
            accountName: 'No Fee Chequing Account',
            accountMask: '6324',
            accountType: 'Checking',
            _openDate: '2024-01-01',
        };

        it('should retrieve available statements for past 12 months', async () => {
            // Mock successful responses for recent months
            let callCount = 0;
            mockFetch.mock.mockImplementation(() => {
                callCount++;
                if (callCount <= 3) {
                    return Promise.resolve({
                        ok: true,
                        status: 201,
                        json: () => Promise.resolve({
                            eStatements: [{
                                accountId: '2e27d9g4cgfb68g1gg382c0f405e607304992d6d76f4d2dg7ggc96e1g697fe9e',
                                month: String(12 - callCount),
                                year: '2025',
                                fileUri: `statement-uuid-${callCount}`,
                                lang: null,
                            }],
                        }),
                    });
                }
                return Promise.resolve({
                    ok: false,
                    status: 422,
                });
            });

            const statements = await getStatements(mockAccount);

            assert.ok(statements.length >= 3);
            assert.strictEqual(statements[0].account, mockAccount);
            assert.ok(statements[0].statementId.startsWith('statement-uuid-'));
            assert.ok(statements[0].statementDate);

            // Verify JSON body is sent (not Base64)
            const calls = mockFetch.mock.calls;
            const firstCall = calls[0];
            const requestBody = JSON.parse(firstCall.arguments[1].body);
            assert.strictEqual(requestBody.eStatement.accountId, mockAccount.accountId);
            assert.ok(requestBody.eStatement.month);
            assert.ok(requestBody.eStatement.year);
            assert.strictEqual(requestBody.eStatement.fileUri, null);
        });

        it('should handle 422 errors for missing statements gracefully', async () => {
            mockFetch.mock.mockImplementation(() =>
                Promise.resolve({
                    ok: false,
                    status: 422,
                })
            );

            const statements = await getStatements(mockAccount);
            assert.strictEqual(statements.length, 0);
        });

        it('should limit lookback to 12 months', async () => {
            mockFetch.mock.mockImplementation(() =>
                Promise.resolve({
                    ok: false,
                    status: 422,
                })
            );

            await getStatements(mockAccount);

            const calls = mockFetch.mock.calls;
            // Should query approximately 12 months (may vary slightly based on current date)
            assert.ok(calls.length <= 13);
            assert.ok(calls.length >= 11);
        });

        it('should respect account openDate', async () => {
            const recentAccount = {
                ...mockAccount,
                _openDate: new Date(Date.now() - 60 * 24 * 60 * 60 * 1000).toISOString(), // 60 days ago
            };

            mockFetch.mock.mockImplementation(() =>
                Promise.resolve({
                    ok: false,
                    status: 422,
                })
            );

            await getStatements(recentAccount);

            const calls = mockFetch.mock.calls;
            // Should only query ~2-3 months since account was opened recently
            assert.ok(calls.length <= 4);
        });
    });

    describe('downloadStatement', () => {
        const mockStatement = {
            account: {
                profile: {
                    sessionId: 'ebkpcc.test-session',
                    profileId: 'test-profile',
                    profileName: 'Test User',
                },
                accountId: '2e27d9g4cgfb68g1gg382c0f405e607304992d6d76f4d2dg7ggc96e1g697fe9e',
                accountName: 'No Fee Chequing Account',
                accountMask: '6324',
                accountType: 'Checking',
            },
            statementId: '3b172b48-530e-5fe2-0185-b7be1bee559g',
            statementDate: '2025-10-01T00:00:00.000Z',
        };

        it('should download statement PDF successfully', async () => {
            const mockPdfBlob = new Blob(['PDF content'], { type: 'application/pdf' });

            mockFetch.mock.mockImplementationOnce(() =>
                Promise.resolve({
                    ok: true,
                    blob: () => Promise.resolve(mockPdfBlob),
                })
            );

            const blob = await downloadStatement(mockStatement);

            assert.ok(blob instanceof Blob);
            assert.strictEqual(blob.size, 11);

            const calls = mockFetch.mock.calls;
            assert.strictEqual(calls.length, 1);
            assert.strictEqual(
                calls[0].arguments[0],
                'https://online.simplii.com/ebm-ai/api/v1/json/eStatements/file/3b172b48-530e-5fe2-0185-b7be1bee559g?eb-target-site=ebkpcc'
            );
            assert.strictEqual(calls[0].arguments[1].method, 'POST');
            // Body contains the session token from the account's profile
            assert.ok(calls[0].arguments[1].body.startsWith('X-Auth-Token='));
            assert.strictEqual(calls[0].arguments[1].headers['content-type'], 'application/vnd.api+json');
        });

        it('should throw error when download fails', async () => {
            mockFetch.mock.mockImplementationOnce(() =>
                Promise.resolve({
                    ok: false,
                    status: 404,
                    statusText: 'Not Found',
                })
            );

            await assert.rejects(
                () => downloadStatement(mockStatement),
                /Failed to download Simplii statement.*404 Not Found/
            );
        });

        it('should throw error when downloaded PDF is empty', async () => {
            const emptyBlob = new Blob([], { type: 'application/pdf' });

            mockFetch.mock.mockImplementationOnce(() =>
                Promise.resolve({
                    ok: true,
                    blob: () => Promise.resolve(emptyBlob),
                })
            );

            await assert.rejects(
                () => downloadStatement(mockStatement),
                /Downloaded statement is empty/
            );
        });

        it('should include correct query parameter', async () => {
            const mockBlob = new Blob(['content'], { type: 'application/pdf' });
            mockFetch.mock.mockImplementationOnce(() =>
                Promise.resolve({
                    ok: true,
                    blob: () => Promise.resolve(mockBlob),
                })
            );

            await downloadStatement(mockStatement);

            const calls = mockFetch.mock.calls;
            const url = calls[0].arguments[0];
            assert.ok(url.includes('?eb-target-site=ebkpcc'));
        });
    });
});
