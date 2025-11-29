/**
 * Unit tests for Wealthsimple bank statement API implementation
 * Tests cover checking account (cash) and investment accounts (TFSA, RRSP, Non-registered)
 * 
 * Note: All mock data is based on actual responses extracted from
 * analyze/wealthsimple_1763899399558.har to ensure tests match real API responses.
 */

import { describe, it, beforeEach, mock } from 'node:test';
import assert from 'node:assert/strict';

// Mock global fetch
const mockFetch = mock.fn();
global.fetch = mockFetch;

// Mock chrome.runtime.sendMessage for downloadStatement
global.chrome = {
    runtime: {
        sendMessage: mock.fn(),
    },
};

// Mock document.cookie for authentication
global.document = {
    cookie: '_oauth2_access_v2=%7B%22access_token%22%3A%22fzKcMdjPSUzJ1NiJ0.uftu-kxu-uplfo%22%2C%22identity_canonical_id%22%3A%22identity-gY6Lf91dcOYYlWhU1KjhnCGhV8x%22%2C%22token_type%22%3A%22Bearer%22%2C%22expires_in%22%3A3600%7D; wssdi=uftu-efwjdf-je; ws_global_visitor_id=uftu-wjtjups-je; ws_jurisdiction=CA',
};

// Mock atob for JWT decoding
global.atob = (str) => {
    return Buffer.from(str, 'base64').toString('utf-8');
};

// Import the module after setting up mocks
const wealthsimpleModule = await import('../bank/wealthsimple.mjs');
const { bankId, getSessionId, getProfile, getAccounts, getStatements, downloadStatement } = wealthsimpleModule;

