/**
 * Unit tests for TD Bank Canada statement API implementation
 * Tests cover checking, savings, and credit card account functionality
 * 
 * Note: All mock data is based on actual content from analyze/td_bank_1763693331301.har
 * to ensure tests match real API responses.
 */

import { describe, it, beforeEach, mock } from 'node:test';
import assert from 'node:assert/strict';

// Mock global fetch
const mockFetch = mock.fn();
global.fetch = mockFetch;

// Mock document.cookie for getSessionId
global.document = {
    cookie: 'JESSIONID=Xb92c3d4e-5f6a-7b8c-9d0e-1f2a3b4c5d6e; HD4bjx6N=BxhlmLPbBRCCUzUwRaMZml1008srZZ8pUmogf1W1czVI2-CEr3MRSmF_tjbOBd61R73vdm7aXI9BBFC4BBBBBBB|1|1|a4bcd97e53fb03de6cdd34775c0ff9f1cc866599; other=value',
};

// Mock atob for base64 decoding in downloadStatement
global.atob = (str) => Buffer.from(str, 'base64').toString('binary');

// Import the module after setting up mocks
const tdBankModule = await import('../bank/td_bank.mjs');
const { bankId, bankName, getSessionId, getProfile, getAccounts, getStatements, downloadStatement } = tdBankModule;

