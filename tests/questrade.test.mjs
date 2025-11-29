/**
 * Unit tests for Questrade bank statement API implementation
 * Tests cover OAuth 2.0 OIDC authentication and brokerage account functionality
 * 
 * Note: All mock data is based on actual responses from analyze/questrade_1763643629493.har
 * to ensure tests match real API behavior, including OAuth scope management.
 */

import { describe, it, beforeEach, mock } from 'node:test';
import assert from 'node:assert/strict';

// Mock global fetch
const mockFetch = mock.fn();
global.fetch = mockFetch;

// Mock sessionStorage for OIDC tokens
const mockSessionStorage = {
    _storage: {},
    getItem(key) {
        return this._storage[key] || null;
    },
    setItem(key, value) {
        this._storage[key] = value;
    },
    key(index) {
        return Object.keys(this._storage)[index] || null;
    },
    get length() {
        return Object.keys(this._storage).length;
    },
    clear() {
        this._storage = {};
    }
};

global.sessionStorage = mockSessionStorage;

// Import the module after setting up mocks
const questradeModule = await import('../bank/questrade.mjs');
const { bankId, getSessionId, getProfile, getAccounts, getStatements, downloadStatement } = questradeModule;

describe('Questrade API', () => {
    beforeEach(() => {
        mockFetch.mock.resetCalls();
        mockSessionStorage.clear();
    });

    describe('bankId', () => {
        it('should return the correct bank identifier', () => {
            assert.strictEqual(bankId, 'questrade');
        });
    });

    describe('getSessionId', () => {
        it('should extract access token from OIDC token with preferred client ID', () => {
            // Mock OIDC token with preferred client (broadest access)
            const oidcToken = {
                access_token: 'mock-access-token-preferred',
                id_token: 'mock.id.token',
                token_type: 'Bearer',
                scope: 'openid profile brokerage.accounts.all brokerage.orders.all',
                expires_at: 1763643652
            };

            mockSessionStorage.setItem(
                'oidc.user:https://login.questrade.com:b2b58359-2951-50d8-c3b3-521egf59gce2',
                JSON.stringify(oidcToken)
            );

            const sessionId = getSessionId();
            assert.strictEqual(sessionId, 'mock-access-token-preferred');
        });

        it('should extract access token from OIDC token without slash in key', () => {
            // Mock OIDC token with alternative key pattern (no slash before colon)
            const oidcToken = {
                access_token: 'mock-access-token-alt',
                id_token: 'mock.id.token',
                token_type: 'Bearer',
                scope: 'openid profile enterprise.document-centre-statement.read',
                expires_at: 1763643652
            };

            mockSessionStorage.setItem(
                'oidc.user:https://login.questrade.com:3e74b345-1db3-50cb-9dg4-e54f5818d978',
                JSON.stringify(oidcToken)
            );

            const sessionId = getSessionId();
            assert.strictEqual(sessionId, 'mock-access-token-alt');
        });

        it('should find token from any OIDC client when preferred not available', () => {
            // Mock OIDC token with documents client only (using pattern without slash)
            const oidcToken = {
                access_token: 'mock-access-token-docs',
                id_token: 'mock.id.token',
                token_type: 'Bearer',
                scope: 'openid profile enterprise.document-centre-statement.read',
                expires_at: 1763643652
            };

            mockSessionStorage.setItem(
                'oidc.user:https://login.questrade.com:3e74b345-1db3-50cb-9dg4-e54f5818d978',
                JSON.stringify(oidcToken)
            );

            const sessionId = getSessionId();
            assert.strictEqual(sessionId, 'mock-access-token-docs');
        });

        it('should throw error when no OIDC token is found', () => {
            assert.throws(() => getSessionId(), /Questrade session not found/);
        });
    });

    describe('getProfile', () => {
        it('should extract profile from cached profile field in OIDC token', async () => {
            const oidcToken = {
                access_token: 'mock-access-token',
                id_token: 'mock.id.token',
                token_type: 'Bearer',
                scope: 'openid profile',
                expires_at: 1763643652,
                profile: {
                    given_name: 'John',
                    family_name: 'Doe',
                    preferred_username: 'johndoe123',
                    sub: '82894c07-ebcd-5ffb-0dca-g74a0cef986d'
                }
            };

            // Use pattern without slash before colon (matches actual OIDC key pattern)
            mockSessionStorage.setItem(
                'oidc.user:https://login.questrade.com:4f85c456-2ec4-61dc-0eh5-f65g6929e089',
                JSON.stringify(oidcToken)
            );

            const profile = await getProfile('mock-access-token');

            assert.deepStrictEqual(profile, {
                sessionId: 'mock-access-token',
                profileId: '82894c07-ebcd-5ffb-0dca-g74a0cef986d',
                profileName: 'John Doe'
            });

            // Should not make API call
            assert.strictEqual(mockFetch.mock.calls.length, 0);
        });

        it('should extract profile from decoded id_token JWT', async () => {
            // Create a mock JWT (header.payload.signature)
            const payload = {
                given_name: 'John',
                family_name: 'Doe',
                preferred_username: 'johndoe123',
                sub: '82894c07-ebcd-5ffb-0dca-g74a0cef986d'
            };
            const base64Payload = btoa(JSON.stringify(payload));
            const mockIdToken = `header.${base64Payload}.signature`;

            const oidcToken = {
                access_token: 'mock-access-token',
                id_token: mockIdToken,
                token_type: 'Bearer',
                scope: 'openid profile',
                expires_at: 1763643652
            };

            // Use pattern without slash before colon (matches actual OIDC key pattern)
            mockSessionStorage.setItem(
                'oidc.user:https://login.questrade.com:4f85c456-2ec4-61dc-0eh5-f65g6929e089',
                JSON.stringify(oidcToken)
            );

            const profile = await getProfile('mock-access-token');

            assert.deepStrictEqual(profile, {
                sessionId: 'mock-access-token',
                profileId: '82894c07-ebcd-5ffb-0dca-g74a0cef986d',
                profileName: 'John Doe'
            });

            // Should not make API call
            assert.strictEqual(mockFetch.mock.calls.length, 0);
        });

        it('should fall back to API call when token extraction fails', async () => {
            // No OIDC token in sessionStorage

            const mockApiResponse = {
                amr: ['pwd', 'mfa'],
                mfa_time: 1763643652,
                mfa_method: 'Authenticator',
                'user-profile-id': '82894c07-ebcd-5ffb-0dca-g74a0cef986d',
                'clp-profile-id': '82894c07-ebcd-5ffb-0dca-g74a0cef986d',
                preferred_username: 'johndoe123',
                given_name: 'John',
                family_name: 'Doe',
                locale: 'en',
                role: 'Investor',
                sub: '82894c07-ebcd-5ffb-0dca-g74a0cef986d'
            };

            mockFetch.mock.mockImplementationOnce(() =>
                Promise.resolve({
                    ok: true,
                    json: () => Promise.resolve(mockApiResponse)
                })
            );

            const profile = await getProfile('mock-access-token');

            assert.deepStrictEqual(profile, {
                sessionId: 'mock-access-token',
                profileId: '82894c07-ebcd-5ffb-0dca-g74a0cef986d',
                profileName: 'John Doe'
            });

            const calls = mockFetch.mock.calls;
            assert.strictEqual(calls.length, 1);
            assert.strictEqual(calls[0].arguments[0], 'https://login.questrade.com/connect/userinfo');
            assert.strictEqual(calls[0].arguments[1].method, 'GET');
            assert.strictEqual(calls[0].arguments[1].headers['Authorization'], 'Bearer mock-access-token');
        });

        it('should return minimal profile on CORS or API errors', async () => {
            // Mock API error (CORS)
            mockFetch.mock.mockImplementationOnce(() =>
                Promise.reject(new Error('CORS blocked'))
            );

            const profile = await getProfile('mock-access-token');

            assert.deepStrictEqual(profile, {
                sessionId: 'mock-access-token',
                profileId: '',
                profileName: 'User'
            });
        });
    });

    describe('getAccounts', () => {
        it('should retrieve all brokerage accounts', async () => {
            const mockApiResponse = {
                accounts: [
                    {
                        key: '3d5f4828-5b15-5203-1f66-9c67709f6614',
                        number: '51195778',
                        name: 'Individual Cash',
                        createdOn: '2025-06-03T06:38:55.503',
                        productType: 'SD',
                        accountType: 'Individual',
                        accountDetailType: 'Cash',
                        accountStatus: 'Complete',
                        platformStatus: 'Active',
                        nickname: null
                    }
                ],
                authorizedAccounts: []
            };

            mockFetch.mock.mockImplementationOnce(() =>
                Promise.resolve({
                    ok: true,
                    json: () => Promise.resolve(mockApiResponse)
                })
            );

            const profile = {
                sessionId: 'mock-access-token',
                profileId: '82894c07-ebcd-5ffb-0dca-g74a0cef986d',
                profileName: 'John Doe'
            };

            const accounts = await getAccounts(profile);

            assert.strictEqual(accounts.length, 1);
            assert.deepStrictEqual(accounts[0], {
                profile,
                accountId: '3d5f4828-5b15-5203-1f66-9c67709f6614',
                accountName: 'Individual Cash',
                accountMask: '5778',
                accountType: 'Investment'
            });

            const calls = mockFetch.mock.calls;
            assert.strictEqual(calls.length, 1);
            assert.strictEqual(calls[0].arguments[0], 'https://api.questrade.com/v3/brokerage-accounts');
            assert.strictEqual(calls[0].arguments[1].method, 'GET');
            assert.strictEqual(calls[0].arguments[1].headers['Authorization'], 'Bearer mock-access-token');
        });

        it('should handle multiple accounts including TFSA and RRSP', async () => {
            const mockApiResponse = {
                accounts: [
                    {
                        key: '3d5f4828-5b15-5203-1f66-9c67709f6614',
                        number: '51195778',
                        name: 'Individual Cash',
                        createdOn: '2025-06-03T06:38:55.503',
                        productType: 'SD',
                        accountType: 'Individual',
                        accountDetailType: 'Cash',
                        accountStatus: 'Complete',
                        platformStatus: 'Active',
                        nickname: null
                    },
                    {
                        key: '4e6f5939-6c26-6304-2f77-1e89921h8836',
                        number: '62206889',
                        name: 'TFSA',
                        createdOn: '2024-01-15T08:22:30.123',
                        productType: 'SD',
                        accountType: 'Individual',
                        accountDetailType: 'TFSA',
                        accountStatus: 'Complete',
                        platformStatus: 'Active',
                        nickname: 'Tax Free Savings'
                    },
                    {
                        key: '5f7g6040-7d37-7415-3088-2f90032i9947',
                        number: '73317990',
                        name: 'RRSP',
                        createdOn: '2023-05-20T10:45:12.456',
                        productType: 'SD',
                        accountType: 'Individual',
                        accountDetailType: 'RRSP',
                        accountStatus: 'Complete',
                        platformStatus: 'Active',
                        nickname: null
                    }
                ],
                authorizedAccounts: []
            };

            mockFetch.mock.mockImplementationOnce(() =>
                Promise.resolve({
                    ok: true,
                    json: () => Promise.resolve(mockApiResponse)
                })
            );

            const profile = {
                sessionId: 'mock-access-token',
                profileId: '82894c07-ebcd-5ffb-0dca-g74a0cef986d',
                profileName: 'John Doe'
            };

            const accounts = await getAccounts(profile);

            assert.strictEqual(accounts.length, 3);

            assert.deepStrictEqual(accounts[0], {
                profile,
                accountId: '3d5f4828-5b15-5203-1f66-9c67709f6614',
                accountName: 'Individual Cash',
                accountMask: '5778',
                accountType: 'Investment'
            });

            assert.deepStrictEqual(accounts[1], {
                profile,
                accountId: '4e6f5939-6c26-6304-2f77-1e89921h8836',
                accountName: 'Tax Free Savings',
                accountMask: '6889',
                accountType: 'Investment'
            });

            assert.deepStrictEqual(accounts[2], {
                profile,
                accountId: '5f7g6040-7d37-7415-3088-2f90032i9947',
                accountName: 'RRSP',
                accountMask: '7990',
                accountType: 'Investment'
            });
        });

        it('should throw error when API returns error', async () => {
            mockFetch.mock.mockImplementationOnce(() =>
                Promise.resolve({
                    ok: false,
                    status: 401,
                    statusText: 'Unauthorized'
                })
            );

            const profile = {
                sessionId: 'invalid-token',
                profileId: '82894c07-ebcd-5ffb-0dca-g74a0cef986d',
                profileName: 'John Doe'
            };

            await assert.rejects(
                () => getAccounts(profile),
                /Failed to retrieve Questrade accounts/
            );
        });

        it('should throw error when no accounts found', async () => {
            mockFetch.mock.mockImplementationOnce(() =>
                Promise.resolve({
                    ok: true,
                    json: () => Promise.resolve({ accounts: [], authorizedAccounts: [] })
                })
            );

            const profile = {
                sessionId: 'mock-access-token',
                profileId: '82894c07-ebcd-5ffb-0dca-g74a0cef986d',
                profileName: 'John Doe'
            };

            await assert.rejects(
                () => getAccounts(profile),
                /No accounts found for this profile/
            );
        });
    });

    describe('getStatements', () => {
        beforeEach(() => {
            // Setup OIDC token with document-centre scope for statement APIs
            const oidcToken = {
                access_token: 'mock-statement-token',
                id_token: 'mock.id.token',
                token_type: 'Bearer',
                scope: 'openid profile enterprise.document-centre-statement.read',
                expires_at: 1763643652
            };

            mockSessionStorage.setItem(
                'oidc.user:https://login.questrade.com:3e74b345-1db3-50cb-9dg4-e54f5818d978',
                JSON.stringify(oidcToken)
            );
        });

        it('should retrieve statements for a specific account', async () => {
            const mockApiResponse = [
                {
                    accountUuid: '3d5f4828-5b15-5203-1f66-9c67709f6614',
                    accountNumber: '51195778',
                    accountName: 'Individual Cash',
                    lineOfBusiness: 'Brokerage',
                    lobProductType: 'SD',
                    accountType: 'Individual',
                    accountDetailType: 'Cash',
                    documents: [
                        {
                            id: 'dd6f18g2-ef6e-518b-cc50-9b4fff7b358e',
                            date: '2025-08-01 00:00:00Z',
                            statementPeriod: 'Monthly'
                        },
                        {
                            id: '4567384d-16eg-5deb-95f4-9556501e9c86',
                            date: '2025-07-01 00:00:00Z',
                            statementPeriod: 'Monthly'
                        },
                        {
                            id: '408cf587-0g9d-5f8e-b6d3-8945620e7f97',
                            date: '2025-06-01 00:00:00Z',
                            statementPeriod: 'Monthly'
                        }
                    ]
                }
            ];

            mockFetch.mock.mockImplementationOnce(() =>
                Promise.resolve({
                    ok: true,
                    json: () => Promise.resolve(mockApiResponse)
                })
            );

            const account = {
                profile: {
                    sessionId: 'mock-access-token',
                    profileId: '82894c07-ebcd-5ffb-0dca-g74a0cef986d',
                    profileName: 'John Doe'
                },
                accountId: '3d5f4828-5b15-5203-1f66-9c67709f6614',
                accountName: 'Individual Cash',
                accountMask: '5778',
                accountType: 'Investment'
            };

            const statements = await getStatements(account);

            assert.strictEqual(statements.length, 3);

            // Verify date format is normalized (space converted to 'T')
            assert.deepStrictEqual(statements[0], {
                account,
                statementId: 'dd6f18g2-ef6e-518b-cc50-9b4fff7b358e',
                statementDate: '2025-08-01T00:00:00Z'
            });

            assert.deepStrictEqual(statements[1], {
                account,
                statementId: '4567384d-16eg-5deb-95f4-9556501e9c86',
                statementDate: '2025-07-01T00:00:00Z'
            });

            assert.deepStrictEqual(statements[2], {
                account,
                statementId: '408cf587-0g9d-5f8e-b6d3-8945620e7f97',
                statementDate: '2025-06-01T00:00:00Z'
            });

            const calls = mockFetch.mock.calls;
            assert.strictEqual(calls.length, 1);
            assert.strictEqual(
                calls[0].arguments[0],
                'https://api.questrade.com/v2/document-centre/statement?take=100&businessLine=Brokerage'
            );
            assert.strictEqual(calls[0].arguments[1].method, 'GET');
            // Should use token with document-centre scope
            assert.strictEqual(calls[0].arguments[1].headers['Authorization'], 'Bearer mock-statement-token');
        });

        it('should filter statements when API returns multiple accounts', async () => {
            const mockApiResponse = [
                {
                    accountUuid: '4e6f5939-6c26-6304-2f77-1e89921h8836',
                    accountNumber: '62206889',
                    accountName: 'TFSA',
                    lineOfBusiness: 'Brokerage',
                    lobProductType: 'SD',
                    accountType: 'Individual',
                    accountDetailType: 'TFSA',
                    documents: [
                        {
                            id: 'ejggfsfou-tubufnfou-2',
                            date: '2025-08-01 00:00:00Z',
                            statementPeriod: 'Monthly'
                        }
                    ]
                },
                {
                    accountUuid: '3d5f4828-5b15-5203-1f66-9c67709f6614',
                    accountNumber: '51195778',
                    accountName: 'Individual Cash',
                    lineOfBusiness: 'Brokerage',
                    lobProductType: 'SD',
                    accountType: 'Individual',
                    accountDetailType: 'Cash',
                    documents: [
                        {
                            id: 'ubshfu-tubufnfou-2',
                            date: '2025-08-01 00:00:00Z',
                            statementPeriod: 'Monthly'
                        }
                    ]
                }
            ];

            mockFetch.mock.mockImplementationOnce(() =>
                Promise.resolve({
                    ok: true,
                    json: () => Promise.resolve(mockApiResponse)
                })
            );

            const account = {
                profile: {
                    sessionId: 'mock-access-token',
                    profileId: '82894c07-ebcd-5ffb-0dca-g74a0cef986d',
                    profileName: 'John Doe'
                },
                accountId: '3d5f4828-5b15-5203-1f66-9c67709f6614',
                accountName: 'Individual Cash',
                accountMask: '5778',
                accountType: 'Investment'
            };

            const statements = await getStatements(account);

            // Should only return statements for the requested account
            assert.strictEqual(statements.length, 1);
            assert.strictEqual(statements[0].statementId, 'ubshfu-tubufnfou-2');
        });

        it('should use fallback token when document-centre token not found', async () => {
            // Clear the document-centre token
            mockSessionStorage.clear();

            const mockApiResponse = [
                {
                    accountUuid: '4e6f5939-6c26-6304-2f77-1e89921h8836',
                    accountNumber: '62206889',
                    accountName: 'Individual Cash',
                    lineOfBusiness: 'Brokerage',
                    lobProductType: 'SD',
                    accountType: 'Individual',
                    accountDetailType: 'Cash',
                    documents: [
                        {
                            id: 'ee7g29h3-fg7f-629c-dd61-0c5ggg8c469f',
                            date: '2025-08-01 00:00:00Z',
                            statementPeriod: 'Monthly'
                        }
                    ]
                }
            ];

            mockFetch.mock.mockImplementationOnce(() =>
                Promise.resolve({
                    ok: true,
                    json: () => Promise.resolve(mockApiResponse)
                })
            );

            const account = {
                profile: {
                    sessionId: 'fallback-token',
                    profileId: '82894c07-ebcd-5ffb-0dca-g74a0cef986d',
                    profileName: 'John Doe'
                },
                accountId: '4e6f5939-6c26-6304-2f77-1e89921h8836',
                accountName: 'Individual Cash',
                accountMask: '6889',
                accountType: 'Investment'
            };

            const statements = await getStatements(account);

            assert.strictEqual(statements.length, 1);

            // Should use account's session token as fallback
            const calls = mockFetch.mock.calls;
            assert.strictEqual(calls[0].arguments[1].headers['Authorization'], 'Bearer fallback-token');
        });

        it('should return empty array when no statements found for account', async () => {
            const mockApiResponse = [
                {
                    accountUuid: '3d5f4828-5b15-5203-1f66-9c67709f6614',
                    accountNumber: '51195778',
                    accountName: 'Individual Cash',
                    lineOfBusiness: 'Brokerage',
                    lobProductType: 'SD',
                    accountType: 'Individual',
                    accountDetailType: 'Cash',
                    documents: []
                }
            ];

            mockFetch.mock.mockImplementationOnce(() =>
                Promise.resolve({
                    ok: true,
                    json: () => Promise.resolve(mockApiResponse)
                })
            );

            const account = {
                profile: {
                    sessionId: 'mock-access-token',
                    profileId: '82894c07-ebcd-5ffb-0dca-g74a0cef986d',
                    profileName: 'John Doe'
                },
                accountId: '3d5f4828-5b15-5203-1f66-9c67709f6614',
                accountName: 'Individual Cash',
                accountMask: '5778',
                accountType: 'Investment'
            };

            const statements = await getStatements(account);

            assert.strictEqual(statements.length, 0);
        });

        it('should throw error when API returns 403 Forbidden (missing scope)', async () => {
            mockFetch.mock.mockImplementationOnce(() =>
                Promise.resolve({
                    ok: false,
                    status: 403,
                    statusText: 'Forbidden'
                })
            );

            const account = {
                profile: {
                    sessionId: 'token-without-scope',
                    profileId: '82894c07-ebcd-5ffb-0dca-g74a0cef986d',
                    profileName: 'John Doe'
                },
                accountId: '3d5f4828-5b15-5203-1f66-9c67709f6614',
                accountName: 'Individual Cash',
                accountMask: '5778',
                accountType: 'Investment'
            };

            await assert.rejects(
                () => getStatements(account),
                /Failed to retrieve Questrade statements/
            );
        });
    });

    describe('downloadStatement', () => {
        beforeEach(() => {
            // Setup OIDC token with document-centre scope for statement download
            const oidcToken = {
                access_token: 'mock-statement-token',
                id_token: 'mock.id.token',
                token_type: 'Bearer',
                scope: 'openid profile enterprise.document-centre-statement.read',
                expires_at: 1763643652
            };

            mockSessionStorage.setItem(
                'oidc.user:https://login.questrade.com:3e74b345-1db3-50cb-9dg4-e54f5818d978',
                JSON.stringify(oidcToken)
            );
        });

        it('should download statement PDF file', async () => {
            const mockPdfBlob = new Blob(['mock pdf content'], { type: 'application/pdf' });

            mockFetch.mock.mockImplementationOnce(() =>
                Promise.resolve({
                    ok: true,
                    blob: () => Promise.resolve(mockPdfBlob)
                })
            );

            const statement = {
                account: {
                    profile: {
                        sessionId: 'mock-access-token',
                        profileId: '82894c07-ebcd-5ffb-0dca-g74a0cef986d',
                        profileName: 'John Doe'
                    },
                    accountId: '3d5f4828-5b15-5203-1f66-9c67709f6614',
                    accountName: 'Individual Cash',
                    accountMask: '5778',
                    accountType: 'Investment'
                },
                statementId: 'dd6f18g2-ef6e-518b-cc50-9b4fff7b358e',
                statementDate: '2025-08-01T00:00:00Z'
            };

            const blob = await downloadStatement(statement);

            assert.ok(blob instanceof Blob);
            assert.strictEqual(blob.size, 16); // 'mock pdf content'.length
            assert.strictEqual(blob.type, 'application/pdf');

            const calls = mockFetch.mock.calls;
            assert.strictEqual(calls.length, 1);
            assert.strictEqual(
                calls[0].arguments[0],
                'https://api.questrade.com/v2/document-centre/statement/dd6f18g2-ef6e-518b-cc50-9b4fff7b358e/file'
            );
            assert.strictEqual(calls[0].arguments[1].method, 'GET');
            // Should use token with document-centre scope
            assert.strictEqual(calls[0].arguments[1].headers['Authorization'], 'Bearer mock-statement-token');
            assert.strictEqual(calls[0].arguments[1].headers['Accept'], 'application/pdf');
        });

        it('should use fallback token when document-centre token not found', async () => {
            // Clear the document-centre token
            mockSessionStorage.clear();

            const mockPdfBlob = new Blob(['mock pdf content'], { type: 'application/pdf' });

            mockFetch.mock.mockImplementationOnce(() =>
                Promise.resolve({
                    ok: true,
                    blob: () => Promise.resolve(mockPdfBlob)
                })
            );

            const statement = {
                account: {
                    profile: {
                        sessionId: 'fallback-token',
                        profileId: '82894c07-ebcd-5ffb-0dca-g74a0cef986d',
                        profileName: 'John Doe'
                    },
                    accountId: '3d5f4828-5b15-5203-1f66-9c67709f6614',
                    accountName: 'Individual Cash',
                    accountMask: '5778',
                    accountType: 'Investment'
                },
                statementId: 'dd6f18g2-ef6e-518b-cc50-9b4fff7b358e',
                statementDate: '2025-08-01T00:00:00Z'
            };

            const blob = await downloadStatement(statement);

            assert.ok(blob instanceof Blob);

            // Should use account's session token as fallback
            const calls = mockFetch.mock.calls;
            assert.strictEqual(calls[0].arguments[1].headers['Authorization'], 'Bearer fallback-token');
        });

        it('should throw error when downloaded file is empty', async () => {
            const emptyBlob = new Blob([], { type: 'application/pdf' });

            mockFetch.mock.mockImplementationOnce(() =>
                Promise.resolve({
                    ok: true,
                    blob: () => Promise.resolve(emptyBlob)
                })
            );

            const statement = {
                account: {
                    profile: {
                        sessionId: 'mock-access-token',
                        profileId: '82894c07-ebcd-5ffb-0dca-g74a0cef986d',
                        profileName: 'John Doe'
                    },
                    accountId: '3d5f4828-5b15-5203-1f66-9c67709f6614',
                    accountName: 'Individual Cash',
                    accountMask: '5778',
                    accountType: 'Investment'
                },
                statementId: 'dd6f18g2-ef6e-518b-cc50-9b4fff7b358e',
                statementDate: '2025-08-01T00:00:00Z'
            };

            await assert.rejects(
                () => downloadStatement(statement),
                /Downloaded statement file is empty/
            );
        });

        it('should throw error when API returns error', async () => {
            mockFetch.mock.mockImplementationOnce(() =>
                Promise.resolve({
                    ok: false,
                    status: 404,
                    statusText: 'Not Found'
                })
            );

            const statement = {
                account: {
                    profile: {
                        sessionId: 'mock-access-token',
                        profileId: '82894c07-ebcd-5ffb-0dca-g74a0cef986d',
                        profileName: 'John Doe'
                    },
                    accountId: '3d5f4828-5b15-5203-1f66-9c67709f6614',
                    accountName: 'Individual Cash',
                    accountMask: '5778',
                    accountType: 'Investment'
                },
                statementId: 'jowbmje-tubufnfou-je',
                statementDate: '2025-08-01T00:00:00Z'
            };

            await assert.rejects(
                () => downloadStatement(statement),
                /Failed to download Questrade statement/
            );
        });
    });
});
