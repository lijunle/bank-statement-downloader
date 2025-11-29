/**
 * Unit tests for Fidelity Investments bank statement API implementation
 * Tests cover brokerage/investment accounts and credit card functionality
 * 
 * Note: All mock data is based on actual content from analyze/fidelity_1763597495016.har
 * to ensure tests match real API responses.
 */

import { describe, it, beforeEach, mock } from 'node:test';
import assert from 'node:assert/strict';

// Mock global fetch
const mockFetch = mock.fn();
global.fetch = mockFetch;

// Mock document.cookie for getSessionId
global.document = {
    cookie: 'MC=seNP9sWFaCpPqDrf7b32; other=value; _ga=GA1.1.3948206238.1874708608',
};

// Mock atob for Base64 decoding
global.atob = (str) => Buffer.from(str, 'base64').toString('binary');

// Import the module after setting up mocks
const fidelityModule = await import('../bank/fidelity.mjs');
const { bankId, getSessionId, getProfile, getAccounts, getStatements, downloadStatement } = fidelityModule;

describe('Fidelity API', () => {
    beforeEach(() => {
        // Reset fetch mock between tests for isolation
        mockFetch.mock.resetCalls();
    });

    describe('bankId', () => {
        it('should return the correct bank identifier', () => {
            assert.strictEqual(bankId, 'fidelity');
        });
    });

    describe('getSessionId', () => {
        it('should extract MC cookie from document.cookie', () => {
            const sessionId = getSessionId();
            assert.strictEqual(sessionId, 'seNP9sWFaCpPqDrf7b32');
        });

        it('should extract FC cookie if available', () => {
            const originalCookie = document.cookie;
            document.cookie = 'FC=test-fc-value; other=value';

            const sessionId = getSessionId();
            assert.strictEqual(sessionId, 'test-fc-value');

            document.cookie = originalCookie;
        });

        it('should throw error when no session cookie is found', () => {
            const originalCookie = document.cookie;
            document.cookie = 'other=value';

            assert.throws(() => getSessionId(), /Fidelity session not found/);

            document.cookie = originalCookie;
        });
    });

    describe('getProfile', () => {
        it('should extract email address as profile identifier', async () => {
            const mockResponse = {
                data: {
                    deliveryPrefData: {
                        deliveryPrefInquiry: {
                            deliveryPref: {
                                custInformation: {
                                    emailAddr: 'john.doe@example.com',
                                    __typename: 'DocCustInformation',
                                },
                                __typename: 'DeliveryPreference',
                            },
                            __typename: 'DeliveryPrefInquiry',
                        },
                        __typename: 'DeliveryRespBody',
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
                profileId: 'john.doe@example.com',
                profileName: 'john.doe@example.com',
            });

            const calls = mockFetch.mock.calls;
            assert.strictEqual(calls.length, 1);
            assert.strictEqual(calls[0].arguments[0], 'https://digital.fidelity.com/ftgw/digital/documents/api/graphql');
        });

        it('should throw error when API request fails', async () => {
            mockFetch.mock.mockImplementationOnce(() =>
                Promise.resolve({
                    ok: false,
                    status: 500,
                    statusText: 'Internal Server Error',
                })
            );

            await assert.rejects(
                getProfile('test-session-id'),
                /GetDeliveryPref API request failed: 500 Internal Server Error/
            );
        });

        it('should throw error when email address is not found', async () => {
            const mockResponse = {
                data: {
                    deliveryPrefData: {
                        deliveryPrefInquiry: {
                            deliveryPref: {
                                custInformation: {},
                            },
                        },
                    },
                },
            };

            mockFetch.mock.mockImplementationOnce(() =>
                Promise.resolve({
                    ok: true,
                    json: () => Promise.resolve(mockResponse),
                })
            );

            await assert.rejects(getProfile('test-session-id'), /Email address not found in profile response/);
        });
    });

    describe('getAccounts', () => {
        const mockProfile = {
            sessionId: 'test-session',
            profileId: 'john.doe@example.com',
            profileName: 'john.doe@example.com',
        };

        it('should retrieve brokerage and credit card accounts', async () => {
            const mockResponse = {
                data: {
                    getContext: {
                        person: {
                            assets: [
                                {
                                    acctNum: 'C39028647',
                                    acctType: 'Brokerage',
                                    acctSubType: 'Brokerage',
                                    acctSubTypeDesc: 'Brokerage General Investing Person',
                                    preferenceDetail: {
                                        name: 'JOHN INVESTMENT',
                                        isHidden: false,
                                        acctGroupId: 'IA',
                                    },
                                    creditCardDetail: null,
                                },
                                {
                                    acctNum: '0440',
                                    acctType: 'Fidelity Credit Card',
                                    acctSubType: 'Credit Card',
                                    acctSubTypeDesc: 'Credit Card',
                                    preferenceDetail: {
                                        name: 'Visa Signature Rewards',
                                        isHidden: false,
                                        acctGroupId: 'CC',
                                    },
                                    creditCardDetail: {
                                        creditCardAcctNumber: '22226731857822968467',
                                        memberId: '43230226074',
                                    },
                                },
                            ],
                        },
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

            // Brokerage account
            assert.deepStrictEqual(accounts[0], {
                profile: mockProfile,
                accountId: 'C39028647',
                accountName: 'JOHN INVESTMENT',
                accountMask: '8647',
                accountType: 'Investment',
            });

            // Credit card account
            assert.deepStrictEqual(accounts[1], {
                profile: mockProfile,
                accountId: '22226731857822968467',
                accountName: 'Visa Signature Rewards',
                accountMask: '0440',
                accountType: 'CreditCard',
            });
        });

        it('should skip hidden accounts', async () => {
            const mockResponse = {
                data: {
                    getContext: {
                        person: {
                            assets: [
                                {
                                    acctNum: 'D40139758',
                                    acctType: 'Brokerage',
                                    acctSubType: 'Brokerage',
                                    acctSubTypeDesc: 'Brokerage Account',
                                    preferenceDetail: {
                                        name: 'Visible Account',
                                        isHidden: false,
                                    },
                                },
                                {
                                    acctNum: 'E51240167',
                                    acctType: 'Brokerage',
                                    acctSubType: 'Brokerage',
                                    acctSubTypeDesc: 'Hidden Account',
                                    preferenceDetail: {
                                        name: 'Fidelity Bloom Save',
                                        isHidden: true,
                                    },
                                },
                            ],
                        },
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

            assert.strictEqual(accounts.length, 1);
            assert.strictEqual(accounts[0].accountName, 'Visible Account');
        });

        it('should throw error when API request fails', async () => {
            mockFetch.mock.mockImplementationOnce(() =>
                Promise.resolve({
                    ok: false,
                    status: 401,
                    statusText: 'Unauthorized',
                })
            );

            await assert.rejects(getAccounts(mockProfile), /GetContext API request failed: 401 Unauthorized/);
        });
    });

    describe('getStatements - Brokerage', () => {
        const mockAccount = {
            profile: { sessionId: 'test', profileId: 'test', profileName: 'test' },
            accountId: 'C39028647',
            accountName: 'JOHN INVESTMENT',
            accountMask: '7536',
            accountType: 'Investment',
        };

        it('should retrieve brokerage statements', async () => {
            const mockResponse = {
                data: {
                    getStatement: {
                        statement: {
                            docDetails: {
                                docDetail: [
                                    {
                                        id: 'NkAzNi0yMS00MURHMTFXMTEyMzExMzYyNTU4LDIsRURHLDIyNDI',
                                        type: 'PI Monthly/Quarterly Statement',
                                        acctNum: '7536',
                                        periodStartDate: 10012025,
                                        periodEndDate: 10312025,
                                        generatedDate: 10312025,
                                        isHouseholded: true,
                                        formatTypes: {
                                            formatType: {
                                                isPDF: true,
                                                isCSV: true,
                                            },
                                        },
                                    },
                                    {
                                        id: 'OlBdMy0xMS01MERIR0wyWDEyMzQyMjQ3MzY2OSwyLEVERiwxMTMz',
                                        type: 'PI Monthly/Quarterly Statement',
                                        acctNum: '7536',
                                        periodStartDate: 9012025,
                                        periodEndDate: 9302025,
                                        generatedDate: 9302025,
                                        isHouseholded: true,
                                        formatTypes: {
                                            formatType: {
                                                isPDF: true,
                                            },
                                        },
                                    },
                                ],
                            },
                        },
                    },
                },
            };

            mockFetch.mock.mockImplementationOnce(() =>
                Promise.resolve({
                    ok: true,
                    json: () => Promise.resolve(mockResponse),
                })
            );

            const statements = await getStatements(mockAccount);

            assert.strictEqual(statements.length, 2);
            assert.deepStrictEqual(statements[0], {
                account: mockAccount,
                statementId: 'NkAzNi0yMS00MURHMTFXMTEyMzExMzYyNTU4LDIsRURHLDIyNDI',
                statementDate: '2025-10-31',
            });
            assert.deepStrictEqual(statements[1], {
                account: mockAccount,
                statementId: 'OlBdMy0xMS01MERIR0wyWDEyMzQyMjQ3MzY2OSwyLEVERiwxMTMz',
                statementDate: '2025-09-30',
            });
        });

        it('should filter out statements without PDF', async () => {
            const mockResponse = {
                data: {
                    getStatement: {
                        statement: {
                            docDetails: {
                                docDetail: [
                                    {
                                        id: 'stmt1',
                                        acctNum: '7536',
                                        periodEndDate: 10312025,
                                        formatTypes: {
                                            formatType: {
                                                isPDF: true,
                                            },
                                        },
                                    },
                                    {
                                        id: 'stmt2',
                                        acctNum: '7536',
                                        periodEndDate: 9302025,
                                        formatTypes: {
                                            formatType: {
                                                isPDF: false,
                                            },
                                        },
                                    },
                                ],
                            },
                        },
                    },
                },
            };

            mockFetch.mock.mockImplementationOnce(() =>
                Promise.resolve({
                    ok: true,
                    json: () => Promise.resolve(mockResponse),
                })
            );

            const statements = await getStatements(mockAccount);

            assert.strictEqual(statements.length, 1);
            assert.strictEqual(statements[0].statementId, 'stmt1');
        });

        it('should filter statements by account mask', async () => {
            const mockResponse = {
                data: {
                    getStatement: {
                        statement: {
                            docDetails: {
                                docDetail: [
                                    {
                                        id: 'stmt1',
                                        acctNum: '7536',
                                        periodEndDate: 10312025,
                                        formatTypes: { formatType: { isPDF: true } },
                                    },
                                    {
                                        id: 'stmt2',
                                        acctNum: '9999',
                                        periodEndDate: 9302025,
                                        formatTypes: { formatType: { isPDF: true } },
                                    },
                                ],
                            },
                        },
                    },
                },
            };

            mockFetch.mock.mockImplementationOnce(() =>
                Promise.resolve({
                    ok: true,
                    json: () => Promise.resolve(mockResponse),
                })
            );

            const statements = await getStatements(mockAccount);

            assert.strictEqual(statements.length, 1);
            assert.strictEqual(statements[0].statementId, 'stmt1');
        });
    });

    describe('getStatements - Credit Card', () => {
        const mockAccount = {
            profile: { sessionId: 'test', profileId: 'test', profileName: 'test' },
            accountId: '22226731857822968467',
            accountName: 'Visa Signature Rewards',
            accountMask: '9339',
            accountType: 'CreditCard',
        };

        it('should retrieve credit card statements', async () => {
            const mockResponse = {
                data: {
                    getStatementsList: {
                        statements: [
                            {
                                statementName: 'November 2025 - Oct-18 to Nov-18 (pdf)',
                                statementStartDate: '2025-10-18',
                                statementEndDate: '2025-11-18',
                            },
                            {
                                statementName: 'October 2025 - Sep-19 to Oct-17 (pdf)',
                                statementStartDate: '2025-09-19',
                                statementEndDate: '2025-10-17',
                            },
                        ],
                        isPaperlessEnrolled: 'Already Enrolled',
                    },
                },
            };

            mockFetch.mock.mockImplementationOnce(() =>
                Promise.resolve({
                    ok: true,
                    json: () => Promise.resolve(mockResponse),
                })
            );

            const statements = await getStatements(mockAccount);

            assert.strictEqual(statements.length, 2);
            assert.deepStrictEqual(statements[0], {
                account: mockAccount,
                statementId: '2025-11-18',
                statementDate: '2025-11-18',
            });
            assert.deepStrictEqual(statements[1], {
                account: mockAccount,
                statementId: '2025-10-17',
                statementDate: '2025-10-17',
            });

            const calls = mockFetch.mock.calls;
            const requestBody = JSON.parse(calls[0].arguments[1].body);
            assert.strictEqual(requestBody.operationName, 'GetStatementsList');
            assert.strictEqual(requestBody.variables.accountId, '22226731857822968467');
        });

        it('should include required headers for credit card API', async () => {
            const mockResponse = {
                data: {
                    getStatementsList: {
                        statements: [],
                    },
                },
            };

            mockFetch.mock.mockImplementationOnce(() =>
                Promise.resolve({
                    ok: true,
                    json: () => Promise.resolve(mockResponse),
                })
            );

            await getStatements(mockAccount);

            const calls = mockFetch.mock.calls;
            const headers = calls[0].arguments[1].headers;
            assert.strictEqual(headers['apollographql-client-name'], 'credit-card');
            assert.strictEqual(headers['apollographql-client-version'], '0.0.1');
        });
    });

    describe('downloadStatement - Brokerage', () => {
        const mockStatement = {
            account: {
                accountType: 'Investment',
                accountId: 'C39028647',
            },
            statementId: 'NkAzNi0yMS00MURHMTFXMTEyMzExMzYyNTU4LDIsRURHLDIyNDI',
            statementDate: '2025-10-31',
        };

        it('should download brokerage statement PDF via direct URL', async () => {
            const mockPdfBlob = new Blob(['mock pdf content'], { type: 'application/pdf' });

            mockFetch.mock.mockImplementationOnce(() =>
                Promise.resolve({
                    ok: true,
                    blob: () => Promise.resolve(mockPdfBlob),
                })
            );

            const blob = await downloadStatement(mockStatement);

            assert.strictEqual(blob, mockPdfBlob);

            const calls = mockFetch.mock.calls;
            assert.strictEqual(calls.length, 1);
            assert.match(
                calls[0].arguments[0],
                /https:\/\/digital\.fidelity\.com\/ftgw\/digital\/documents\/PDFStatement\/STMT\/pdf\/Statement10312025\.pdf\?id=/
            );
        });

        it('should encode statement ID in URL', async () => {
            mockFetch.mock.mockImplementationOnce(() =>
                Promise.resolve({
                    ok: true,
                    blob: () => Promise.resolve(new Blob()),
                })
            );

            await downloadStatement(mockStatement);

            const calls = mockFetch.mock.calls;
            const url = calls[0].arguments[0];
            assert.match(url, /id=NkAzNi0yMS00MURHMTFXMTEyMzExMzYyNTU4LDIsRURHLDIyNDI/);
        });

        it('should throw error when PDF download fails', async () => {
            mockFetch.mock.mockImplementationOnce(() =>
                Promise.resolve({
                    ok: false,
                    status: 404,
                    statusText: 'Not Found',
                })
            );

            await assert.rejects(downloadStatement(mockStatement), /PDF download failed: 404 Not Found/);
        });
    });

    describe('downloadStatement - Credit Card', () => {
        const mockStatement = {
            account: {
                accountType: 'CreditCard',
                accountId: '22226731857822968467',
            },
            statementId: '2025-11-18',
            statementDate: '2025-11-18',
        };

        it('should download credit card statement PDF via GraphQL with Base64 decoding', async () => {
            // Create a simple PDF-like Base64 string
            const mockPdfBase64 = Buffer.from('mock pdf binary content').toString('base64');
            const mockResponse = {
                data: {
                    getStatement: {
                        statement: {
                            statementDate: '2025-11-18',
                            pageContent: mockPdfBase64,
                            __typename: 'Statement',
                        },
                        __typename: 'GetStatementResponse',
                    },
                },
            };

            mockFetch.mock.mockImplementationOnce(() =>
                Promise.resolve({
                    ok: true,
                    json: () => Promise.resolve(mockResponse),
                })
            );

            const blob = await downloadStatement(mockStatement);

            assert.strictEqual(blob.type, 'application/pdf');

            const calls = mockFetch.mock.calls;
            assert.strictEqual(calls[0].arguments[0], 'https://digital.fidelity.com/ftgw/digital/credit-card/api/graphql');

            const requestBody = JSON.parse(calls[0].arguments[1].body);
            assert.strictEqual(requestBody.operationName, 'GetStatement');
            assert.strictEqual(requestBody.variables.accountId, '22226731857822968467');
            assert.strictEqual(requestBody.variables.statementDate, '2025-11-18');
        });

        it('should include required headers for credit card PDF download', async () => {
            const mockResponse = {
                data: {
                    getStatement: {
                        statement: {
                            pageContent: Buffer.from('test').toString('base64'),
                        },
                    },
                },
            };

            mockFetch.mock.mockImplementationOnce(() =>
                Promise.resolve({
                    ok: true,
                    json: () => Promise.resolve(mockResponse),
                })
            );

            await downloadStatement(mockStatement);

            const calls = mockFetch.mock.calls;
            const headers = calls[0].arguments[1].headers;
            assert.strictEqual(headers['apollographql-client-name'], 'credit-card');
            assert.strictEqual(headers['apollographql-client-version'], '0.0.1');
        });

        it('should throw error when pageContent is missing', async () => {
            const mockResponse = {
                data: {
                    getStatement: {
                        statement: {
                            statementDate: '2025-11-18',
                        },
                    },
                },
            };

            mockFetch.mock.mockImplementationOnce(() =>
                Promise.resolve({
                    ok: true,
                    json: () => Promise.resolve(mockResponse),
                })
            );

            await assert.rejects(downloadStatement(mockStatement), /No PDF content in credit card statement response/);
        });

        it('should throw error when credit card API request fails', async () => {
            mockFetch.mock.mockImplementationOnce(() =>
                Promise.resolve({
                    ok: false,
                    status: 500,
                    statusText: 'Internal Server Error',
                })
            );

            await assert.rejects(
                downloadStatement(mockStatement),
                /Credit card PDF download failed: 500 Internal Server Error/
            );
        });
    });
});
