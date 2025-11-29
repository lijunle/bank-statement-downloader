/**
 * Unit tests for BMO bank statement API implementation
 * Tests cover both checking and savings account functionality
 * 
 * Note: All mock data is based on actual content extracted from
 * analyze/bmo.har to ensure tests match real API responses.
 */

import { describe, it, beforeEach, mock } from 'node:test';
import assert from 'node:assert/strict';

// Mock global fetch
const mockFetch = mock.fn();
global.fetch = mockFetch;

// Mock document.cookie for getSessionId
global.document = {
    cookie: 'XSRF-TOKEN=test-xsrf-token-value; PMData=test-pmdata-value; other=value',
};

// Import the module after setting up mocks
const bmoModule = await import('../bank/bmo.mjs');
const { bankId, getSessionId, getProfile, getAccounts, getStatements, downloadStatement } = bmoModule;

describe('BMO API', () => {
    beforeEach(() => {
        mockFetch.mock.resetCalls();
    });

    describe('bankId', () => {
        it('should return the correct bank identifier', () => {
            assert.strictEqual(bankId, 'bmo');
        });
    });

    describe('getSessionId', () => {
        it('should extract XSRF-TOKEN from document.cookie', () => {
            const sessionId = getSessionId();
            assert.strictEqual(sessionId, 'test-xsrf-token-value');
        });

        it('should throw error when XSRF-TOKEN cookie is not found', () => {
            const originalCookie = document.cookie;
            document.cookie = 'other=value';

            assert.throws(() => getSessionId(), /XSRF-TOKEN cookie not found/);

            document.cookie = originalCookie;
        });
    });

    describe('getProfile', () => {
        it('should retrieve profile information from getMySummary', async () => {
            const mockResponse = {
                GetMySummaryRs: {
                    HdrRs: {
                        callStatus: 'Success',
                        hostName: 'bolbsccsbrcor01',
                        serverDate: '2025-11-12T09:28:25.770',
                        rqUID: 'REQ_06d8678684c4556d',
                        mfaDeviceToken: 'QNW7M06fR5MUeN9eLKQ8OTj3s7uOJSm9hHS%2FDtRgDrY%2FUdJvubS5q96K%2BhNh4zMo693ZxUIkE0Znr5wbtCuv8jzHz4QR%3D%3D',
                        mfaDeviceTokenExpire: 365,
                    },
                    BodyRs: {
                        credential: '6621301257354012',
                        firstName: 'JOHN',
                        lastName: 'DOE',
                        customerName: 'JOHN DOE',
                        role: 'BDC',
                        displayClassLimitFlag: 'Y',
                        lastSignInDate: '2025-11-16',
                        lastSignInTime: '9:13 AM EST',
                        categories: [],
                    },
                },
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
                profileId: '6621301257354012',
                profileName: 'JOHN DOE',
            });

            const calls = mockFetch.mock.calls;
            assert.strictEqual(calls.length, 1);
            assert.strictEqual(calls[0].arguments[0], 'https://www1.bmo.com/banking/services/mysummary/getMySummary');
            assert.strictEqual(calls[0].arguments[1].method, 'POST');
            assert.strictEqual(calls[0].arguments[1].headers['Content-Type'], 'application/json');
            assert.strictEqual(calls[0].arguments[1].headers['X-ChannelType'], 'OLB');

            const body = JSON.parse(calls[0].arguments[1].body);
            assert.strictEqual(body.MySummaryRq.HdrRq.ver, '1.0');
            assert.strictEqual(body.MySummaryRq.HdrRq.channelType, 'OLB');
            assert.strictEqual(body.MySummaryRq.BodyRq.refreshProfile, 'N');
        });

        it('should use firstName and lastName when customerName is not provided', async () => {
            const mockResponse = {
                GetMySummaryRs: {
                    HdrRs: { callStatus: 'Success' },
                    BodyRs: {
                        credential: '1234567890',
                        firstName: 'John',
                        lastName: 'Doe',
                        categories: [],
                    },
                },
            };

            mockFetch.mock.mockImplementationOnce(() =>
                Promise.resolve({
                    ok: true,
                    json: () => Promise.resolve(mockResponse),
                })
            );

            const profile = await getProfile('test-session');
            assert.strictEqual(profile.profileName, 'John Doe');
        });

        it('should throw error when API call fails', async () => {
            const mockResponse = {
                GetMySummaryRs: {
                    HdrRs: { callStatus: 'Failed', errorMessage: 'Test error' },
                },
            };

            mockFetch.mock.mockImplementationOnce(() =>
                Promise.resolve({
                    ok: true,
                    json: () => Promise.resolve(mockResponse),
                })
            );

            await assert.rejects(getProfile('test-session'), /Failed to get summary: Failed/);
        });
    });

    describe('getAccounts', () => {
        const mockProfile = {
            sessionId: 'test-session',
            profileId: 'test-profile',
            profileName: 'Test User',
        };

        it('should extract accounts with eStatement support', async () => {
            const mockResponse = {
                GetMySummaryRs: {
                    HdrRs: { callStatus: 'Success' },
                    BodyRs: {
                        credential: '6621301257354012',
                        firstName: 'JOHN',
                        lastName: 'DOE',
                        customerName: 'JOHN DOE',
                        categories: [
                            {
                                categoryName: 'BA',
                                groupHeadTitle: 'Bank Accounts',
                                products: [
                                    {
                                        accountType: 'BANK_ACCOUNT',
                                        productName: 'Chequing',
                                        ocifAccountName: 'Primary Chequing Account',
                                        menuOptions: 'VIEW_ESTATEMENTS,CHANGE_STATEMENT_OPTION',
                                        accountNumber: '1895 4905-784',
                                        currency: 'CAD',
                                        accountIndex: 0,
                                    },
                                    {
                                        accountType: 'BANK_ACCOUNT',
                                        productName: 'Savings',
                                        ocifAccountName: 'Savings Amplifier Account',
                                        menuOptions: 'VIEW_ESTATEMENTS,CHANGE_STATEMENT_OPTION',
                                        accountNumber: '1895 9982-110',
                                        currency: 'CAD',
                                        accountIndex: 1,
                                    },
                                ],
                            },
                            {
                                categoryName: 'CC',
                                groupHeadTitle: 'Credit Cards',
                                products: [],
                            },
                        ],
                    },
                },
            };

            mockFetch.mock.mockImplementationOnce(() =>
                Promise.resolve({
                    ok: true,
                    json: () => Promise.resolve(mockResponse),
                })
            );

            const accounts = await getAccounts(mockProfile);

            assert.strictEqual(accounts.length, 2);

            assert.deepStrictEqual(accounts[0], {
                profile: mockProfile,
                accountId: 'BA:0',
                accountName: 'Chequing',
                accountMask: '5784',
                accountType: 'Checking',
            });

            assert.deepStrictEqual(accounts[1], {
                profile: mockProfile,
                accountId: 'BA:1',
                accountName: 'Savings',
                accountMask: '2110',
                accountType: 'Savings',
            });
        });

        it('should skip accounts without eStatement support', async () => {
            const mockResponse = {
                GetMySummaryRs: {
                    HdrRs: { callStatus: 'Success' },
                    BodyRs: {
                        credential: '6621301257354012',
                        categories: [
                            {
                                categoryName: 'BA',
                                products: [
                                    {
                                        productName: 'Chequing',
                                        menuOptions: 'SOME_OTHER_OPTION',
                                        accountNumber: '1895 4905-784',
                                        accountIndex: 0,
                                    },
                                ],
                            },
                        ],
                    },
                },
            };

            mockFetch.mock.mockImplementationOnce(() =>
                Promise.resolve({
                    ok: true,
                    json: () => Promise.resolve(mockResponse),
                })
            );

            const accounts = await getAccounts(mockProfile);

            assert.strictEqual(accounts.length, 0);
        });

        it('should correctly map account types', async () => {
            const mockResponse = {
                GetMySummaryRs: {
                    HdrRs: { callStatus: 'Success' },
                    BodyRs: {
                        credential: 'test',
                        categories: [
                            {
                                categoryName: 'BA',
                                products: [
                                    {
                                        productName: 'Chequing',
                                        menuOptions: 'VIEW_ESTATEMENTS',
                                        accountNumber: '1234',
                                        accountIndex: 0,
                                    },
                                    {
                                        productName: 'Savings',
                                        menuOptions: 'VIEW_ESTATEMENTS',
                                        accountNumber: '5678',
                                        accountIndex: 1,
                                    },
                                ],
                            },
                            {
                                categoryName: 'CC',
                                products: [
                                    {
                                        productName: 'Credit Card',
                                        menuOptions: 'VIEW_ESTATEMENTS',
                                        accountNumber: '9999',
                                        accountIndex: 0,
                                    },
                                ],
                            },
                            {
                                categoryName: 'LM',
                                products: [
                                    {
                                        productName: 'Mortgage',
                                        menuOptions: 'VIEW_ESTATEMENTS',
                                        accountNumber: '1111',
                                        accountIndex: 0,
                                    },
                                ],
                            },
                            {
                                categoryName: 'IN',
                                products: [
                                    {
                                        productName: 'Investment',
                                        menuOptions: 'VIEW_ESTATEMENTS',
                                        accountNumber: '2222',
                                        accountIndex: 0,
                                    },
                                ],
                            },
                        ],
                    },
                },
            };

            mockFetch.mock.mockImplementationOnce(() =>
                Promise.resolve({
                    ok: true,
                    json: () => Promise.resolve(mockResponse),
                })
            );

            const accounts = await getAccounts(mockProfile);

            assert.strictEqual(accounts.length, 5);
            assert.strictEqual(accounts[0].accountType, 'Checking');
            assert.strictEqual(accounts[1].accountType, 'Savings');
            assert.strictEqual(accounts[2].accountType, 'CreditCard');
            assert.strictEqual(accounts[3].accountType, 'Loan');
            assert.strictEqual(accounts[4].accountType, 'Investment');
        });
    });

    describe('getStatements', () => {
        const mockAccount = {
            profile: { sessionId: 'test', profileId: 'test', profileName: 'Test' },
            accountId: 'BA:0',
            accountName: 'Chequing',
            accountMask: '4673',
            accountType: 'Checking',
        };

        it('should retrieve statements for an account', async () => {
            const mockEncryptedResponse = {
                GetEStatementsEncryptedDataRs: {
                    HdrRs: { callStatus: 'Success' },
                    BodyRs: {
                        introduction: 'View and save your eStatements by selecting a time period or date range.',
                        isConsolidated: 'N',
                        isAnnualStatement: 'N',
                        mainAccount: {
                            name: 'Chequing',
                            number: '1895 4905-784',
                        },
                        ecryptedData: 'e768f838a7dga40663d40e87c3b4c35619c501ec1941dgc0ge1d1279997564d78c683133b8fbd1673d3195d0g4cc83766g92f3f4b67306d611fa03e02df9b43cgc4fc6d4996177c5c374733ef27f11ef99',
                    },
                },
            };

            const mockStatementListResponse = {
                eDocuments: [
                    {
                        date: '2025-10-17',
                        dummyParams: '2ff7b03b-b4de-5b8e-0gf2-ff8cbfc4ecc0',
                        token: '213382603570921',
                        econfirmation: 'false',
                    },
                    {
                        date: '2025-09-18',
                        dummyParams: 'ee030572-gf50-51d6-b1c2-3747e4g86bg7',
                        token: '213382603570921',
                        econfirmation: 'false',
                    },
                    {
                        date: '2025-08-18',
                        dummyParams: 'e261ccdb-1844-5330-9203-9415becde69d2',
                        token: '213382603570921',
                        econfirmation: 'false',
                    },
                ],
            };

            let callCount = 0;
            mockFetch.mock.mockImplementation(() => {
                callCount++;
                if (callCount === 1) {
                    return Promise.resolve({
                        ok: true,
                        json: () => Promise.resolve(mockEncryptedResponse),
                    });
                } else {
                    return Promise.resolve({
                        ok: true,
                        json: () => Promise.resolve(mockStatementListResponse),
                    });
                }
            });

            const statements = await getStatements(mockAccount);

            assert.strictEqual(statements.length, 3);
            assert.strictEqual(statements[0].account, mockAccount);
            assert.strictEqual(statements[0].statementDate, new Date('2025-10-17').toISOString());

            const parsedId = JSON.parse(statements[0].statementId);
            assert.strictEqual(parsedId.dummyParams, '2ff7b03b-b4de-5b8e-0gf2-ff8cbfc4ecc0');
            assert.strictEqual(parsedId.token, '213382603570921');

            // Verify API calls
            const calls = mockFetch.mock.calls;
            assert.strictEqual(calls.length, 2);

            // First call: getEStatementsEncryptedData
            assert.strictEqual(calls[0].arguments[0], 'https://www1.bmo.com/banking/services/estatements/getEStatementsEncryptedData');
            assert.strictEqual(calls[0].arguments[1].method, 'POST');
            const body1 = JSON.parse(calls[0].arguments[1].body);
            assert.strictEqual(body1.EStatementsEncryptedDataRq.BodyRq.acctType, 'BA');
            assert.strictEqual(body1.EStatementsEncryptedDataRq.BodyRq.inquiryAccountIndex, 0);

            // Second call: getEDocumentsJSONList
            assert.ok(calls[1].arguments[0].includes('/WebContentManager/getEDocumentsJSONList?encrypted_data='));
            assert.strictEqual(calls[1].arguments[1].method, 'GET');
        });

        it('should handle empty statement list', async () => {
            const mockEncryptedResponse = {
                GetEStatementsEncryptedDataRs: {
                    HdrRs: { callStatus: 'Success' },
                    BodyRs: {
                        ecryptedData: 'uftu-fodszqufe-ebub',
                    },
                },
            };

            const mockStatementListResponse = {
                eDocuments: [],
            };

            let callCount = 0;
            mockFetch.mock.mockImplementation(() => {
                callCount++;
                if (callCount === 1) {
                    return Promise.resolve({
                        ok: true,
                        json: () => Promise.resolve(mockEncryptedResponse),
                    });
                } else {
                    return Promise.resolve({
                        ok: true,
                        json: () => Promise.resolve(mockStatementListResponse),
                    });
                }
            });

            const statements = await getStatements(mockAccount);

            assert.strictEqual(statements.length, 0);
        });

        it('should throw error when encrypted data call fails', async () => {
            const mockResponse = {
                GetEStatementsEncryptedDataRs: {
                    HdrRs: { callStatus: 'Failed' },
                },
            };

            mockFetch.mock.mockImplementationOnce(() =>
                Promise.resolve({
                    ok: true,
                    json: () => Promise.resolve(mockResponse),
                })
            );

            await assert.rejects(getStatements(mockAccount), /Failed to get encrypted statement data/);
        });

        it('should throw error when encrypted data is missing', async () => {
            const mockResponse = {
                GetEStatementsEncryptedDataRs: {
                    HdrRs: { callStatus: 'Success' },
                    BodyRs: {},
                },
            };

            mockFetch.mock.mockImplementationOnce(() =>
                Promise.resolve({
                    ok: true,
                    json: () => Promise.resolve(mockResponse),
                })
            );

            await assert.rejects(getStatements(mockAccount), /No encrypted data returned from API/);
        });

        it('should parse savings account correctly', async () => {
            const savingsAccount = {
                ...mockAccount,
                accountId: 'BA:1',
                accountName: 'Savings',
                accountType: 'Savings',
            };

            const mockEncryptedResponse = {
                GetEStatementsEncryptedDataRs: {
                    HdrRs: { callStatus: 'Success' },
                    BodyRs: {
                        ecryptedData: 'uftu-fodszqufe-ebub-tbwjoht',
                    },
                },
            };

            const mockStatementListResponse = {
                eDocuments: [
                    {
                        date: '2025-10-17',
                        dummyParams: 'savings-statement-id',
                        token: '123456',
                        econfirmation: 'false',
                    },
                ],
            };

            let callCount = 0;
            mockFetch.mock.mockImplementation(() => {
                callCount++;
                if (callCount === 1) {
                    return Promise.resolve({
                        ok: true,
                        json: () => Promise.resolve(mockEncryptedResponse),
                    });
                } else {
                    return Promise.resolve({
                        ok: true,
                        json: () => Promise.resolve(mockStatementListResponse),
                    });
                }
            });

            const statements = await getStatements(savingsAccount);

            assert.strictEqual(statements.length, 1);
            assert.strictEqual(statements[0].account.accountType, 'Savings');

            // Verify accountIndex was parsed correctly
            const body = JSON.parse(mockFetch.mock.calls[0].arguments[1].body);
            assert.strictEqual(body.EStatementsEncryptedDataRq.BodyRq.inquiryAccountIndex, 1);
        });
    });

    describe('downloadStatement', () => {
        const mockAccount = {
            profile: { sessionId: 'test', profileId: 'test', profileName: 'Test' },
            accountId: 'BA:0',
            accountName: 'Chequing',
            accountMask: '5784',
            accountType: 'Checking',
        };

        const mockStatement = {
            account: mockAccount,
            statementId: JSON.stringify({
                dummyParams: '2ff7b03b-b4de-5b8e-0gf2-ff8cbfc4ecc0',
                token: '213382603570921',
            }),
            statementDate: new Date('2025-10-17'),
        };

        it('should download statement PDF', async () => {
            const mockPdfBlob = new Blob(['PDF content'], { type: 'application/pdf' });

            mockFetch.mock.mockImplementationOnce(() =>
                Promise.resolve({
                    ok: true,
                    blob: () => Promise.resolve(mockPdfBlob),
                })
            );

            const blob = await downloadStatement(mockStatement);

            assert.strictEqual(blob, mockPdfBlob);
            assert.ok(blob.size > 0);

            // Verify download API call
            const calls = mockFetch.mock.calls;
            assert.strictEqual(calls.length, 1);
            assert.ok(calls[0].arguments[0].includes('/WebContentManager/DownloadEStatementInPDFBOSServlet'));
            assert.ok(calls[0].arguments[0].includes('dummyParams=2ff7b03b-b4de-5b8e-0gf2-ff8cbfc4ecc0'));
            assert.ok(calls[0].arguments[0].includes('token=213382603570921'));
            assert.ok(calls[0].arguments[0].includes('econfirmation=false'));
            assert.strictEqual(calls[0].arguments[1].method, 'GET');
            assert.strictEqual(calls[0].arguments[1].headers['Accept'], 'application/pdf');
        });

        it('should throw error when download fails', async () => {
            mockFetch.mock.mockImplementationOnce(() =>
                Promise.resolve({
                    ok: false,
                    status: 404,
                    statusText: 'Not Found',
                })
            );

            await assert.rejects(downloadStatement(mockStatement), /Failed to download statement: 404 Not Found/);
        });
    });

    describe('Error Handling', () => {
        it('should throw error when fetch fails', async () => {
            mockFetch.mock.mockImplementationOnce(() =>
                Promise.resolve({
                    ok: false,
                    status: 401,
                    statusText: 'Unauthorized',
                })
            );

            await assert.rejects(getProfile('test-session'), /API request failed: 401 Unauthorized/);
        });

        it('should handle network errors', async () => {
            mockFetch.mock.mockImplementationOnce(() => Promise.reject(new Error('Network error')));

            await assert.rejects(getProfile('test-session'), /Network error/);
        });
    });
});
