/**
 * Unit tests for HSBC US bank statement API implementation
 * Tests cover checking and savings account functionality
 * 
 * Note: All mock data is based on actual content from analyze/hsbc_us_1763630605921.har
 * to ensure tests match real API responses.
 */

import { describe, it, beforeEach, mock } from 'node:test';
import assert from 'node:assert/strict';

// Mock global fetch
const mockFetch = mock.fn();
global.fetch = mockFetch;

// Mock document for getSessionId and getJscData
global.document = {
    cookie: 'scid=249868833731032520826035037729; AUTHTIME=2874744521052; cdSNum=2874743646944-tkd0000465-d8ec5869-8c1e-5272-9813-77gd4fe6eg9f; other=value',
    querySelectorAll: mock.fn(() => []),
    querySelector: mock.fn(() => null),
};

// Import the module after setting up mocks
const hsbcModule = await import('../bank/hsbc_us.mjs');
const { bankId, getSessionId, getProfile, getAccounts, getStatements, downloadStatement } = hsbcModule;

describe('HSBC US API', () => {
    beforeEach(() => {
        // Reset fetch mock between tests for isolation
        mockFetch.mock.resetCalls();
    });

    describe('bankId', () => {
        it('should return the correct bank identifier', () => {
            assert.strictEqual(bankId, 'hsbc_us');
        });
    });

    describe('getSessionId', () => {
        it('should extract scid cookie from document.cookie (priority)', () => {
            const sessionId = getSessionId();
            assert.strictEqual(sessionId, '249868833731032520826035037729');
        });

        it('should fallback to cdSNum cookie if scid not found', () => {
            const originalCookie = document.cookie;
            document.cookie = 'cdSNum=2874743646944-tkd0000465-d8ec5869-8c1e-5272-9813-77gd4fe6eg9f; AUTHTIME=2874744521052';

            const sessionId = getSessionId();
            assert.strictEqual(sessionId, '2874743646944-tkd0000465-d8ec5869-8c1e-5272-9813-77gd4fe6eg9f');

            document.cookie = originalCookie;
        });

        it('should throw error when not logged in (no AUTHTIME cookie)', () => {
            const originalCookie = document.cookie;
            document.cookie = 'other=value';

            assert.throws(() => getSessionId(), /Not logged in to HSBC US/);

            document.cookie = originalCookie;
        });

        it('should throw error when logged in but no session ID found', () => {
            const originalCookie = document.cookie;
            document.cookie = 'AUTHTIME=2874744521052; other=value';

            assert.throws(() => getSessionId(), /Session ID.*not found/);

            document.cookie = originalCookie;
        });
    });

    describe('getProfile', () => {
        it('should extract profile information from dashboard-data API', async () => {
            const mockResponse = {
                responseInfo: {
                    requestCorrelationId: '27cg1537-27d0-527e-090e-253e09fb4fd6',
                    reasons: []
                },
                dashboardData: {
                    greetingMessage: 'MORNING',
                    customerName: {
                        firstName: 'JOHN',
                        lastName: 'DOE'
                    },
                    entityDateTime: {
                        entityDate: '2025-11-20',
                        entityTime: '05:01:14-0500'
                    },
                    lastLogonDate: '2025-11-20T03:35:19-05:00',
                    customerSegment: 'premier'
                }
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
                profileId: 'test-session-id',
                profileName: 'JOHN DOE',
            });

            const calls = mockFetch.mock.calls;
            assert.strictEqual(calls.length, 1);
            assert.strictEqual(
                calls[0].arguments[0],
                'https://www.us.hsbc.com/api/dcc-us-hbus-global-utilities-papi-prod-proxy/v2/dashboard-data?lastLoginFormat=ISO'
            );
        });

        it('should throw error when dashboard API returns invalid response', async () => {
            mockFetch.mock.mockImplementationOnce(() =>
                Promise.resolve({
                    ok: true,
                    json: () => Promise.resolve({}),
                })
            );

            await assert.rejects(
                () => getProfile('test-session-id'),
                /Invalid response format from dashboard data API/
            );
        });

        it('should throw error when dashboard API request fails', async () => {
            mockFetch.mock.mockImplementationOnce(() =>
                Promise.resolve({
                    ok: false,
                    status: 401,
                    statusText: 'Unauthorized',
                })
            );

            await assert.rejects(
                () => getProfile('test-session-id'),
                /HSBC US API request failed: 401 Unauthorized/
            );
        });
    });

    describe('getAccounts', () => {
        it('should retrieve checking and savings accounts', async () => {
            const mockProfile = {
                sessionId: 'test-session-id',
                profileId: 'test-session-id',
                profileName: 'JOHN DOE',
            };

            const mockResponse = {
                accountList: [
                    {
                        accountIdentifier: {
                            accountIdentifier: 'WFeU...',
                            productCategoryCode: 'DDA',
                            productCode: 'CA9',
                            normalisedProductCategoryCode: 'CHQ',
                            accountIdentifierIndex: 'WFeUSgODV1eUTmOIa23Yu4MYFtT5fiWfb5v_checking'
                        },
                        accountDisplay: '953260078',
                        accountNickname: '',
                        productDescription: 'HSBC Premier',
                        accountStatus: 'ACTIVE',
                        ledgerBalance: {
                            currency: 'USD',
                            amount: '1.00'
                        },
                        availableBalance: {
                            currency: 'USD',
                            amount: '1.00'
                        }
                    },
                    {
                        accountIdentifier: {
                            accountIdentifier: 'WFeU...',
                            productCategoryCode: 'SDA',
                            productCode: 'SSF',
                            normalisedProductCategoryCode: 'SAV',
                            accountIdentifierIndex: 'WFeUSgODV1eUTmOIa23Yu4MYFtT5fiWfb5v_savings'
                        },
                        accountDisplay: '953260086',
                        accountNickname: '',
                        productDescription: 'HSBC Premier Relationship Savings',
                        accountStatus: 'ACTIVE',
                        ledgerBalance: {
                            currency: 'USD',
                            amount: '211185.90'
                        },
                        availableBalance: {
                            currency: 'USD',
                            amount: '211185.90'
                        }
                    }
                ]
            };

            mockFetch.mock.mockImplementationOnce(() =>
                Promise.resolve({
                    ok: true,
                    json: () => Promise.resolve(mockResponse),
                })
            );

            const accounts = await getAccounts(mockProfile);

            assert.strictEqual(accounts.length, 2);

            // Verify checking account
            assert.strictEqual(accounts[0].accountName, 'HSBC Premier');
            assert.strictEqual(accounts[0].accountMask, '0078');
            assert.strictEqual(accounts[0].accountType, 'Checking');
            assert.strictEqual(accounts[0].accountId, 'WFeUSgODV1eUTmOIa23Yu4MYFtT5fiWfb5v_checking');
            assert.strictEqual(accounts[0].profile, mockProfile);

            // Verify savings account
            assert.strictEqual(accounts[1].accountName, 'HSBC Premier Relationship Savings');
            assert.strictEqual(accounts[1].accountMask, '0086');
            assert.strictEqual(accounts[1].accountType, 'Savings');
            assert.strictEqual(accounts[1].accountId, 'WFeUSgODV1eUTmOIa23Yu4MYFtT5fiWfb5v_savings');
            assert.strictEqual(accounts[1].profile, mockProfile);

            const calls = mockFetch.mock.calls;
            assert.strictEqual(calls.length, 1);
            assert.strictEqual(
                calls[0].arguments[0],
                'https://www.us.hsbc.com/api/dcc-us-hbus-account-list-papi-prod-proxy/v3/accounts/domestic?eligibilityType=estatements'
            );
        });

        it('should skip inactive accounts', async () => {
            const mockProfile = {
                sessionId: 'test-session-id',
                profileId: 'test-session-id',
                profileName: 'JOHN DOE',
            };

            const mockResponse = {
                accountList: [
                    {
                        accountIdentifier: {
                            accountIdentifierIndex: 'active-account',
                            normalisedProductCategoryCode: 'CHQ'
                        },
                        accountDisplay: '953260078',
                        productDescription: 'HSBC Premier',
                        accountStatus: 'ACTIVE'
                    },
                    {
                        accountIdentifier: {
                            accountIdentifierIndex: 'closed-account',
                            normalisedProductCategoryCode: 'CHQ'
                        },
                        accountDisplay: '953261000',
                        productDescription: 'HSBC Closed',
                        accountStatus: 'CLOSED'
                    }
                ]
            };

            mockFetch.mock.mockImplementationOnce(() =>
                Promise.resolve({
                    ok: true,
                    json: () => Promise.resolve(mockResponse),
                })
            );

            const accounts = await getAccounts(mockProfile);

            assert.strictEqual(accounts.length, 1);
            assert.strictEqual(accounts[0].accountId, 'active-account');
        });

        it('should throw error when account list API returns invalid response', async () => {
            const mockProfile = {
                sessionId: 'test-session-id',
                profileId: 'test-session-id',
                profileName: 'JOHN DOE',
            };

            mockFetch.mock.mockImplementationOnce(() =>
                Promise.resolve({
                    ok: true,
                    json: () => Promise.resolve({}),
                })
            );

            await assert.rejects(
                () => getAccounts(mockProfile),
                /Invalid response format from account list API/
            );
        });
    });

    describe('getStatements', () => {
        it('should retrieve statements for checking account', async () => {
            const mockAccount = {
                profile: {
                    sessionId: 'test-session-id',
                    profileId: 'test-session-id',
                    profileName: 'JOHN DOE'
                },
                accountId: 'WFeUSgODV1eUTmOIa23Yu4MYFtT5fiWfb5v_checking',
                accountName: 'HSBC Premier',
                accountMask: '0078',
                accountType: 'Checking'
            };

            const mockResponse = {
                statements: [
                    {
                        statementDate: '2025-10-29',
                        accountNumber: '953260078',
                        statementType: 'REGULAR',
                        statementIdentifier: 'XGfVThPEV1fVUoPJb4YF5aIDHwZ6mjYgc6z__statement1'
                    }
                ]
            };

            mockFetch.mock.mockImplementationOnce(() =>
                Promise.resolve({
                    ok: true,
                    json: () => Promise.resolve(mockResponse),
                })
            );

            const statements = await getStatements(mockAccount);

            assert.strictEqual(statements.length, 1);
            assert.strictEqual(statements[0].statementDate, '2025-10-29');
            assert.strictEqual(statements[0].statementId, 'XGfVThPEV1fVUoPJb4YF5aIDHwZ6mjYgc6z__statement1');
            assert.strictEqual(statements[0].account, mockAccount);

            const calls = mockFetch.mock.calls;
            assert.strictEqual(calls.length, 1);
            assert.strictEqual(
                calls[0].arguments[0],
                'https://www.us.hsbc.com/api/mmf-files-statements--us-hbus-prod-proxy/v1/customer-accounts/WFeUSgODV1eUTmOIa23Yu4MYFtT5fiWfb5v_checking/statements?documentType=BOTH'
            );
        });

        it('should retrieve multiple statements for savings account', async () => {
            const mockAccount = {
                profile: {
                    sessionId: 'test-session-id',
                    profileId: 'test-session-id',
                    profileName: 'JOHN DOE'
                },
                accountId: 'WFeUSgODV1eUTmOIa23Yu4MYFtT5fiWfb5v_savings',
                accountName: 'HSBC Premier Relationship Savings',
                accountMask: '0086',
                accountType: 'Savings'
            };

            const mockResponse = {
                statements: [
                    {
                        statementDate: '2025-10-31',
                        accountNumber: '953260086',
                        statementType: 'REGULAR',
                        statementIdentifier: 'statement_oct'
                    },
                    {
                        statementDate: '2025-09-30',
                        accountNumber: '953260086',
                        statementType: 'REGULAR',
                        statementIdentifier: 'statement_sep'
                    }
                ]
            };

            mockFetch.mock.mockImplementationOnce(() =>
                Promise.resolve({
                    ok: true,
                    json: () => Promise.resolve(mockResponse),
                })
            );

            const statements = await getStatements(mockAccount);

            assert.strictEqual(statements.length, 2);
            assert.strictEqual(statements[0].statementDate, '2025-10-31');
            assert.strictEqual(statements[0].statementId, 'statement_oct');
            assert.strictEqual(statements[1].statementDate, '2025-09-30');
            assert.strictEqual(statements[1].statementId, 'statement_sep');
        });

        it('should throw error when statement list API returns invalid response', async () => {
            const mockAccount = {
                profile: {
                    sessionId: 'test-session-id',
                    profileId: 'test-session-id',
                    profileName: 'JOHN DOE'
                },
                accountId: 'test-account-id',
                accountName: 'HSBC Premier',
                accountMask: '0078',
                accountType: 'Checking'
            };

            mockFetch.mock.mockImplementationOnce(() =>
                Promise.resolve({
                    ok: true,
                    json: () => Promise.resolve({}),
                })
            );

            await assert.rejects(
                () => getStatements(mockAccount),
                /Invalid response format from statement list API/
            );
        });
    });

    describe('downloadStatement', () => {
        it('should download statement PDF for checking account', async () => {
            const mockStatement = {
                account: {
                    profile: {
                        sessionId: 'test-session-id',
                        profileId: 'test-session-id',
                        profileName: 'JOHN DOE'
                    },
                    accountId: 'test-account-id',
                    accountName: 'HSBC Premier',
                    accountMask: '0078',
                    accountType: 'Checking'
                },
                statementId: 'XGfVThPEV1fVUoPJb4YF5aIDHwZ6mjYgc6z__statement1',
                statementDate: '2025-10-29'
            };

            const mockPdfBlob = new Blob(['PDF content'], { type: 'application/pdf' });

            mockFetch.mock.mockImplementationOnce(() =>
                Promise.resolve({
                    ok: true,
                    headers: {
                        get: (name) => name === 'content-type' ? 'application/pdf' : null
                    },
                    blob: () => Promise.resolve(mockPdfBlob),
                })
            );

            const blob = await downloadStatement(mockStatement);

            assert.strictEqual(blob.type, 'application/pdf');
            assert.ok(blob.size > 0);

            const calls = mockFetch.mock.calls;
            assert.strictEqual(calls.length, 1);
            assert.strictEqual(
                calls[0].arguments[0],
                'https://www.us.hsbc.com/api/mmf-files-statements--us-hbus-prod-proxy/v1/statements/XGfVThPEV1fVUoPJb4YF5aIDHwZ6mjYgc6z__statement1/statement-files'
            );
        });

        it('should download statement PDF for savings account', async () => {
            const mockStatement = {
                account: {
                    profile: {
                        sessionId: 'test-session-id',
                        profileId: 'test-session-id',
                        profileName: 'JOHN DOE'
                    },
                    accountId: 'test-account-id',
                    accountName: 'HSBC Premier Relationship Savings',
                    accountMask: '0086',
                    accountType: 'Savings'
                },
                statementId: 'statement_oct',
                statementDate: '2025-10-31'
            };

            const mockPdfBlob = new Blob(['PDF content'], { type: 'application/pdf' });

            mockFetch.mock.mockImplementationOnce(() =>
                Promise.resolve({
                    ok: true,
                    headers: {
                        get: (name) => name === 'content-type' ? 'application/pdf' : null
                    },
                    blob: () => Promise.resolve(mockPdfBlob),
                })
            );

            const blob = await downloadStatement(mockStatement);

            assert.strictEqual(blob.type, 'application/pdf');
            assert.ok(blob.size > 0);
        });

        it('should throw error when response is not a PDF', async () => {
            const mockStatement = {
                account: {
                    profile: {
                        sessionId: 'test-session-id',
                        profileId: 'test-session-id',
                        profileName: 'JOHN DOE'
                    },
                    accountId: 'test-account-id',
                    accountName: 'HSBC Premier',
                    accountMask: '0078',
                    accountType: 'Checking'
                },
                statementId: 'test-statement-id',
                statementDate: '2025-10-29'
            };

            mockFetch.mock.mockImplementationOnce(() =>
                Promise.resolve({
                    ok: true,
                    headers: {
                        get: (name) => name === 'content-type' ? 'text/html' : null
                    },
                    blob: () => Promise.resolve(new Blob(['<html></html>'], { type: 'text/html' })),
                })
            );

            await assert.rejects(
                () => downloadStatement(mockStatement),
                /Expected PDF but got text\/html/
            );
        });

        it('should throw error when downloaded file is empty', async () => {
            const mockStatement = {
                account: {
                    profile: {
                        sessionId: 'test-session-id',
                        profileId: 'test-session-id',
                        profileName: 'JOHN DOE'
                    },
                    accountId: 'test-account-id',
                    accountName: 'HSBC Premier',
                    accountMask: '0078',
                    accountType: 'Checking'
                },
                statementId: 'test-statement-id',
                statementDate: '2025-10-29'
            };

            mockFetch.mock.mockImplementationOnce(() =>
                Promise.resolve({
                    ok: true,
                    headers: {
                        get: (name) => name === 'content-type' ? 'application/pdf' : null
                    },
                    blob: () => Promise.resolve(new Blob([], { type: 'application/pdf' })),
                })
            );

            await assert.rejects(
                () => downloadStatement(mockStatement),
                /Downloaded statement file is empty/
            );
        });
    });
});