describe('Wealthsimple API', () => {
    beforeEach(() => {
        mockFetch.mock.resetCalls();
        global.chrome.runtime.sendMessage.mock.resetCalls();
    });

    describe('bankId', () => {
        it('should return the correct bank identifier', () => {
            assert.strictEqual(bankId, 'wealthsimple');
        });
    });

    describe('getSessionId', () => {
        it('should extract Bearer token from _oauth2_access_v2 cookie', () => {
            const sessionId = getSessionId();
            assert.strictEqual(sessionId, 'Bearer fzKcMdjPSUzJ1NiJ0.uftu-kxu-uplfo');
        });

        it('should throw error when _oauth2_access_v2 cookie is not found', () => {
            const originalCookie = document.cookie;
            document.cookie = 'other=value';

            assert.throws(() => getSessionId(), /No authorization token found/);

            document.cookie = originalCookie;
        });

        it('should throw error when cookie has invalid JSON', () => {
            const originalCookie = document.cookie;
            document.cookie = '_oauth2_access_v2=invalid-json';

            assert.throws(() => getSessionId(), /No authorization token found/);

            document.cookie = originalCookie;
        });
    });

    describe('getProfile', () => {
        it('should extract profile information from identity query', async () => {
            const mockResponse = {
                data: {
                    identity: {
                        id: 'identity-gY6Lf91dcOYYlWhU1KjhnCGhV8x',
                        email: 'john.doe@example.com',
                        createdAt: '2022-04-27T20:48:29.825Z',
                        users: [],
                        __typename: 'Identity',
                    },
                },
            };

            mockFetch.mock.mockImplementationOnce(() =>
                Promise.resolve({
                    ok: true,
                    json: () => Promise.resolve(mockResponse),
                })
            );

            const profile = await getProfile('Bearer test-token');

            assert.deepStrictEqual(profile, {
                sessionId: 'Bearer test-token',
                profileId: 'identity-gY6Lf91dcOYYlWhU1KjhnCGhV8x',
                profileName: 'john.doe@example.com',
            });

            const calls = mockFetch.mock.calls;
            assert.strictEqual(calls.length, 1);
            assert.strictEqual(calls[0].arguments[0], 'https://my.wealthsimple.com/graphql');
            assert.strictEqual(calls[0].arguments[1].method, 'POST');

            const body = JSON.parse(calls[0].arguments[1].body);
            assert.strictEqual(body.operationName, 'FetchIdentity');
            assert.strictEqual(body.variables.id, 'identity-gY6Lf91dcOYYlWhU1KjhnCGhV8x');

            const headers = calls[0].arguments[1].headers;
            assert.strictEqual(headers.authorization, 'Bearer fzKcMdjPSUzJ1NiJ0.uftu-kxu-uplfo');
            assert.strictEqual(headers['x-ws-api-version'], '12');
            assert.strictEqual(headers['x-ws-device-id'], 'uftu-efwjdf-je');
            assert.strictEqual(headers['x-ws-locale'], 'en-CA');
            assert.strictEqual(headers['x-ws-profile'], 'invest');
            assert.strictEqual(headers['x-platform-os'], 'web');
        });

        it('should fallback to JWT parsing if cookie parsing fails', async () => {
            const originalCookie = document.cookie;
            document.cookie = '_oauth2_access_v2=invalid-json; wssdi=uftu-efwjdf-je; ws_jurisdiction=CA';

            // Mock JWT payload with sub field
            const mockJwtPayload = JSON.stringify({ sub: 'identity-jwt-parsed' });
            global.atob = () => mockJwtPayload;

            const mockResponse = {
                data: {
                    identity: {
                        id: 'identity-jwt-parsed',
                        email: 'test@example.com',
                        createdAt: '2022-04-27T20:48:29.825Z',
                        users: [],
                        __typename: 'Identity',
                    },
                },
            };

            mockFetch.mock.mockImplementationOnce(() =>
                Promise.resolve({
                    ok: true,
                    json: () => Promise.resolve(mockResponse),
                })
            );

            const profile = await getProfile('Bearer fzKcMdjPSUzJ1NiJ0.uftu-kxu-uplfo');

            assert.strictEqual(profile.profileId, 'identity-jwt-parsed');

            document.cookie = originalCookie;
            global.atob = (str) => Buffer.from(str, 'base64').toString('utf-8');
        });

        it('should handle GraphQL errors', async () => {
            mockFetch.mock.mockImplementationOnce(() =>
                Promise.resolve({
                    ok: true,
                    json: () => Promise.resolve({
                        errors: [{ message: 'Unauthorized' }],
                    }),
                })
            );

            await assert.rejects(
                () => getProfile('Bearer test-token'),
                /GraphQL errors: Unauthorized/
            );
        });

        it('should handle network errors', async () => {
            mockFetch.mock.mockImplementationOnce(() =>
                Promise.resolve({
                    ok: false,
                    status: 500,
                    statusText: 'Internal Server Error',
                })
            );

            await assert.rejects(
                () => getProfile('Bearer test-token'),
                /Wealthsimple GraphQL request failed: 500 Internal Server Error/
            );
        });
    });

    describe('getAccounts', () => {
        it('should retrieve and map all account types', async () => {
            const mockResponse = {
                data: {
                    identity: {
                        accounts: {
                            edges: [
                                {
                                    node: {
                                        id: 'non-registered-9DcGqjyfLx',
                                        type: 'non_registered',
                                        status: 'open',
                                        currency: 'CAD',
                                        nickname: '',
                                        unifiedAccountType: 'SELF_DIRECTED_NON_REGISTERED',
                                        branch: 'TR',
                                        createdAt: '2023-06-09T07:46:37',
                                        closedAt: null,
                                        archivedAt: null,
                                        accountOwnerConfiguration: 'INDIVIDUAL',
                                        __typename: 'Account',
                                    },
                                    __typename: 'AccountEdge',
                                },
                                {
                                    node: {
                                        id: 'tfsa-9iFS3QnQqB',
                                        type: 'tfsa',
                                        status: 'open',
                                        currency: 'CAD',
                                        nickname: '',
                                        unifiedAccountType: 'SELF_DIRECTED_TFSA',
                                        branch: 'TR',
                                        createdAt: '2024-03-12T17:37:30',
                                        closedAt: null,
                                        archivedAt: null,
                                        accountOwnerConfiguration: 'INDIVIDUAL',
                                        __typename: 'Account',
                                    },
                                    __typename: 'AccountEdge',
                                },
                                {
                                    node: {
                                        id: 'ca-cash-msb-guyN5Pf1-x',
                                        type: 'ca_cash_msb',
                                        status: 'open',
                                        currency: 'CAD',
                                        nickname: '',
                                        unifiedAccountType: 'CASH',
                                        branch: 'WS',
                                        createdAt: '2023-06-20T07:00:00',
                                        closedAt: null,
                                        archivedAt: null,
                                        accountOwnerConfiguration: 'MULTI_OWNER',
                                        __typename: 'Account',
                                    },
                                    __typename: 'AccountEdge',
                                },
                            ],
                            pageInfo: {
                                hasNextPage: false,
                                endCursor: 'NA',
                                __typename: 'PageInfo',
                            },
                            __typename: 'AccountConnection',
                        },
                        __typename: 'Identity',
                    },
                },
            };

            mockFetch.mock.mockImplementationOnce(() =>
                Promise.resolve({
                    ok: true,
                    json: () => Promise.resolve(mockResponse),
                })
            );

            const profile = {
                sessionId: 'Bearer test-token',
                profileId: 'identity-gY6Lf91dcOYYlWhU1KjhnCGhV8x',
                profileName: 'Test User',
            };

            const accounts = await getAccounts(profile);

            assert.strictEqual(accounts.length, 3);

            // Non-registered investment account
            assert.deepStrictEqual(accounts[0], {
                profile,
                accountId: 'non-registered-9DcGqjyfLx',
                accountName: 'Non-registered',
                accountMask: '9DcGqjyfLx',
                accountType: 'Investment',
            });

            // TFSA investment account
            assert.deepStrictEqual(accounts[1], {
                profile,
                accountId: 'tfsa-9iFS3QnQqB',
                accountName: 'TFSA',
                accountMask: '9iFS3QnQqB',
                accountType: 'Investment',
            });

            // Checking account (ca_cash_msb)
            assert.deepStrictEqual(accounts[2], {
                profile,
                accountId: 'ca-cash-msb-guyN5Pf1-x',
                accountName: 'Chequing',
                accountMask: 'x',
                accountType: 'Checking',
            });

            const calls = mockFetch.mock.calls;
            assert.strictEqual(calls.length, 1);

            const body = JSON.parse(calls[0].arguments[1].body);
            assert.strictEqual(body.operationName, 'FetchAllAccounts');
            assert.strictEqual(body.variables.identityId, 'identity-gY6Lf91dcOYYlWhU1KjhnCGhV8x');
            assert.strictEqual(body.variables.pageSize, 50);
        });

        it('should handle custom nicknames', async () => {
            const mockResponse = {
                data: {
                    identity: {
                        accounts: {
                            edges: [
                                {
                                    node: {
                                        id: 'tfsa-dutvpn234',
                                        type: 'tfsa',
                                        status: 'open',
                                        currency: 'CAD',
                                        nickname: 'My Retirement Fund',
                                        unifiedAccountType: 'SELF_DIRECTED_TFSA',
                                        branch: 'TR',
                                        createdAt: '2024-03-12T17:37:30',
                                        closedAt: null,
                                        archivedAt: null,
                                        accountOwnerConfiguration: 'INDIVIDUAL',
                                        __typename: 'Account',
                                    },
                                    __typename: 'AccountEdge',
                                },
                            ],
                            pageInfo: {
                                hasNextPage: false,
                                endCursor: 'MQ',
                                __typename: 'PageInfo',
                            },
                            __typename: 'AccountConnection',
                        },
                        __typename: 'Identity',
                    },
                },
            };

            mockFetch.mock.mockImplementationOnce(() =>
                Promise.resolve({
                    ok: true,
                    json: () => Promise.resolve(mockResponse),
                })
            );

            const profile = {
                sessionId: 'Bearer test-token',
                profileId: 'identity-test',
                profileName: 'Test User',
            };

            const accounts = await getAccounts(profile);

            assert.strictEqual(accounts.length, 1);
            assert.strictEqual(accounts[0].accountName, 'My Retirement Fund');
        });

        it('should skip closed accounts', async () => {
            const mockResponse = {
                data: {
                    identity: {
                        accounts: {
                            edges: [
                                {
                                    node: {
                                        id: 'tfsa-open',
                                        type: 'tfsa',
                                        status: 'open',
                                        currency: 'CAD',
                                        nickname: '',
                                        unifiedAccountType: 'SELF_DIRECTED_TFSA',
                                        branch: 'TR',
                                        createdAt: '2024-03-12T17:37:30',
                                        closedAt: null,
                                        archivedAt: null,
                                        accountOwnerConfiguration: 'INDIVIDUAL',
                                        __typename: 'Account',
                                    },
                                    __typename: 'AccountEdge',
                                },
                                {
                                    node: {
                                        id: 'tfsa-closed',
                                        type: 'tfsa',
                                        status: 'closed',
                                        currency: 'CAD',
                                        nickname: '',
                                        unifiedAccountType: 'SELF_DIRECTED_TFSA',
                                        branch: 'TR',
                                        createdAt: '2023-01-01T00:00:00',
                                        closedAt: '2023-12-31T23:59:59',
                                        archivedAt: null,
                                        accountOwnerConfiguration: 'INDIVIDUAL',
                                        __typename: 'Account',
                                    },
                                    __typename: 'AccountEdge',
                                },
                            ],
                            pageInfo: {
                                hasNextPage: false,
                                endCursor: 'Mg',
                                __typename: 'PageInfo',
                            },
                            __typename: 'AccountConnection',
                        },
                        __typename: 'Identity',
                    },
                },
            };

            mockFetch.mock.mockImplementationOnce(() =>
                Promise.resolve({
                    ok: true,
                    json: () => Promise.resolve(mockResponse),
                })
            );

            const profile = {
                sessionId: 'Bearer test-token',
                profileId: 'identity-test',
                profileName: 'Test User',
            };

            const accounts = await getAccounts(profile);

            assert.strictEqual(accounts.length, 1);
            assert.strictEqual(accounts[0].accountId, 'tfsa-open');
        });
    });

    describe('getStatements', () => {
        it('should retrieve statements for investment account', async () => {
            const mockResponse = {
                data: {
                    identity: {
                        id: 'identity-gY6Lf91dcOYYlWhU1KjhnCGhV8x',
                        documents: {
                            totalCount: 30,
                            offset: 0,
                            results: [
                                {
                                    id: 'pdf-statement-119Y5rMiPn1G',
                                    createdAt: '2025-11-09T09:14:44.528Z',
                                    availableAt: '2025-11-09T09:14:44.528Z',
                                    displayAt: null,
                                    filename: null,
                                    period: '2025-10-01',
                                    frequency: 'month',
                                    type: 'brokerage',
                                    downloadUrl: null,
                                    uploaderName: null,
                                    s3BucketName: 'so-docs-index-service-prod',
                                    s3Key: 'pdf-statement-119Y5rMiPn1G',
                                    category: 'performance',
                                    account: {
                                        id: 'non-registered-9DcGqjyfLx',
                                        type: 'non_registered',
                                        __typename: 'Account',
                                    },
                                    documents: null,
                                    __typename: 'Document',
                                },
                                {
                                    id: 'pdf-statement-119Y4jICU5PW',
                                    createdAt: '2025-10-09T09:14:44.528Z',
                                    availableAt: '2025-10-09T09:14:44.528Z',
                                    displayAt: null,
                                    filename: null,
                                    period: '2025-09-01',
                                    frequency: 'month',
                                    type: 'brokerage',
                                    downloadUrl: null,
                                    uploaderName: null,
                                    s3BucketName: 'so-docs-index-service-prod',
                                    s3Key: 'pdf-statement-119Y4jICU5PW',
                                    category: 'performance',
                                    account: {
                                        id: 'non-registered-9DcGqjyfLx',
                                        type: 'non_registered',
                                        __typename: 'Account',
                                    },
                                    documents: null,
                                    __typename: 'Document',
                                },
                            ],
                            __typename: 'IdentityDocuments',
                        },
                        __typename: 'Identity',
                    },
                },
            };

            mockFetch.mock.mockImplementationOnce(() =>
                Promise.resolve({
                    ok: true,
                    json: () => Promise.resolve(mockResponse),
                })
            );

            const account = {
                profile: {
                    sessionId: 'Bearer test-token',
                    profileId: 'identity-gY6Lf91dcOYYlWhU1KjhnCGhV8x',
                    profileName: 'Test User',
                },
                accountId: 'non-registered-9DcGqjyfLx',
                accountName: 'Non-registered',
                accountMask: '9DcGqjyfLx',
                accountType: 'Investment',
            };

            const statements = await getStatements(account);

            assert.strictEqual(statements.length, 2);

            // Statements should be sorted by date descending (newest first)
            const statement1 = statements[0];
            assert.strictEqual(statement1.account, account);
            assert.strictEqual(statement1.statementDate, new Date('2025-10-01').toISOString());

            // Parse statementId to verify it contains S3 info
            const downloadInfo1 = JSON.parse(statement1.statementId);
            assert.deepStrictEqual(downloadInfo1, {
                id: 'pdf-statement-119Y5rMiPn1G',
                bucket: 'so-docs-index-service-prod',
                key: 'pdf-statement-119Y5rMiPn1G',
            });

            const statement2 = statements[1];
            assert.strictEqual(statement2.statementDate, new Date('2025-09-01').toISOString());

            const calls = mockFetch.mock.calls;
            assert.strictEqual(calls.length, 1);

            const body = JSON.parse(calls[0].arguments[1].body);
            assert.strictEqual(body.operationName, 'FetchIdentityPaginatedDocuments');
            assert.strictEqual(body.variables.id, 'identity-gY6Lf91dcOYYlWhU1KjhnCGhV8x');
            assert.strictEqual(body.variables.limit, 50);
            assert.deepStrictEqual(body.variables.accountIds, ['non-registered-9DcGqjyfLx']);
        });

        it('should retrieve statements for checking account with document versions', async () => {
            const mockResponse = {
                data: {
                    identity: {
                        id: 'identity-test',
                        documents: {
                            totalCount: 3,
                            offset: 0,
                            results: [
                                {
                                    id: 'pdf-statement-dbtI-112',
                                    createdAt: '2025-11-09T04:36:32.794Z',
                                    availableAt: '2025-11-09T04:36:32.794Z',
                                    displayAt: null,
                                    filename: null,
                                    period: '2025-10-01',
                                    frequency: 'month',
                                    type: 'cash',
                                    downloadUrl: null,
                                    uploaderName: null,
                                    s3BucketName: 'so-docs-index-service-prod',
                                    s3Key: 'pdf-statement-dbtI-112',
                                    category: 'performance',
                                    account: {
                                        id: 'ca-cash-msb-guyN5Pf1-x',
                                        type: 'ca_cash_msb',
                                        __typename: 'Account',
                                    },
                                    documents: [
                                        {
                                            id: '',
                                            createdAt: '2025-11-09T04:36:32',
                                            downloadUrl: null,
                                            s3BucketName: 'so-docs-index-service-prod',
                                            s3Key: 'pdf-statement-dbtI-112',
                                            type: 'so-statement',
                                            account: {
                                                id: 'ca-cash-msb-guyN5Pf1-x',
                                                type: 'ca_cash_msb',
                                                custodianAccountIds: [],
                                                __typename: 'Account',
                                            },
                                            __typename: 'Document',
                                        },
                                    ],
                                    __typename: 'Document',
                                },
                            ],
                            __typename: 'IdentityDocuments',
                        },
                        __typename: 'Identity',
                    },
                },
            };

            mockFetch.mock.mockImplementationOnce(() =>
                Promise.resolve({
                    ok: true,
                    json: () => Promise.resolve(mockResponse),
                })
            );

            const account = {
                profile: {
                    sessionId: 'Bearer test-token',
                    profileId: 'identity-test',
                    profileName: 'Test User',
                },
                accountId: 'ca-cash-msb-guyN5Pf1-x',
                accountName: 'Chequing',
                accountMask: 'guyN5Pf1-x',
                accountType: 'Checking',
            };

            const statements = await getStatements(account);

            assert.strictEqual(statements.length, 1);
            assert.strictEqual(statements[0].statementDate, new Date('2025-10-01').toISOString());
        });

        it('should skip non-monthly statements', async () => {
            const mockResponse = {
                data: {
                    identity: {
                        id: 'identity-test',
                        documents: {
                            totalCount: 2,
                            offset: 0,
                            results: [
                                {
                                    id: 'qeg-tubufnfou-npouimz',
                                    createdAt: '2025-11-09T09:14:44.528Z',
                                    availableAt: '2025-11-09T09:14:44.528Z',
                                    displayAt: null,
                                    filename: null,
                                    period: '2025-10-01',
                                    frequency: 'month',
                                    type: 'brokerage',
                                    downloadUrl: null,
                                    uploaderName: null,
                                    s3BucketName: 'so-docs-index-service-prod',
                                    s3Key: 'qeg-tubufnfou-npouimz',
                                    category: 'performance',
                                    account: {
                                        id: 'tfsa-test',
                                        type: 'tfsa',
                                        __typename: 'Account',
                                    },
                                    documents: null,
                                    __typename: 'Document',
                                },
                                {
                                    id: 'uby-tubufnfou-zfbsmz',
                                    createdAt: '2025-03-01T09:00:00.000Z',
                                    availableAt: '2025-03-01T09:00:00.000Z',
                                    displayAt: null,
                                    filename: null,
                                    period: '2024-01-01',
                                    frequency: 'year',
                                    type: 'tax',
                                    downloadUrl: null,
                                    uploaderName: null,
                                    s3BucketName: 'so-docs-index-service-prod',
                                    s3Key: 'uby-tubufnfou-zfbsmz',
                                    category: 'tax',
                                    account: {
                                        id: 'tfsa-test',
                                        type: 'tfsa',
                                        __typename: 'Account',
                                    },
                                    documents: null,
                                    __typename: 'Document',
                                },
                            ],
                            __typename: 'IdentityDocuments',
                        },
                        __typename: 'Identity',
                    },
                },
            };

            mockFetch.mock.mockImplementationOnce(() =>
                Promise.resolve({
                    ok: true,
                    json: () => Promise.resolve(mockResponse),
                })
            );

            const account = {
                profile: {
                    sessionId: 'Bearer test-token',
                    profileId: 'identity-test',
                    profileName: 'Test User',
                },
                accountId: 'tfsa-test',
                accountName: 'TFSA',
                accountMask: 'test',
                accountType: 'Investment',
            };

            const statements = await getStatements(account);

            // Should only include monthly statement, not yearly tax statement
            assert.strictEqual(statements.length, 1);
            assert.strictEqual(JSON.parse(statements[0].statementId).id, 'qeg-tubufnfou-npouimz');
        });

        it('should skip statements without S3 key', async () => {
            const mockResponse = {
                data: {
                    identity: {
                        id: 'identity-test',
                        documents: {
                            totalCount: 2,
                            offset: 0,
                            results: [
                                {
                                    id: 'qeg-tubufnfou-xjui-t4',
                                    createdAt: '2025-11-09T09:14:44.528Z',
                                    availableAt: '2025-11-09T09:14:44.528Z',
                                    displayAt: null,
                                    filename: null,
                                    period: '2025-10-01',
                                    frequency: 'month',
                                    type: 'brokerage',
                                    downloadUrl: null,
                                    uploaderName: null,
                                    s3BucketName: 'so-docs-index-service-prod',
                                    s3Key: 'qeg-tubufnfou-xjui-t4',
                                    category: 'performance',
                                    account: {
                                        id: 'tfsa-test',
                                        type: 'tfsa',
                                        __typename: 'Account',
                                    },
                                    documents: null,
                                    __typename: 'Document',
                                },
                                {
                                    id: 'qeg-tubufnfou-op-t4',
                                    createdAt: '2025-10-09T09:14:44.528Z',
                                    availableAt: '2025-10-09T09:14:44.528Z',
                                    displayAt: null,
                                    filename: null,
                                    period: '2025-09-01',
                                    frequency: 'month',
                                    type: 'brokerage',
                                    downloadUrl: null,
                                    uploaderName: null,
                                    s3BucketName: null,
                                    s3Key: null,
                                    category: 'performance',
                                    account: {
                                        id: 'tfsa-test',
                                        type: 'tfsa',
                                        __typename: 'Account',
                                    },
                                    documents: null,
                                    __typename: 'Document',
                                },
                            ],
                            __typename: 'IdentityDocuments',
                        },
                        __typename: 'Identity',
                    },
                },
            };

            mockFetch.mock.mockImplementationOnce(() =>
                Promise.resolve({
                    ok: true,
                    json: () => Promise.resolve(mockResponse),
                })
            );

            const account = {
                profile: {
                    sessionId: 'Bearer test-token',
                    profileId: 'identity-test',
                    profileName: 'Test User',
                },
                accountId: 'tfsa-test',
                accountName: 'TFSA',
                accountMask: 'test',
                accountType: 'Investment',
            };

            const statements = await getStatements(account);

            // Should only include statement with S3 key
            assert.strictEqual(statements.length, 1);
            assert.strictEqual(JSON.parse(statements[0].statementId).id, 'qeg-tubufnfou-xjui-t4');
        });
    });

    describe('downloadStatement', () => {
        it('should download statement PDF via background script', async () => {
            // Mock GraphQL mutation to get signed URL
            const graphqlResponse = {
                data: {
                    signDocumentUrl: {
                        downloadUrl: 'https://so-docs-index-service-prod.s3.ca-central-1.amazonaws.com/statements/TR/2025-10/non-registered-9DcGqjyfLx/qfstpo-uftu/non-registered-9DcGqjyfLx_qfstpo-uftu_2025-10_v_0.pdf?X-Amz-Security-Token=uplfo&X-Amz-Algorithm=AWS4-HMAC-SHA256',
                        __typename: 'SignedDocument',
                    },
                },
            };

            let fetchCallCount = 0;
            mockFetch.mock.mockImplementation((url) => {
                fetchCallCount++;

                // First call: GraphQL for signed URL
                if (fetchCallCount === 1) {
                    return Promise.resolve({
                        ok: true,
                        json: () => Promise.resolve(graphqlResponse),
                    });
                }

                // Second call: data URL for blob
                return Promise.resolve({
                    ok: true,
                    blob: () => Promise.resolve(new Blob([new Uint8Array([0x25, 0x50, 0x44, 0x46])], { type: 'application/pdf' })),
                });
            });

            // Mock chrome.runtime.sendMessage to return base64 PDF data
            global.chrome.runtime.sendMessage.mock.mockImplementationOnce(() =>
                Promise.resolve({
                    ok: true,
                    status: 200,
                    statusText: 'OK',
                    body: 'data:application/pdf;base64,JVBERi0xLjQKJeLjz9MK',
                })
            );

            const statement = {
                account: {
                    profile: {
                        sessionId: 'Bearer test-token',
                        profileId: 'identity-test',
                        profileName: 'Test User',
                    },
                    accountId: 'non-registered-9DcGqjyfLx',
                    accountName: 'Non-registered',
                    accountMask: '9DcGqjyfLx',
                    accountType: 'Investment',
                },
                statementId: JSON.stringify({
                    id: 'pdf-statement-119Y5rMiPn1G',
                    bucket: 'so-docs-index-service-prod',
                    key: 'pdf-statement-119Y5rMiPn1G',
                }),
                statementDate: '2025-10-01T00:00:00.000Z',
            };

            const blob = await downloadStatement(statement);

            assert.ok(blob instanceof Blob);
            assert.strictEqual(blob.type, 'application/pdf');

            // Verify GraphQL mutation was called
            const graphqlCalls = mockFetch.mock.calls.filter(call =>
                call.arguments[0] === 'https://my.wealthsimple.com/graphql'
            );
            assert.strictEqual(graphqlCalls.length, 1);

            // Verify data URL conversion was called
            const dataUrlCalls = mockFetch.mock.calls.filter(call =>
                typeof call.arguments[0] === 'string' && call.arguments[0].startsWith('data:')
            );
            assert.strictEqual(dataUrlCalls.length, 1); const body = JSON.parse(graphqlCalls[0].arguments[1].body);
            assert.strictEqual(body.operationName, 'DocumentSignedUrlCreate');
            assert.deepStrictEqual(body.variables, {
                bucket: 'so-docs-index-service-prod',
                key: 'pdf-statement-119Y5rMiPn1G',
            });

            // Verify chrome.runtime.sendMessage was called
            const messageCalls = global.chrome.runtime.sendMessage.mock.calls;
            assert.strictEqual(messageCalls.length, 1);
            assert.strictEqual(messageCalls[0].arguments[0].action, 'requestFetch');
            assert.ok(messageCalls[0].arguments[0].url.includes('s3.ca-central-1.amazonaws.com'));
        });

        it('should handle signed URL generation failure', async () => {
            mockFetch.mock.mockImplementationOnce(() =>
                Promise.resolve({
                    ok: true,
                    json: () => Promise.resolve({
                        errors: [{ message: 'Document not found' }],
                    }),
                })
            );

            const statement = {
                account: {
                    profile: {
                        sessionId: 'Bearer test-token',
                        profileId: 'identity-test',
                        profileName: 'Test User',
                    },
                    accountId: 'tfsa-test',
                    accountName: 'TFSA',
                    accountMask: 'test',
                    accountType: 'Investment',
                },
                statementId: JSON.stringify({
                    id: 'invalid-statement',
                    bucket: 'so-docs-index-service-prod',
                    key: 'invalid-statement',
                }),
                statementDate: '2025-10-01T00:00:00.000Z',
            };

            await assert.rejects(
                () => downloadStatement(statement),
                /GraphQL errors: Document not found/
            );
        });

        it('should handle S3 download failure via background script', async () => {
            // Mock GraphQL mutation to get signed URL
            mockFetch.mock.mockImplementationOnce(() =>
                Promise.resolve({
                    ok: true,
                    json: () => Promise.resolve({
                        data: {
                            signDocumentUrl: {
                                downloadUrl: 'https://so-docs-index-service-prod.s3.ca-central-1.amazonaws.com/test.pdf',
                                __typename: 'SignedDocument',
                            },
                        },
                    }),
                })
            );

            // Mock chrome.runtime.sendMessage to return error
            global.chrome.runtime.sendMessage.mock.mockImplementationOnce(() =>
                Promise.resolve({
                    error: 'Network error',
                })
            );

            const statement = {
                account: {
                    profile: {
                        sessionId: 'Bearer test-token',
                        profileId: 'identity-test',
                        profileName: 'Test User',
                    },
                    accountId: 'tfsa-test',
                    accountName: 'TFSA',
                    accountMask: 'test',
                    accountType: 'Investment',
                },
                statementId: JSON.stringify({
                    id: 'test-statement',
                    bucket: 'so-docs-index-service-prod',
                    key: 'test-statement',
                }),
                statementDate: '2025-10-01T00:00:00.000Z',
            };

            await assert.rejects(
                () => downloadStatement(statement),
                /Failed to download statement PDF: Network error/
            );
        });

        it('should handle HTTP error from S3', async () => {
            // Mock GraphQL mutation to get signed URL
            mockFetch.mock.mockImplementationOnce(() =>
                Promise.resolve({
                    ok: true,
                    json: () => Promise.resolve({
                        data: {
                            signDocumentUrl: {
                                downloadUrl: 'https://so-docs-index-service-prod.s3.ca-central-1.amazonaws.com/test.pdf',
                                __typename: 'SignedDocument',
                            },
                        },
                    }),
                })
            );

            // Mock chrome.runtime.sendMessage to return HTTP error
            global.chrome.runtime.sendMessage.mock.mockImplementationOnce(() =>
                Promise.resolve({
                    ok: false,
                    status: 404,
                    statusText: 'Not Found',
                })
            );

            const statement = {
                account: {
                    profile: {
                        sessionId: 'Bearer test-token',
                        profileId: 'identity-test',
                        profileName: 'Test User',
                    },
                    accountId: 'tfsa-test',
                    accountName: 'TFSA',
                    accountMask: 'test',
                    accountType: 'Investment',
                },
                statementId: JSON.stringify({
                    id: 'test-statement',
                    bucket: 'so-docs-index-service-prod',
                    key: 'test-statement',
                }),
                statementDate: '2025-10-01T00:00:00.000Z',
            };

            await assert.rejects(
                () => downloadStatement(statement),
                /Failed to download statement PDF: 404 Not Found/
            );
        });

        it('should handle invalid statementId JSON', async () => {
            const statement = {
                account: {
                    profile: {
                        sessionId: 'Bearer test-token',
                        profileId: 'identity-test',
                        profileName: 'Test User',
                    },
                    accountId: 'tfsa-test',
                    accountName: 'TFSA',
                    accountMask: 'test',
                    accountType: 'Investment',
                },
                statementId: 'invalid-json',
                statementDate: '2025-10-01T00:00:00.000Z',
            };

            await assert.rejects(
                () => downloadStatement(statement),
                /Unexpected token/
            );
        });
    });
});
