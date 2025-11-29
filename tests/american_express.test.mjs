/**
 * Unit tests for American Express bank statement API implementation
 * Tests cover both credit card and checking account functionality
 * 
 * Note: All mock __INITIAL_STATE__ data is based on actual content extracted from
 * analyze/american_express.har to ensure tests match real API responses.
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
    cookie: 'JSESSIONID=test-session-id-value; other=value',
};

// Import the module after setting up mocks
const amexModule = await import('../bank/american_express.mjs');
const { bankId, getSessionId, getProfile, getAccounts, getStatements, downloadStatement } = amexModule;

describe('American Express API', () => {
    beforeEach(() => {
        mockFetch.mock.resetCalls();
    });

    describe('bankId', () => {
        it('should return the correct bank identifier', () => {
            assert.strictEqual(bankId, 'american_express');
        });
    });

    describe('getSessionId', () => {
        it('should extract session cookie from document.cookie', () => {
            const sessionId = getSessionId();
            assert.strictEqual(sessionId, 'test-session-id-value');
        });

        it('should throw error when session cookie is not found', () => {
            const originalCookie = document.cookie;
            document.cookie = 'other=value';

            assert.throws(() => getSessionId(), /JSESSIONID cookie not found/);

            document.cookie = originalCookie;
        });
    });

    describe('getProfile', () => {
        it('should extract profile information from overview page', async () => {
            const mockHtml = `
        <html>
          <script>
            window.__INITIAL_STATE__ = "[\\\"~#iM\\\",[\\\"config\\\",[\\\"~#iM\\\",[\\\"bdaasMemberApiUrl\\\",\\\"https://global.americanexpress.com/api\\\"]],\\\"embossed_name\\\",\\\"JOHN DOE\\\"]]";
            window.__holocron = {};
          </script>
        </html>
      `;

            mockFetch.mock.mockImplementationOnce(() =>
                Promise.resolve({
                    ok: true,
                    text: () => Promise.resolve(mockHtml),
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
            assert.strictEqual(calls[0].arguments[0], 'https://global.americanexpress.com/overview');
            assert.strictEqual(calls[0].arguments[1].method, 'GET');
            assert.strictEqual(calls[0].arguments[1].credentials, 'include');
        });

        it('should use default profile name when embossed_name not found', async () => {
            const mockHtml = `
        <html>
          <script>
            window.__INITIAL_STATE__ = "[\\\"~#iM\\\",[\\\"config\\\",[\\\"~#iM\\\",[\\\"bdaasMemberApiUrl\\\",\\\"https://global.americanexpress.com/api\\\",\\\"gemUrl\\\",\\\"https://icm.aexp-static.com\\\"]]]]";
            window.__holocron = {};
          </script>
        </html>
      `;

            mockFetch.mock.mockImplementationOnce(() =>
                Promise.resolve({
                    ok: true,
                    text: () => Promise.resolve(mockHtml),
                })
            );

            const profile = await getProfile('test-session-id');

            assert.strictEqual(profile.profileName, 'American Express');
        });

        it('should throw error when __INITIAL_STATE__ is not found', async () => {
            mockFetch.mock.mockImplementationOnce(() =>
                Promise.resolve({
                    ok: true,
                    text: () => Promise.resolve('<html><body>No state</body></html>'),
                })
            );

            await assert.rejects(getProfile('test-session-id'));
        });
    });

    describe('getAccounts', () => {
        const mockProfile = {
            sessionId: 'test-session',
            profileId: 'test-profile',
            profileName: 'Test User',
        };

        it('should extract credit card accounts from overview page', async () => {
            const mockHtml = `
        <script>
          window.__INITIAL_STATE__ = "[\\\"~#iM\\\",[\\\"axp-consumer-context-switcher\\\",[\\\"~#iM\\\",[\\\"products\\\",[\\\"~#iM\\\",[\\\"registry\\\",[\\\"~#iM\\\",[\\\"types\\\",[\\\"~#iM\\\",[\\\"CARD_PRODUCT\\\",[[\\\"^ \\\",\\\"type\\\",\\\"CARD_PRODUCT\\\",\\\"accountToken\\\",\\\"M8RKTYU6DXH3FCT\\\",\\\"accountKey\\\",\\\"97264F5317FE9A3B8E60F971E2BF621C\\\"]]]]]]]]]]],\\\"details\\\",[\\\"~#iM\\\",[\\\"productsList\\\",[\\\"~#iM\\\",[\\\"M8RKTYU6DXH3FCT\\\",[\\\"~#iM\\\",[\\\"account\\\",[\\\"~#iM\\\",[\\\"display_account_number\\\",\\\"23456\\\"]],\\\"product\\\",[\\\"~#iM\\\",[\\\"description\\\",\\\"Platinum Card®\\\"]]]]]]]]]]]";
          window.__holocron = {};
        </script>
      `;

            mockFetch.mock.mockImplementationOnce(() =>
                Promise.resolve({
                    ok: true,
                    text: () => Promise.resolve(mockHtml),
                })
            );

            const accounts = await getAccounts(mockProfile);

            assert.strictEqual(accounts.length, 1);
            assert.deepStrictEqual(accounts[0], {
                profile: mockProfile,
                accountId: 'M8RKTYU6DXH3FCT',
                accountName: 'Platinum Card®',
                accountMask: '23456',
                accountType: 'CreditCard',
            });
        });

        it('should extract checking accounts from overview page', async () => {
            const mockHtml = `
        <script>
          window.__INITIAL_STATE__ = "[\\\"~#iM\\\",[\\\"axp-consumer-context-switcher\\\",[\\\"~#iM\\\",[\\\"products\\\",[\\\"~#iM\\\",[\\\"registry\\\",[\\\"~#iM\\\",[\\\"types\\\",[\\\"~#iM\\\",[\\\"AEXP_PERSONAL_CHECKING_ACCOUNT\\\",[[\\\"^ \\\",\\\"opaqueAccountId\\\",\\\"HqnTwr5VK6_1JKx7YfiISzxNZij9akZeZksbNKwzTjq\\\"]]]]]]]]]]],\\\"details\\\",[\\\"~#iM\\\",[\\\"productsList\\\",[\\\"~#iM\\\",[\\\"HqnTwr5VK6_1JKx7YfiISzxNZij9akZeZksbNKwzTjq\\\",[\\\"~#iM\\\",[\\\"account\\\",[\\\"~#iM\\\",[\\\"displayAccountNumber\\\",\\\"8298\\\"]],\\\"product\\\",[\\\"~#iM\\\",[\\\"productDisplayName\\\",\\\"American Express Rewards Checking\\\"]]]]]]]]]]]";
          window.__holocron = {};
        </script>
      `;

            mockFetch.mock.mockImplementationOnce(() =>
                Promise.resolve({
                    ok: true,
                    text: () => Promise.resolve(mockHtml),
                })
            );

            const accounts = await getAccounts(mockProfile);

            assert.strictEqual(accounts.length, 1);
            assert.deepStrictEqual(accounts[0], {
                profile: mockProfile,
                accountId: 'HqnTwr5VK6_1JKx7YfiISzxNZij9akZeZksbNKwzTjq',
                accountName: 'American Express Rewards Checking',
                accountMask: '8298',
                accountType: 'Checking',
            });
        });

        it('should handle multiple accounts of different types', async () => {
            const mockHtml = `
        <script>
          window.__INITIAL_STATE__ = "[\\\"~#iM\\\",[\\\"axp-consumer-context-switcher\\\",[\\\"~#iM\\\",[\\\"products\\\",[\\\"~#iM\\\",[\\\"registry\\\",[\\\"~#iM\\\",[\\\"types\\\",[\\\"~#iM\\\",[\\\"CARD_PRODUCT\\\",[[\\\"^ \\\",\\\"accountToken\\\",\\\"M8RKTYU6DXH3FCT\\\",\\\"accountKey\\\",\\\"97264F5317FE9A3B8E60F971E2BF621C\\\"],[\\\"^ \\\",\\\"accountToken\\\",\\\"3USX10A9WWCVRDF\\\",\\\"accountKey\\\",\\\"87538ED54E4F6DA35932451C642BFE7F\\\"]],\\\"AEXP_PERSONAL_CHECKING_ACCOUNT\\\",[[\\\"^ \\\",\\\"opaqueAccountId\\\",\\\"HqnTwr5VK6_1JKx7YfiISzxNZij9akZeZksbNKwzTjq\\\"]]]]]]]]]]],\\\"details\\\",[\\\"~#iM\\\",[\\\"productsList\\\",[\\\"~#iM\\\",[\\\"M8RKTYU6DXH3FCT\\\",[\\\"~#iM\\\",[\\\"account\\\",[\\\"~#iM\\\",[\\\"display_account_number\\\",\\\"23456\\\"]],\\\"product\\\",[\\\"~#iM\\\",[\\\"description\\\",\\\"Platinum Card®\\\"]]]],\\\"3USX10A9WWCVRDF\\\",[\\\"~#iM\\\",[\\\"account\\\",[\\\"~#iM\\\",[\\\"display_account_number\\\",\\\"52110\\\"]],\\\"product\\\",[\\\"~#iM\\\",[\\\"description\\\",\\\"Platinum Card®\\\"]]]],\\\"HqnTwr5VK6_1JKx7YfiISzxNZij9akZeZksbNKwzTjq\\\",[\\\"~#iM\\\",[\\\"account\\\",[\\\"~#iM\\\",[\\\"displayAccountNumber\\\",\\\"8298\\\"]],\\\"product\\\",[\\\"~#iM\\\",[\\\"productDisplayName\\\",\\\"American Express Rewards Checking\\\"]]]]]]]]]";
          window.__holocron = {};
        </script>
      `;

            mockFetch.mock.mockImplementationOnce(() =>
                Promise.resolve({
                    ok: true,
                    text: () => Promise.resolve(mockHtml),
                })
            );

            const accounts = await getAccounts(mockProfile);

            assert.strictEqual(accounts.length, 3);
            assert.strictEqual(accounts[0].accountType, 'CreditCard');
            assert.strictEqual(accounts[1].accountType, 'CreditCard');
            assert.strictEqual(accounts[2].accountType, 'Checking');
        });

        it('should deduplicate accounts by accountToken', async () => {
            const mockHtml = `
        <script>
          window.__INITIAL_STATE__ = "[\\\"~#iM\\\",[\\\"axp-consumer-context-switcher\\\",[\\\"~#iM\\\",[\\\"products\\\",[\\\"~#iM\\\",[\\\"registry\\\",[\\\"~#iM\\\",[\\\"types\\\",[\\\"~#iM\\\",[\\\"CARD_PRODUCT\\\",[[\\\"^ \\\",\\\"accountToken\\\",\\\"M8RKTYU6DXH3FCT\\\",\\\"accountKey\\\",\\\"97264F5317FE9A3B8E60F971E2BF621C\\\"],[\\\"^ \\\",\\\"accountToken\\\",\\\"M8RKTYU6DXH3FCT\\\",\\\"accountKey\\\",\\\"97264F5317FE9A3B8E60F971E2BF621C\\\"]]]]]]]]]]],\\\"details\\\",[\\\"~#iM\\\",[\\\"productsList\\\",[\\\"~#iM\\\",[\\\"M8RKTYU6DXH3FCT\\\",[\\\"~#iM\\\",[\\\"account\\\",[\\\"~#iM\\\",[\\\"display_account_number\\\",\\\"23456\\\"]],\\\"product\\\",[\\\"~#iM\\\",[\\\"description\\\",\\\"Platinum Card®\\\"]]]]]]]]]";
          window.__holocron = {};
        </script>
      `;

            mockFetch.mock.mockImplementationOnce(() =>
                Promise.resolve({
                    ok: true,
                    text: () => Promise.resolve(mockHtml),
                })
            );

            const accounts = await getAccounts(mockProfile);

            assert.strictEqual(accounts.length, 1);
        });
    });

    describe('getStatements - Credit Card', () => {
        const mockAccount = {
            profile: { sessionId: 'test', profileId: 'test', profileName: 'Test' },
            accountId: 'M8RKTYU6DXH3FCT',
            accountName: 'Platinum Card®',
            accountMask: '23456',
            accountType: 'CreditCard',
        };

        it('should retrieve credit card statements', async () => {
            const mockResponse = {
                billingStatements: {
                    recentStatements: [
                        {
                            statementEndDate: '2025-10-21',
                            downloadOptions: {
                                STATEMENT_PDF: 'https://global.americanexpress.com/api/servicing/v1/documents/statements/154DD48166489B7E6253FD1382E7353B69656380BDC975709659978149C3D86E4CD320AD51B6EEF66D41D2F1173DFFD735CC5C2106B93665E2F5E1797570687F4FB9F20389CD3DF2E6186F38EDF4D833F47EEB0FF57418C3360F781987527D92F1DE498B015F101CB125E621B3E4394F?account_key=97264F5317FE9A3B8E60F971E2BF621C&client_id=OneAmex',
                            },
                        },
                        {
                            statementEndDate: '2025-09-19',
                            downloadOptions: {
                                STATEMENT_PDF: 'https://global.americanexpress.com/api/servicing/v1/documents/statements/7725F38BF210143256CB9756E0BE069F0566B05C35C3E938CB97761068B55C24860D62982D16741961EFBCD52BDDB615DEB3F01419FCFEE7F9908C8BE7DE8C3F02B6F0657E66D05589983F2E247747CDF47EEB0FF57418C3360F781987527D92B17DE0408F00B7B506F2D8F8E8FBB535?account_key=97264F5317FE9A3B8E60F971E2BF621C&client_id=OneAmex',
                            },
                        },
                    ],
                    olderStatements: [
                        {
                            statementEndDate: '2025-08-21',
                            downloadOptions: {
                                STATEMENT_PDF: 'https://global.americanexpress.com/api/servicing/v1/documents/statements/B284F891F26D7FC42DEF3F10FEE43CF64E1391FE92F3648F09299F2B2F94479E73E7185887052E389263F938CBC193D76D046EDE90491FD38CBDCF134FB2BF33F6FDEC4E7C5F0690B9F5704EF1C4B00FFF47EEB0FF57418C3360F781987527D92DFBFC9D007B42CC75FCE844FD30E8193?account_key=97264F5317FE9A3B8E60F971E2BF621C&client_id=OneAmex',
                            },
                        },
                    ],
                },
            };

            mockFetch.mock.mockImplementationOnce(() =>
                Promise.resolve({
                    ok: true,
                    json: () => Promise.resolve(mockResponse),
                })
            );

            const statements = await getStatements(mockAccount);

            assert.strictEqual(statements.length, 3);
            assert.strictEqual(
                statements[0].statementId,
                '154DD48166489B7E6253FD1382E7353B69656380BDC975709659978149C3D86E4CD320AD51B6EEF66D41D2F1173DFFD735CC5C2106B93665E2F5E1797570687F4FB9F20389CD3DF2E6186F38EDF4D833F47EEB0FF57418C3360F781987527D92F1DE498B015F101CB125E621B3E4394F'
            );
            assert.strictEqual(statements[0].statementDate, new Date('2025-10-21').toISOString());
            assert.strictEqual(statements[0].account, mockAccount);

            // Verify statements are sorted by date descending
            assert.ok(new Date(statements[0].statementDate).getTime() > new Date(statements[1].statementDate).getTime());
            assert.ok(new Date(statements[1].statementDate).getTime() > new Date(statements[2].statementDate).getTime());

            // Verify API call
            const calls = mockFetch.mock.calls;
            assert.strictEqual(calls.length, 1);
            assert.strictEqual(calls[0].arguments[0], 'https://functions.americanexpress.com/ReadAccountActivity.web.v1');
            assert.strictEqual(calls[0].arguments[1].method, 'POST');
            assert.strictEqual(calls[0].arguments[1].headers['content-type'], 'application/json');
            assert.ok(calls[0].arguments[1].headers['one-data-correlation-id'].startsWith('CSR-'));

            const body = JSON.parse(calls[0].arguments[1].body);
            assert.strictEqual(body.accountToken, 'M8RKTYU6DXH3FCT');
            assert.strictEqual(body.axplocale, 'en-US');
            assert.strictEqual(body.view, 'STATEMENTS');
        });

        it('should handle empty statement list', async () => {
            const mockResponse = {
                billingStatements: {
                    recentStatements: [],
                    olderStatements: [],
                },
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

        it('should throw error when billingStatements is missing', async () => {
            mockFetch.mock.mockImplementationOnce(() =>
                Promise.resolve({
                    ok: true,
                    json: () => Promise.resolve({}),
                })
            );

            await assert.rejects(getStatements(mockAccount), /Invalid response format/);
        });
    });

    describe('getStatements - Checking Account', () => {
        const mockAccount = {
            profile: { sessionId: 'test', profileId: 'test', profileName: 'Test' },
            accountId: 'YE_5tntofUjM9ki_z31TfXbBu-4OYVAzZs2hcCLYVr',
            accountName: 'American Express Rewards Checking',
            accountMask: '8298',
            accountType: 'Checking',
        };

        it('should retrieve checking account statements via GraphQL', async () => {
            const mockResponse = {
                data: {
                    productAccountByAccountNumberProxy: {
                        statements: [
                            {
                                document: 'MONTHLY_STATEMENT',
                                identifier: 'URN:AXP:SCS:BANKING_STATEMENTS:DOC:BS:aa2a79dd-d58c-50f5-0b72-5455b45839f0-0456',
                                type: 'FINANCIAL',
                                year: '2025',
                                month: '10',
                                __typename: 'CheckingAccountStatement',
                            },
                            {
                                document: 'MONTHLY_STATEMENT',
                                identifier: 'URN:AXP:SCS:BANKING_STATEMENTS:DOC:BS:2694353e-f6aa-537b-bd0b-3aa552a66f01-5098',
                                type: 'FINANCIAL',
                                year: '2025',
                                month: '09',
                                __typename: 'CheckingAccountStatement',
                            },
                            {
                                document: 'MONTHLY_STATEMENT',
                                identifier: 'URN:AXP:SCS:BANKING_STATEMENTS:DOC:BS:d6cc2ece-2bbb-53b2-c125-3c3fcf1af15d-2996',
                                type: 'FINANCIAL',
                                year: '2025',
                                month: '08',
                                __typename: 'CheckingAccountStatement',
                            },
                        ],
                        __typename: 'CheckingAccount',
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

            assert.strictEqual(statements.length, 3);
            assert.strictEqual(
                statements[0].statementId,
                'URN:AXP:SCS:BANKING_STATEMENTS:DOC:BS:aa2a79dd-d58c-50f5-0b72-5455b45839f0-0456'
            );
            assert.strictEqual(statements[0].statementDate, new Date(2025, 10, 0).toISOString()); // Oct 31, 2025 (last day of month)
            assert.strictEqual(statements[0].account, mockAccount);

            // Verify GraphQL call
            const calls = mockFetch.mock.calls;
            assert.strictEqual(calls.length, 1);
            assert.strictEqual(calls[0].arguments[0], 'https://graph.americanexpress.com/graphql');
            assert.strictEqual(calls[0].arguments[1].method, 'POST');
            assert.strictEqual(calls[0].arguments[1].headers['content-type'], 'application/json');
            assert.strictEqual(calls[0].arguments[1].headers['ce-source'], 'WEB');

            const body = JSON.parse(calls[0].arguments[1].body);
            assert.strictEqual(body.operationName, 'bankingAccountDocuments');
            assert.strictEqual(body.variables.accountFilter.accountNumberProxy, mockAccount.accountId);
            assert.strictEqual(body.variables.documentFilter.type, 'FINANCIAL');
            assert.ok(body.query.includes('bankingAccountDocuments'));
        });

        it('should handle empty checking statement list', async () => {
            const mockResponse = {
                data: {
                    productAccountByAccountNumberProxy: {
                        statements: [],
                        __typename: 'CheckingAccount',
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

            assert.strictEqual(statements.length, 0);
        });
    });

    describe('downloadStatement - Credit Card', () => {
        const mockAccount = {
            profile: { sessionId: 'test', profileId: 'test', profileName: 'Test' },
            accountId: 'M8RKTYU6DXH3FCT',
            accountName: 'Platinum Card®',
            accountMask: '23456',
            accountType: 'CreditCard',
        };

        const mockStatement = {
            account: mockAccount,
            statementId:
                '154DD48166489B7E6253FD1382E7353B69656380BDC975709659978149C3D86E4CD320AD51B6EEF66D41D2F1173DFFD735CC5C2106B93665E2F5E1797570687F4FB9F20389CD3DF2E6186F38EDF4D833F47EEB0FF57418C3360F781987527D92F1DE498B015F101CB125E621B3E4394F',
            statementDate: new Date('2025-10-21'),
        };

        it('should download credit card statement PDF', async () => {
            const mockPdfBlob = new Blob(['PDF content'], { type: 'application/pdf' });

            const mockOverviewHtml = `
        <script>
          window.__INITIAL_STATE__ = "[\\\"~#iM\\\",[\\\"axp-consumer-context-switcher\\\",[\\\"~#iM\\\",[\\\"products\\\",[\\\"~#iM\\\",[\\\"registry\\\",[\\\"~#iM\\\",[\\\"types\\\",[\\\"~#iM\\\",[\\\"CARD_PRODUCT\\\",[[\\\"^ \\\",\\\"accountToken\\\",\\\"M8RKTYU6DXH3FCT\\\",\\\"accountKey\\\",\\\"97264F5317FE9A3B8E60F971E2BF621C\\\"]]]]]]]]]]]]";
          window.__holocron = {};
        </script>
      `;

            let callCount = 0;
            mockFetch.mock.mockImplementation(() => {
                callCount++;
                if (callCount === 1) {
                    return Promise.resolve({
                        ok: true,
                        text: () => Promise.resolve(mockOverviewHtml),
                    });
                } else {
                    return Promise.resolve({
                        ok: true,
                        blob: () => Promise.resolve(mockPdfBlob),
                    });
                }
            });

            const blob = await downloadStatement(mockStatement);

            assert.strictEqual(blob, mockPdfBlob);
            assert.ok(blob.size > 0);

            // Verify download API call
            const calls = mockFetch.mock.calls;
            assert.strictEqual(calls.length, 2);
            assert.ok(calls[1].arguments[0].includes('/api/servicing/v1/documents/statements/'));
            assert.strictEqual(calls[1].arguments[1].method, 'GET');
            assert.strictEqual(calls[1].arguments[1].credentials, 'include');

            const downloadUrl = calls[1].arguments[0];
            assert.ok(downloadUrl.includes(mockStatement.statementId));
            assert.ok(downloadUrl.includes('account_key=97264F5317FE9A3B8E60F971E2BF621C'));
            assert.ok(downloadUrl.includes('client_id=OneAmex'));
        });

        it('should throw error when downloaded PDF is empty', async () => {
            const mockEmptyBlob = new Blob([], { type: 'application/pdf' });

            const mockOverviewHtml = `
        <script>
          window.__INITIAL_STATE__ = "[\\\"~#iM\\\",[\\\"axp-consumer-context-switcher\\\",[\\\"~#iM\\\",[\\\"products\\\",[\\\"~#iM\\\",[\\\"registry\\\",[\\\"~#iM\\\",[\\\"types\\\",[\\\"~#iM\\\",[\\\"CARD_PRODUCT\\\",[[\\\"^ \\\",\\\"accountToken\\\",\\\"M8RKTYU6DXH3FCT\\\",\\\"accountKey\\\",\\\"97264F5317FE9A3B8E60F971E2BF621C\\\"]]]]]]]]]]]]";
          window.__holocron = {};
        </script>
      `;

            let callCount = 0;
            mockFetch.mock.mockImplementation(() => {
                callCount++;
                if (callCount === 1) {
                    return Promise.resolve({
                        ok: true,
                        text: () => Promise.resolve(mockOverviewHtml),
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

    describe('downloadStatement - Checking Account', () => {
        const mockAccount = {
            profile: { sessionId: 'test', profileId: 'test', profileName: 'Test' },
            accountId: 'YE_5tntofUjM9ki_z31TfXbBu-4OYVAzZs2hcCLYVr',
            accountName: 'American Express Rewards Checking',
            accountMask: '8298',
            accountType: 'Checking',
        };

        const mockStatement = {
            account: mockAccount,
            statementId: 'URN:AXP:SCS:BANKING_STATEMENTS:DOC:BS:aa2a79dd-d58c-50f5-0b72-5455b45839f0-0456',
            statementDate: new Date(2025, 10, 0),
        };

        it('should download checking statement PDF via GraphQL', async () => {
            const pdfContent = 'PDF content';
            const base64Content = Buffer.from(pdfContent).toString('base64');

            const mockResponse = {
                data: {
                    checkingAccountStatement: {
                        name: 'statement.pdf',
                        contentType: 'application/pdf',
                        content: base64Content,
                        __typename: 'CheckingAccountStatementDocument',
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

            assert.ok(blob instanceof Blob);
            assert.strictEqual(blob.type, 'application/pdf');
            assert.ok(blob.size > 0);

            // Verify GraphQL call
            const calls = mockFetch.mock.calls;
            assert.strictEqual(calls.length, 1);
            assert.strictEqual(calls[0].arguments[0], 'https://graph.americanexpress.com/graphql');
            assert.strictEqual(calls[0].arguments[1].method, 'POST');
            assert.strictEqual(calls[0].arguments[1].headers['content-type'], 'application/json');

            const body = JSON.parse(calls[0].arguments[1].body);
            assert.strictEqual(body.operationName, 'accountDocument');
            assert.strictEqual(body.variables.filter.identifier, mockStatement.statementId);
            assert.strictEqual(body.variables.filter.accountNumberProxy, mockAccount.accountId);
            assert.ok(body.query.includes('accountDocument'));
        });

        it('should throw error when statement content is missing', async () => {
            const mockResponse = {
                data: {
                    checkingAccountStatement: {
                        name: 'statement.pdf',
                        contentType: 'application/pdf',
                        content: null,
                        __typename: 'CheckingAccountStatementDocument',
                    },
                },
            };

            mockFetch.mock.mockImplementationOnce(() =>
                Promise.resolve({
                    ok: true,
                    json: () => Promise.resolve(mockResponse),
                })
            );

            await assert.rejects(downloadStatement(mockStatement), /No statement content returned/);
        });
    });

    describe('Error Handling', () => {
        it('should throw error when fetch fails', async () => {
            mockFetch.mock.mockImplementationOnce(() =>
                Promise.resolve({
                    ok: false,
                    status: 401,
                    statusText: 'Unauthorized',
                    url: 'https://global.americanexpress.com/overview',
                })
            );

            await assert.rejects(getProfile('test-session'), /American Express API request failed: 401 Unauthorized/);
        });

        it('should handle network errors', async () => {
            mockFetch.mock.mockImplementationOnce(() => Promise.reject(new Error('Network error')));

            await assert.rejects(getProfile('test-session'));
        });
    });
});