describe('TD Bank Canada API', () => {
    beforeEach(() => {
        // Reset fetch mock between tests for isolation
        mockFetch.mock.resetCalls();
    });

    describe('bankId', () => {
        it('should return the correct bank identifier', () => {
            assert.strictEqual(bankId, 'td_bank');
        });
    });

    describe('bankName', () => {
        it('should return the correct bank name', () => {
            assert.strictEqual(bankName, 'TD Bank (EasyWeb)');
        });
    });

    describe('getSessionId', () => {
        it('should extract HD4bjx6N cookie when available', () => {
            const sessionId = getSessionId();
            assert.strictEqual(sessionId, 'BxhlmLPbBRCCUzUwRaMZml1008srZZ8pUmogf1W1czVI2-CEr3MRSmF_tjbOBd61R73vdm7aXI9BBFC4BBBBBBB|1|1|a4bcd97e53fb03de6cdd34775c0ff9f1cc866599');
        });

        it('should fall back to JESSIONID when HD4bjx6N is not available', () => {
            Object.defineProperty(document, 'cookie', {
                value: 'JESSIONID=Xb92c3d4e-5f6a-7b8c-9d0e-1f2a3b4c5d6e; other=value',
                writable: true,
                configurable: true,
            });

            const sessionId = getSessionId();
            assert.strictEqual(sessionId, 'Xb92c3d4e-5f6a-7b8c-9d0e-1f2a3b4c5d6e');

            // Restore original cookie
            Object.defineProperty(document, 'cookie', {
                value: 'JESSIONID=Xb92c3d4e-5f6a-7b8c-9d0e-1f2a3b4c5d6e; HD4bjx6N=BxhlmLPbBRCCUzUwRaMZml1008srZZ8pUmogf1W1czVI2-CEr3MRSmF_tjbOBd61R73vdm7aXI9BBFC4BBBBBBB|1|1|a4bcd97e53fb03de6cdd34775c0ff9f1cc866599; other=value',
                writable: true,
                configurable: true,
            });
        });

        it('should throw error when JESSIONID cookie is not found', () => {
            Object.defineProperty(document, 'cookie', {
                value: 'other=value; rxVisitor=123',
                writable: true,
                configurable: true,
            });

            assert.throws(() => getSessionId(), /JESSIONID cookie not found/);

            // Restore original cookie
            Object.defineProperty(document, 'cookie', {
                value: 'JESSIONID=Xb92c3d4e-5f6a-7b8c-9d0e-1f2a3b4c5d6e; HD4bjx6N=BxhlmLPbBRCCUzUwRaMZml1008srZZ8pUmogf1W1czVI2-CEr3MRSmF_tjbOBd61R73vdm7aXI9BBFC4BBBBBBB|1|1|a4bcd97e53fb03de6cdd34775c0ff9f1cc866599; other=value',
                writable: true,
                configurable: true,
            });
        });
    });

    describe('getProfile', () => {
        it('should retrieve user profile information', async () => {
            const mockResponse = {
                displayName: 'John Doe',
                initials: 'JD',
                firstName: 'John',
            };

            mockFetch.mock.mockImplementationOnce(() =>
                Promise.resolve({
                    ok: true,
                    json: async () => mockResponse,
                })
            );

            const profile = await getProfile('test-session-id');

            assert.strictEqual(profile.sessionId, 'test-session-id');
            assert.strictEqual(profile.profileId, 'John Doe');
            assert.strictEqual(profile.profileName, 'John Doe');

            const calls = mockFetch.mock.calls;
            assert.strictEqual(calls.length, 1);
            assert.strictEqual(calls[0].arguments[0], 'https://easyweb.td.com/ms/mpref/v1/preferences/displayname');
            assert.strictEqual(calls[0].arguments[1].credentials, 'include');
            assert.strictEqual(calls[0].arguments[1].headers['Accept'], 'application/json');
            assert.strictEqual(calls[0].arguments[1].headers['originating-app-name'], 'RWUI-unav-ew');
        });

        it('should throw error when profile response is invalid', async () => {
            mockFetch.mock.mockImplementationOnce(() =>
                Promise.resolve({
                    ok: true,
                    json: async () => ({}),
                })
            );

            await assert.rejects(
                () => getProfile('test-session-id'),
                /Invalid profile data received/
            );
        });

        it('should throw error when API request fails', async () => {
            mockFetch.mock.mockImplementationOnce(() =>
                Promise.resolve({
                    ok: false,
                    status: 401,
                })
            );

            await assert.rejects(
                () => getProfile('test-session-id'),
                /API request failed: 401/
            );
        });
    });

    describe('getAccounts', () => {
        const mockProfile = {
            sessionId: 'test-session-id',
            profileId: 'John Doe',
            profileName: 'John Doe',
        };

        it('should retrieve all accounts with correct type mapping', async () => {
            const mockResponse = {
                accountList: [
                    {
                        accountKey: '-1234567890',
                        accountIdentifier: 'a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1b2',
                        accountNumber: '7182935',
                        accountDisplayName: 'TD ALL-INCLUSIVE BANKING PLAN',
                        accountType: 'PDA',
                        productCd: 'MBA',
                        accountName: 'TD ALL-INCLUSIVE BANKING PLAN',
                    },
                    {
                        accountKey: '-1987654321',
                        accountIdentifier: 'b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1b2c3',
                        accountNumber: '8293746',
                        accountDisplayName: 'TD EPREMIUM SAVINGS ACCOUNT',
                        accountType: 'PDA',
                        productCd: 'IBA',
                        accountName: 'TD EPREMIUM SAVINGS ACCOUNT',
                    },
                    {
                        accountKey: '-1098765432',
                        accountIdentifier: 'c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1b2c3d4',
                        accountNumber: '531097******1847',
                        accountDisplayName: 'TD CASH BACK VISA INFINITE* CARD',
                        accountType: 'VSA',
                        productCd: 'I CASHBACK',
                        accountName: 'TD CASH BACK VISA INFINITE* CARD',
                    },
                ],
            };

            mockFetch.mock.mockImplementationOnce(() =>
                Promise.resolve({
                    ok: true,
                    json: async () => mockResponse,
                })
            );

            const accounts = await getAccounts(mockProfile);

            assert.strictEqual(accounts.length, 3);

            // Checking account (PDA with MBA product code)
            assert.strictEqual(accounts[0].accountId, '-1234567890');
            assert.strictEqual(accounts[0].accountName, 'TD ALL-INCLUSIVE BANKING PLAN');
            assert.strictEqual(accounts[0].accountMask, '2935');
            assert.strictEqual(accounts[0].accountType, 'Checking');
            assert.strictEqual(accounts[0].profile, mockProfile);

            // Savings account (PDA with IBA product code)
            assert.strictEqual(accounts[1].accountId, '-1987654321');
            assert.strictEqual(accounts[1].accountName, 'TD EPREMIUM SAVINGS ACCOUNT');
            assert.strictEqual(accounts[1].accountMask, '3746');
            assert.strictEqual(accounts[1].accountType, 'Savings');

            // Credit Card (VSA)
            assert.strictEqual(accounts[2].accountId, '-1098765432');
            assert.strictEqual(accounts[2].accountName, 'TD CASH BACK VISA INFINITE* CARD');
            assert.strictEqual(accounts[2].accountMask, '1847');
            assert.strictEqual(accounts[2].accountType, 'CreditCard');

            const calls = mockFetch.mock.calls;
            assert.strictEqual(calls.length, 1);
            assert.strictEqual(calls[0].arguments[0], 'https://easyweb.td.com/ms/uainq/v1/accounts/list');
            assert.strictEqual(calls[0].arguments[1].headers['originating-app-name'], 'RWUI-uu-accounts');
        });

        it('should use accountName when accountDisplayName is not available', async () => {
            const mockResponse = {
                accountList: [
                    {
                        accountKey: '-1234567890',
                        accountNumber: '1234567',
                        accountDisplayName: '',
                        accountType: 'PDA',
                        productCd: 'MBA',
                        accountName: 'TD CHEQUING ACCOUNT',
                    },
                ],
            };

            mockFetch.mock.mockImplementationOnce(() =>
                Promise.resolve({
                    ok: true,
                    json: async () => mockResponse,
                })
            );

            const accounts = await getAccounts(mockProfile);
            assert.strictEqual(accounts[0].accountName, 'TD CHEQUING ACCOUNT');
        });

        it('should throw error when accounts response is invalid', async () => {
            mockFetch.mock.mockImplementationOnce(() =>
                Promise.resolve({
                    ok: true,
                    json: async () => ({}),
                })
            );

            await assert.rejects(
                () => getAccounts(mockProfile),
                /Invalid account list data received/
            );
        });
    });

    describe('getStatements', () => {
        const mockProfile = {
            sessionId: 'test-session-id',
            profileId: 'John Doe',
            profileName: 'John Doe',
        };

        const mockCheckingAccount = {
            profile: mockProfile,
            accountId: '-1234567890',
            accountName: 'TD ALL-INCLUSIVE BANKING PLAN',
            accountMask: '2935',
            accountType: 'Checking',
        };

        const mockSavingsAccount = {
            profile: mockProfile,
            accountId: '-1987654321',
            accountName: 'TD EPREMIUM SAVINGS ACCOUNT',
            accountMask: '3746',
            accountType: 'Savings',
        };

        const mockCreditCardAccount = {
            profile: mockProfile,
            accountId: '-1098765432',
            accountName: 'TD CASH BACK VISA INFINITE* CARD',
            accountMask: '1847',
            accountType: 'CreditCard',
        };

        it('should retrieve statements for checking account', async () => {
            const mockDocumentListResponse = {
                status: {
                    statusCode: '200',
                    severity: 'SUCCESS',
                },
                documentList: [
                    {
                        documentId: 'A1B2C3D4E5F6A7B8C9D0E1F2A3B4C5D6E7F8A9B0C1D2E3F4A5B6',
                        name: 'TD_ALL-INCLUSIVE_BANKING_PLAN_1234-7182935_Sep_29-Oct_31_2025',
                        documentDate: '2025/10/31',
                        documentType: 'ESTMT',
                        startDate: '2025/09/29',
                        endDate: '2025/10/31',
                    },
                    {
                        documentId: 'B2C3D4E5F6A7B8C9D0E1F2A3B4C5D6E7F8A9B0C1D2E3F4A5B6C7',
                        name: 'TD_ALL-INCLUSIVE_BANKING_PLAN_1234-7182935_Aug_29-Sep_29_2025',
                        documentDate: '2025/09/29',
                        documentType: 'ESTMT',
                        startDate: '2025/08/29',
                        endDate: '2025/09/29',
                    },
                ],
            };

            mockFetch.mock.mockImplementationOnce(() =>
                Promise.resolve({
                    ok: true,
                    json: async () => mockDocumentListResponse,
                })
            );

            const statements = await getStatements(mockCheckingAccount);

            assert.strictEqual(statements.length, 2);
            assert.strictEqual(statements[0].statementId, 'A1B2C3D4E5F6A7B8C9D0E1F2A3B4C5D6E7F8A9B0C1D2E3F4A5B6');
            assert.strictEqual(statements[0].statementDate, '2025-10-31');
            assert.strictEqual(statements[0].account, mockCheckingAccount);

            assert.strictEqual(statements[1].statementId, 'B2C3D4E5F6A7B8C9D0E1F2A3B4C5D6E7F8A9B0C1D2E3F4A5B6C7');
            assert.strictEqual(statements[1].statementDate, '2025-09-29');

            const calls = mockFetch.mock.calls;
            assert.strictEqual(calls.length, 1);
            assert.ok(calls[0].arguments[0].includes('/waw/api/edelivery/estmt/documentlist'));
            assert.ok(calls[0].arguments[0].includes('accountKey=-1234567890'));
            assert.ok(calls[0].arguments[0].includes('period=Last_12_Months'));
            assert.ok(calls[0].arguments[0].includes('documentType=ESTMT'));
        });

        it('should retrieve statements for savings account', async () => {
            const mockDocumentListResponse = {
                status: {
                    statusCode: '200',
                    severity: 'SUCCESS',
                },
                documentList: [
                    {
                        documentId: 'C3D4E5F6A7B8C9D0E1F2A3B4C5D6E7F8A9B0C1D2E3F4A5B6C7D8',
                        name: 'TD_EPREMIUM_SAVINGS_ACCOUNT_5678-8293746_Jun_30-Jul_31_2025',
                        documentDate: '2025/07/31',
                        documentType: 'ESTMT',
                        startDate: '2025/06/30',
                        endDate: '2025/07/31',
                    },
                ],
            };

            mockFetch.mock.mockImplementationOnce(() =>
                Promise.resolve({
                    ok: true,
                    json: async () => mockDocumentListResponse,
                })
            );

            const statements = await getStatements(mockSavingsAccount);

            assert.strictEqual(statements.length, 1);
            assert.strictEqual(statements[0].statementId, 'C3D4E5F6A7B8C9D0E1F2A3B4C5D6E7F8A9B0C1D2E3F4A5B6C7D8');
            assert.strictEqual(statements[0].statementDate, '2025-07-31');
            assert.strictEqual(statements[0].account, mockSavingsAccount);
        });

        it('should retrieve statements for credit card account', async () => {
            const mockDocumentListResponse = {
                status: {
                    statusCode: '200',
                    severity: 'SUCCESS',
                },
                documentList: [
                    {
                        documentId: 'D4E5F6A7B8C9D0E1F2A3B4C5D6E7F8A9B0C1D2E3F4A5B6C7D8E9',
                        name: 'TD_CASH_BACK_VISA_INFINITE*_CARD_1847_Jun_27-2025',
                        documentDate: '2025/06/27',
                        documentType: 'ESTMT',
                        documentFolder: 'eStatement_CreditCard',
                    },
                    {
                        documentId: 'E5F6A7B8C9D0E1F2A3B4C5D6E7F8A9B0C1D2E3F4A5B6C7D8E9F0',
                        name: 'TD_CASH_BACK_VISA_INFINITE*_CARD_1847_May_27-2025',
                        documentDate: '2025/05/27',
                        documentType: 'ESTMT',
                        documentFolder: 'eStatement_CreditCard',
                    },
                ],
            };

            mockFetch.mock.mockImplementationOnce(() =>
                Promise.resolve({
                    ok: true,
                    json: async () => mockDocumentListResponse,
                })
            );

            const statements = await getStatements(mockCreditCardAccount);

            assert.strictEqual(statements.length, 2);
            assert.strictEqual(statements[0].statementId, 'D4E5F6A7B8C9D0E1F2A3B4C5D6E7F8A9B0C1D2E3F4A5B6C7D8E9');
            assert.strictEqual(statements[0].statementDate, '2025-06-27');
            assert.strictEqual(statements[0].account, mockCreditCardAccount);
        });

        it('should use endDate when available, falling back to documentDate', async () => {
            const mockDocumentListResponse = {
                status: {
                    statusCode: '200',
                    severity: 'SUCCESS',
                },
                documentList: [
                    {
                        documentId: 'DOC1',
                        name: 'Statement with endDate',
                        documentDate: '2025/10/15',
                        endDate: '2025/10/31',
                    },
                    {
                        documentId: 'DOC2',
                        name: 'Statement without endDate',
                        documentDate: '2025/09/15',
                    },
                ],
            };

            mockFetch.mock.mockImplementationOnce(() =>
                Promise.resolve({
                    ok: true,
                    json: async () => mockDocumentListResponse,
                })
            );

            const statements = await getStatements(mockCheckingAccount);

            assert.strictEqual(statements[0].statementDate, '2025-10-31'); // Uses endDate
            assert.strictEqual(statements[1].statementDate, '2025-09-15'); // Uses documentDate
        });

        it('should retry with SSO initialization on 403 response', async () => {
            const mockDocumentListResponse = {
                status: {
                    statusCode: '200',
                    severity: 'SUCCESS',
                },
                documentList: [
                    {
                        documentId: 'DOC1',
                        name: 'Statement',
                        documentDate: '2025/10/31',
                        endDate: '2025/10/31',
                    },
                ],
            };

            // First call returns 403
            // Then SSO servlet call
            // Then SSO login call
            // Then retry returns success
            const responses = [
                { ok: false, status: 403 },
                { ok: true, text: async () => 'SSO servlet response' },
                { ok: true, text: async () => 'SSO login response' },
                { ok: true, json: async () => mockDocumentListResponse },
            ];
            mockFetch.mock.mockImplementation(() => Promise.resolve(responses.shift()));

            const statements = await getStatements(mockCheckingAccount);

            assert.strictEqual(statements.length, 1);
            assert.strictEqual(statements[0].statementDate, '2025-10-31');

            const calls = mockFetch.mock.calls;
            assert.strictEqual(calls.length, 4);
            // First call - document list (403)
            assert.ok(calls[0].arguments[0].includes('/waw/api/edelivery/estmt/documentlist'));
            // Second call - SSO servlet
            assert.ok(calls[1].arguments[0].includes('/waw/ezw/servlet/com.td.estatement.servlet.EStatementAccountRepositoryServlet'));
            // Third call - SSO login
            assert.ok(calls[2].arguments[0].includes('/waw/api/ssologin'));
            // Fourth call - retry document list
            assert.ok(calls[3].arguments[0].includes('/waw/api/edelivery/estmt/documentlist'));
        });

        it('should throw error when statement response status is not SUCCESS', async () => {
            const mockDocumentListResponse = {
                status: {
                    statusCode: '401',
                    severity: 'ERROR',
                },
            };

            mockFetch.mock.mockImplementationOnce(() =>
                Promise.resolve({
                    ok: true,
                    json: async () => mockDocumentListResponse,
                })
            );

            await assert.rejects(
                () => getStatements(mockCheckingAccount),
                /Invalid statement data: 401/
            );
        });

        it('should throw error when documentList is missing', async () => {
            const mockDocumentListResponse = {
                status: {
                    statusCode: '200',
                    severity: 'SUCCESS',
                },
            };

            mockFetch.mock.mockImplementationOnce(() =>
                Promise.resolve({
                    ok: true,
                    json: async () => mockDocumentListResponse,
                })
            );

            await assert.rejects(
                () => getStatements(mockCheckingAccount),
                /Invalid statement data/
            );
        });
    });

    describe('downloadStatement', () => {
        const mockProfile = {
            sessionId: 'test-session-id',
            profileId: 'John Doe',
            profileName: 'John Doe',
        };

        const mockAccount = {
            profile: mockProfile,
            accountId: '-1234567890',
            accountName: 'TD ALL-INCLUSIVE BANKING PLAN',
            accountMask: '2935',
            accountType: 'Checking',
        };

        const mockStatement = {
            account: mockAccount,
            statementId: 'A1B2C3D4E5F6A7B8C9D0E1F2A3B4C5D6E7F8A9B0C1D2E3F4A5B6',
            statementDate: '2025-10-31',
        };

        it('should download statement PDF successfully', async () => {
            // Base64 encoded "PDF content"
            const base64PdfContent = Buffer.from('PDF content').toString('base64');

            const mockDocumentDetailResponse = {
                status: {
                    statusCode: '200',
                    severity: 'SUCCESS',
                },
                document: {
                    content: base64PdfContent,
                    documentId: 'A1B2C3D4E5F6A7B8C9D0E1F2A3B4C5D6E7F8A9B0C1D2E3F4A5B6',
                    mimeType: 'application/pdf',
                },
            };

            mockFetch.mock.mockImplementationOnce(() =>
                Promise.resolve({
                    ok: true,
                    json: async () => mockDocumentDetailResponse,
                })
            );

            const blob = await downloadStatement(mockStatement);

            assert.strictEqual(blob.type, 'application/pdf');

            const calls = mockFetch.mock.calls;
            assert.strictEqual(calls.length, 1);
            assert.ok(calls[0].arguments[0].includes('/waw/api/edelivery/estmt/documentdetail'));
            assert.ok(calls[0].arguments[0].includes('documentKey=A1B2C3D4E5F6A7B8C9D0E1F2A3B4C5D6E7F8A9B0C1D2E3F4A5B6'));
        });

        it('should throw error when document response status is not SUCCESS', async () => {
            const mockDocumentDetailResponse = {
                status: {
                    statusCode: '404',
                    severity: 'ERROR',
                },
            };

            mockFetch.mock.mockImplementationOnce(() =>
                Promise.resolve({
                    ok: true,
                    json: async () => mockDocumentDetailResponse,
                })
            );

            await assert.rejects(
                () => downloadStatement(mockStatement),
                /Invalid statement data: 404/
            );
        });

        it('should throw error when document content is missing', async () => {
            const mockDocumentDetailResponse = {
                status: {
                    statusCode: '200',
                    severity: 'SUCCESS',
                },
                document: {
                    documentId: 'DOC123',
                    mimeType: 'application/pdf',
                    // No content field
                },
            };

            mockFetch.mock.mockImplementationOnce(() =>
                Promise.resolve({
                    ok: true,
                    json: async () => mockDocumentDetailResponse,
                })
            );

            await assert.rejects(
                () => downloadStatement(mockStatement),
                /Invalid statement data/
            );
        });

        it('should retry with SSO initialization on 403 response', async () => {
            const base64PdfContent = Buffer.from('PDF content').toString('base64');

            const mockDocumentDetailResponse = {
                status: {
                    statusCode: '200',
                    severity: 'SUCCESS',
                },
                document: {
                    content: base64PdfContent,
                    documentId: 'DOC123',
                    mimeType: 'application/pdf',
                },
            };

            // First call returns 403
            // Then SSO servlet call
            // Then SSO login call
            // Then retry returns success
            const responses = [
                { ok: false, status: 403 },
                { ok: true, text: async () => 'SSO servlet response' },
                { ok: true, text: async () => 'SSO login response' },
                { ok: true, json: async () => mockDocumentDetailResponse },
            ];
            mockFetch.mock.mockImplementation(() => Promise.resolve(responses.shift()));

            const blob = await downloadStatement(mockStatement);

            assert.strictEqual(blob.type, 'application/pdf');

            const calls = mockFetch.mock.calls;
            assert.strictEqual(calls.length, 4);
        });
    });
});
