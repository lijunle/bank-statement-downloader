/**
 * Unit tests for PayPal bank statement API implementation
 * Tests cover both PayPal balance account and credit card functionality
 * 
 * Note: All mock data is based on actual content extracted from
 * analyze/paypal.md and browser validation to ensure tests match real API responses.
 */

import { describe, it, beforeEach, mock } from 'node:test';
import assert from 'node:assert/strict';

// Mock global fetch
const mockFetch = mock.fn();
global.fetch = mockFetch;

// Mock localStorage for getSessionId
global.localStorage = {
    getItem: mock.fn((key) => {
        if (key === 'vf') {
            return 'bZAgqCN_jdOf4PKZ4IeMXAc-LIqPwq6UQxtsDoiq0v2Uu1ysnXzf3iylhiN_8wqm8A1sS6mGowQ_LIhBU';
        }
        return null;
    }),
};

// Mock sessionStorage for fallback
global.sessionStorage = {
    getItem: mock.fn(() => null),
};

// Mock document.cookie for last resort
global.document = {
    cookie: 'TLTSID=gbmmcbdl-tfttjpo-je; other=value',
};

// Import the module after setting up mocks
const paypalModule = await import('../bank/paypal.mjs');
const { bankId, getSessionId, getProfile, getAccounts, getStatements, downloadStatement } = paypalModule;

describe('PayPal API', () => {
    beforeEach(() => {
        mockFetch.mock.resetCalls();
        global.localStorage.getItem.mock.resetCalls();
        global.sessionStorage.getItem.mock.resetCalls();
    });

    describe('bankId', () => {
        it('should return the correct bank identifier', () => {
            assert.strictEqual(bankId, 'paypal');
        });
    });

    describe('getSessionId', () => {
        it('should extract session ID from localStorage vf', () => {
            const sessionId = getSessionId();
            assert.strictEqual(sessionId, 'bZAgqCN_jdOf4PKZ4IeMXAc-LIqPwq6UQxtsDoiq0v2Uu1ysnXzf3iylhiN_8wqm8A1sS6mGowQ_LIhBU');

            const calls = global.localStorage.getItem.mock.calls;
            assert.strictEqual(calls.length, 1);
            assert.strictEqual(calls[0].arguments[0], 'vf');
        });

        it('should fall back to sessionStorage PP_NC when localStorage vf is not available', () => {
            // Temporarily change localStorage behavior
            const originalGetItem = global.localStorage.getItem;
            global.localStorage.getItem = mock.fn(() => null);
            global.sessionStorage.getItem = mock.fn((key) => {
                if (key === 'PP_NC') return 'session-storage-token';
                return null;
            });

            const sessionId = getSessionId();
            assert.strictEqual(sessionId, 'session-storage-token');

            // Restore
            global.localStorage.getItem = originalGetItem;
        });

        it('should fall back to TLTSID cookie when both storage methods fail', () => {
            // Temporarily change storage behavior
            const originalLocalStorage = global.localStorage.getItem;
            const originalSessionStorage = global.sessionStorage.getItem;
            global.localStorage.getItem = mock.fn(() => null);
            global.sessionStorage.getItem = mock.fn(() => null);

            const sessionId = getSessionId();
            assert.strictEqual(sessionId, 'gbmmcbdl-tfttjpo-je');

            // Restore
            global.localStorage.getItem = originalLocalStorage;
            global.sessionStorage.getItem = originalSessionStorage;
        });

        it('should throw error when no session is found', () => {
            const originalLocalStorage = global.localStorage.getItem;
            const originalSessionStorage = global.sessionStorage.getItem;
            const originalCookie = global.document.cookie;

            global.localStorage.getItem = mock.fn(() => null);
            global.sessionStorage.getItem = mock.fn(() => null);
            global.document.cookie = 'other=value';

            assert.throws(() => getSessionId(), /PayPal session not found/);

            // Restore
            global.localStorage.getItem = originalLocalStorage;
            global.sessionStorage.getItem = originalSessionStorage;
            global.document.cookie = originalCookie;
        });
    });

    describe('getProfile', () => {
        it('should retrieve profile information from chat-meta API', async () => {
            const mockResponse = {
                userInfo: {
                    firstName: 'John Doe',
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
                profileId: 'test-session-id',
                profileName: 'John Doe',
            });

            const calls = mockFetch.mock.calls;
            assert.strictEqual(calls.length, 1);
            assert.match(calls[0].arguments[0], /\/smartchat\/chat-meta/);
            assert.strictEqual(calls[0].arguments[1].credentials, 'include');
            assert.strictEqual(calls[0].arguments[1].headers.accept, 'application/json');
        });

        it('should throw error when API request fails', async () => {
            mockFetch.mock.mockImplementationOnce(() =>
                Promise.resolve({
                    ok: false,
                    status: 401,
                    statusText: 'Unauthorized',
                })
            );

            await assert.rejects(
                getProfile('test-session-id'),
                /Failed to retrieve PayPal user profile: 401 Unauthorized/
            );
        });

        it('should throw error when userInfo is missing', async () => {
            mockFetch.mock.mockImplementationOnce(() =>
                Promise.resolve({
                    ok: true,
                    json: () => Promise.resolve({}),
                })
            );

            await assert.rejects(
                getProfile('test-session-id'),
                /PayPal user profile data is missing or invalid/
            );
        });
    });

    describe('getAccounts', () => {
        it('should detect both balance and credit card accounts', async () => {
            const mockHtml = `
                <html>
                    <body>
                        <a href="/myaccount/credit/rewards-card/">Credit Card</a>
                        <div class="balance">PayPal balance</div>
                        <script>
                            var data = {
                                "creditAccountId": "22FE-ED53-B5D4177B-0C52-FFCE75E1E3ED",
                                "header": "PayPal Cashback World Mastercard ••1092"
                            };
                        </script>
                        <span class="card-mask">••1092</span>
                    </body>
                </html>
            `;

            mockFetch.mock.mockImplementationOnce(() =>
                Promise.resolve({
                    ok: true,
                    text: () => Promise.resolve(mockHtml),
                })
            );

            const profile = {
                sessionId: 'test-session',
                profileId: 'test-profile',
                profileName: 'John Doe',
            };

            const accounts = await getAccounts(profile);

            assert.strictEqual(accounts.length, 2);

            // Balance account
            assert.strictEqual(accounts[0].accountId, 'paypal_balance_usd');
            assert.strictEqual(accounts[0].accountName, 'PayPal Balance (USD)');
            assert.strictEqual(accounts[0].accountMask, 'USD');
            assert.strictEqual(accounts[0].accountType, 'Checking');
            assert.strictEqual(accounts[0].profile, profile);

            // Credit card account
            assert.strictEqual(accounts[1].accountId, '22FE-ED53-B5D4177B-0C52-FFCE75E1E3ED');
            assert.strictEqual(accounts[1].accountName, 'PayPal Cashback World Mastercard');
            assert.strictEqual(accounts[1].accountMask, '1092');
            assert.strictEqual(accounts[1].accountType, 'CreditCard');
            assert.strictEqual(accounts[1].profile, profile);
        });

        it('should detect balance account only when no credit card present', async () => {
            const mockHtml = `
                <html>
                    <body>
                        <div class="balance">PayPal balance</div>
                    </body>
                </html>
            `;

            mockFetch.mock.mockImplementationOnce(() =>
                Promise.resolve({
                    ok: true,
                    text: () => Promise.resolve(mockHtml),
                })
            );

            const profile = {
                sessionId: 'test-session',
                profileId: 'test-profile',
                profileName: 'John Doe',
            };

            const accounts = await getAccounts(profile);

            assert.strictEqual(accounts.length, 1);
            assert.strictEqual(accounts[0].accountType, 'Checking');
        });

        it('should support short encrypted account number format', async () => {
            const mockHtml = `
                <html>
                    <body>
                        <a href="/myaccount/credit/rewards-card/">Credit Card</a>
                        <script>
                            var data = {
                                "encryptedAccountNumber": "TD03BGKFKFKZ5",
                                "header": "PayPal Credit Card ••2345"
                            };
                        </script>
                        <span>••2345</span>
                    </body>
                </html>
            `;

            mockFetch.mock.mockImplementationOnce(() =>
                Promise.resolve({
                    ok: true,
                    text: () => Promise.resolve(mockHtml),
                })
            );

            const profile = {
                sessionId: 'test-session',
                profileId: 'test-profile',
                profileName: 'John Doe',
            };

            const accounts = await getAccounts(profile);

            assert.strictEqual(accounts.length, 2);
            assert.strictEqual(accounts[1].accountId, 'TD03BGKFKFKZ5');
            assert.strictEqual(accounts[1].accountMask, '2345');
        });

        it('should use fallback values when credit card ID not found', async () => {
            const mockHtml = `
                <html>
                    <body>
                        <a href="/myaccount/credit/rewards-card/">Credit Card</a>
                    </body>
                </html>
            `;

            mockFetch.mock.mockImplementationOnce(() =>
                Promise.resolve({
                    ok: true,
                    text: () => Promise.resolve(mockHtml),
                })
            );

            const profile = {
                sessionId: 'test-session',
                profileId: 'test-profile',
                profileName: 'John Doe',
            };

            const accounts = await getAccounts(profile);

            assert.strictEqual(accounts.length, 2);
            assert.strictEqual(accounts[1].accountId, 'paypal_credit_card');
            assert.strictEqual(accounts[1].accountName, 'PayPal Credit Card');
            assert.strictEqual(accounts[1].accountMask, 'XXXX');
        });

        it('should throw error when API request fails', async () => {
            mockFetch.mock.mockImplementationOnce(() =>
                Promise.resolve({
                    ok: false,
                    status: 403,
                    statusText: 'Forbidden',
                })
            );

            const profile = {
                sessionId: 'test-session',
                profileId: 'test-profile',
                profileName: 'John Doe',
            };

            await assert.rejects(
                getAccounts(profile),
                /Failed to retrieve PayPal accounts: 403 Forbidden/
            );
        });
    });

    describe('getStatements', () => {
        describe('Balance account', () => {
            it('should retrieve balance account statements', async () => {
                const mockResponse = {
                    data: {
                        statements: [
                            {
                                year: '2025',
                                details: [
                                    { date: '20251001', month: 'October', monthNumber: 10, year: '2025' },
                                    { date: '20250901', month: 'September', monthNumber: 9, year: '2025' },
                                ],
                            },
                            {
                                year: '2024',
                                details: [
                                    { date: '20241201', month: 'December', monthNumber: 12, year: '2024' },
                                ],
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

                const account = {
                    accountId: 'paypal_balance_usd',
                    accountType: 'Checking',
                    accountName: 'PayPal Balance (USD)',
                    accountMask: 'USD',
                    profile: { sessionId: 'test-session' },
                };

                const statements = await getStatements(account);

                assert.strictEqual(statements.length, 3);
                assert.strictEqual(statements[0].statementId, '20251001');
                assert.strictEqual(statements[0].statementDate, '2025-10-01');
                assert.strictEqual(statements[0].account, account);
                assert.strictEqual(statements[1].statementId, '20250901');
                assert.strictEqual(statements[1].statementDate, '2025-09-01');
                assert.strictEqual(statements[2].statementId, '20241201');
                assert.strictEqual(statements[2].statementDate, '2024-12-01');

                const calls = mockFetch.mock.calls;
                assert.strictEqual(calls.length, 1);
                assert.match(calls[0].arguments[0], /\/myaccount\/statements\/api\/statements$/);
            });

            it('should handle empty statement list', async () => {
                mockFetch.mock.mockImplementationOnce(() =>
                    Promise.resolve({
                        ok: true,
                        json: () => Promise.resolve({ data: { statements: [] } }),
                    })
                );

                const account = {
                    accountId: 'paypal_balance_usd',
                    accountType: 'Checking',
                    profile: { sessionId: 'test-session' },
                };

                const statements = await getStatements(account);
                assert.strictEqual(statements.length, 0);
            });

            it('should throw error when API request fails', async () => {
                mockFetch.mock.mockImplementationOnce(() =>
                    Promise.resolve({
                        ok: false,
                        status: 401,
                        statusText: 'Unauthorized',
                    })
                );

                const account = {
                    accountId: 'paypal_balance_usd',
                    accountType: 'Checking',
                    profile: { sessionId: 'test-session' },
                };

                await assert.rejects(
                    getStatements(account),
                    /Failed to retrieve PayPal balance statements: 401 Unauthorized/
                );
            });
        });

        describe('Credit card', () => {
            it('should retrieve credit card statements with CSRF token', async () => {
                // Mock CSRF token fetch - must use exact pattern from real HTML
                const mockCsrfHtml = `
                    <html>
                        <script>
                            window.__INITIAL_STATE__ = {"_csrf":"i0X8jmzOuLWgtntg\\u002B\\u002FQANixE8HL6mGkTCa7ZpF="};
                        </script>
                    </html>
                `;

                const mockStatementsResponse = {
                    data: {
                        revolvingCreditStatementHeaders: {
                            statementHeaders: [
                                {
                                    statementId: '2025-09-09',
                                    formattedClosingDate: {
                                        formattedDateString: '9/9/2025',
                                        formattedDateStringLong: 'September 9, 2025',
                                    },
                                },
                                {
                                    statementId: '2025-08-11',
                                    formattedClosingDate: {
                                        formattedDateString: '8/11/2025',
                                        formattedDateStringLong: 'August 11, 2025',
                                    },
                                },
                            ],
                        },
                    },
                };

                mockFetch.mock.mockImplementation((url) => {
                    if (url.includes('rewards-card/?source=FINANCIAL_SNAPSHOT')) {
                        return Promise.resolve({
                            ok: true,
                            text: () => Promise.resolve(mockCsrfHtml),
                        });
                    }
                    if (url.includes('Web_CONSUMER_REWARDS_US_Hub_StatementHeaders')) {
                        return Promise.resolve({
                            ok: true,
                            json: () => Promise.resolve(mockStatementsResponse),
                        });
                    }
                });

                const account = {
                    accountId: '22FE-ED53-B5D4177B-0C52-FFCE75E1E3ED',
                    accountType: 'CreditCard',
                    accountName: 'PayPal Cashback World Mastercard',
                    accountMask: '1092',
                    profile: { sessionId: 'test-session' },
                };

                const statements = await getStatements(account);

                assert.strictEqual(statements.length, 2);
                assert.strictEqual(statements[0].statementId, '2025-09-09');
                assert.strictEqual(statements[0].statementDate, '2025-09-09');
                assert.strictEqual(statements[0].account, account);
                assert.strictEqual(statements[1].statementId, '2025-08-11');
                assert.strictEqual(statements[1].statementDate, '2025-08-11');

                const calls = mockFetch.mock.calls;
                assert.strictEqual(calls.length, 2);
                // Verify CSRF token was decoded correctly
                const graphqlCall = calls[1];
                assert.strictEqual(graphqlCall.arguments[1].headers['x-csrf-token'], 'i0X8jmzOuLWgtntg+/QANixE8HL6mGkTCa7ZpF=');
            });

            it('should throw error when CSRF token not found', async () => {
                mockFetch.mock.mockImplementationOnce(() =>
                    Promise.resolve({
                        ok: true,
                        text: () => Promise.resolve('<html><body>No token here</body></html>'),
                    })
                );

                const account = {
                    accountId: '22FE-ED53-B5D4177B-0C52-FFCE75E1E3ED',
                    accountType: 'CreditCard',
                    profile: { sessionId: 'test-session' },
                };

                await assert.rejects(
                    getStatements(account),
                    /CSRF token not found in page/
                );
            });

            it('should decode unicode escapes in CSRF token', async () => {
                const mockCsrfHtml = `
                    <html>
                        <script>
                            var data = {"_csrf":"token\\u002Fwith\\u002Bescapes\\u003D"};
                        </script>
                    </html>
                `;

                const mockStatementsResponse = {
                    data: {
                        revolvingCreditStatementHeaders: {
                            statementHeaders: [],
                        },
                    },
                };

                mockFetch.mock.mockImplementation((url) => {
                    if (url.includes('rewards-card/?source=FINANCIAL_SNAPSHOT')) {
                        return Promise.resolve({
                            ok: true,
                            text: () => Promise.resolve(mockCsrfHtml),
                        });
                    }
                    return Promise.resolve({
                        ok: true,
                        json: () => Promise.resolve(mockStatementsResponse),
                    });
                });

                const account = {
                    accountId: '22FE-ED53-B5D4177B-0C52-FFCE75E1E3ED',
                    accountType: 'CreditCard',
                    profile: { sessionId: 'test-session' },
                };

                await getStatements(account);

                const graphqlCall = mockFetch.mock.calls[1];
                // Verify \u002F -> /, \u002B -> +, \u003D -> =
                assert.strictEqual(graphqlCall.arguments[1].headers['x-csrf-token'], 'token/with+escapes=');
            });

            it('should throw error when GraphQL request fails', async () => {
                const mockCsrfHtml = '<html><script>var config = {"_csrf":"token123"};</script></html>';

                mockFetch.mock.mockImplementation((url) => {
                    if (url.includes('rewards-card/?source=FINANCIAL_SNAPSHOT')) {
                        return Promise.resolve({
                            ok: true,
                            text: () => Promise.resolve(mockCsrfHtml),
                        });
                    }
                    return Promise.resolve({
                        ok: false,
                        status: 403,
                        statusText: 'Forbidden',
                    });
                });

                const account = {
                    accountId: '22FE-ED53-B5D4177B-0C52-FFCE75E1E3ED',
                    accountType: 'CreditCard',
                    profile: { sessionId: 'test-session' },
                };

                await assert.rejects(
                    getStatements(account),
                    /Failed to retrieve credit card statements: 403 Forbidden/
                );
            });
        });
    });

    describe('downloadStatement', () => {
        describe('Balance account', () => {
            it('should download balance statement PDF', async () => {
                const mockPdfBuffer = Buffer.alloc(300000, 'PDF');

                mockFetch.mock.mockImplementationOnce(() =>
                    Promise.resolve({
                        ok: true,
                        blob: () => Promise.resolve(new Blob([mockPdfBuffer], { type: 'application/pdf' })),
                    })
                );

                const statement = {
                    statementId: '20251001',
                    statementDate: '2025-10-01',
                    account: {
                        accountId: 'paypal_balance_usd',
                        accountType: 'Checking',
                        profile: { sessionId: 'test-session' },
                    },
                };

                const blob = await downloadStatement(statement);

                assert.ok(blob instanceof Blob);
                assert.strictEqual(blob.size, 300000);

                const calls = mockFetch.mock.calls;
                assert.strictEqual(calls.length, 1);
                assert.match(calls[0].arguments[0], /\/myaccount\/statements\/download\?monthList=20251001&reportType=standard/);
                assert.strictEqual(calls[0].arguments[1].credentials, 'include');
            });

            it('should handle ISO date format in statementId', async () => {
                const mockPdfBuffer = Buffer.alloc(300000, 'PDF');

                mockFetch.mock.mockImplementationOnce(() =>
                    Promise.resolve({
                        ok: true,
                        blob: () => Promise.resolve(new Blob([mockPdfBuffer], { type: 'application/pdf' })),
                    })
                );

                const statement = {
                    statementId: '2025-10-01',
                    statementDate: '2025-10-01',
                    account: {
                        accountType: 'Checking',
                        profile: { sessionId: 'test-session' },
                    },
                };

                await downloadStatement(statement);

                const calls = mockFetch.mock.calls;
                // Should convert 2025-10-01 to 20251001
                assert.match(calls[0].arguments[0], /monthList=20251001/);
            });

            it('should throw error when PDF is too small', async () => {
                const mockPdfBuffer = Buffer.alloc(5000, 'PDF'); // Less than 10KB

                mockFetch.mock.mockImplementationOnce(() =>
                    Promise.resolve({
                        ok: true,
                        blob: () => Promise.resolve(new Blob([mockPdfBuffer], { type: 'application/pdf' })),
                    })
                );

                const statement = {
                    statementId: '20251001',
                    statementDate: '2025-10-01',
                    account: {
                        accountType: 'Checking',
                        profile: { sessionId: 'test-session' },
                    },
                };

                await assert.rejects(
                    downloadStatement(statement),
                    /Downloaded statement file is too small \(5000 bytes\)/
                );
            });

            it('should throw error when download fails', async () => {
                mockFetch.mock.mockImplementationOnce(() =>
                    Promise.resolve({
                        ok: false,
                        status: 404,
                        statusText: 'Not Found',
                    })
                );

                const statement = {
                    statementId: '20251001',
                    statementDate: '2025-10-01',
                    account: {
                        accountType: 'Checking',
                        profile: { sessionId: 'test-session' },
                    },
                };

                await assert.rejects(
                    downloadStatement(statement),
                    /Failed to download PayPal balance statement: 404 Not Found/
                );
            });
        });

        describe('Credit card', () => {
            it('should download credit card statement PDF with CSRF token', async () => {
                const mockCsrfHtml = '<html><script>var config = {"_csrf":"token123"};</script></html>';
                const mockPdfBuffer = Buffer.alloc(1100000, 'PDF');

                mockFetch.mock.mockImplementation((url) => {
                    if (url.includes('rewards-card/?source=FINANCIAL_SNAPSHOT')) {
                        return Promise.resolve({
                            ok: true,
                            text: () => Promise.resolve(mockCsrfHtml),
                        });
                    }
                    if (url.includes('statement/download')) {
                        return Promise.resolve({
                            ok: true,
                            blob: () => Promise.resolve(new Blob([mockPdfBuffer], { type: 'application/octet-stream' })),
                        });
                    }
                });

                const statement = {
                    statementId: '2025-09-09',
                    statementDate: '2025-09-09',
                    account: {
                        accountId: '22FE-ED53-B5D4177B-0C52-FFCE75E1E3ED',
                        accountType: 'CreditCard',
                        profile: { sessionId: 'test-session' },
                    },
                };

                const blob = await downloadStatement(statement);

                assert.ok(blob instanceof Blob);
                assert.strictEqual(blob.size, 1100000);

                const calls = mockFetch.mock.calls;
                assert.strictEqual(calls.length, 2); // CSRF fetch + download

                const downloadCall = calls[1];
                assert.match(downloadCall.arguments[0], /\/statement\/download$/);
                assert.strictEqual(downloadCall.arguments[1].method, 'POST');
                assert.strictEqual(downloadCall.arguments[1].headers['x-csrf-token'], 'token123');

                const body = JSON.parse(downloadCall.arguments[1].body);
                assert.strictEqual(body.variables.statementId, '2025-09-09');
                assert.strictEqual(body.variables.creditAccountId, '22FE-ED53-B5D4177B-0C52-FFCE75E1E3ED');
            });

            it('should decode unicode escapes in CSRF token for download', async () => {
                const mockCsrfHtml = '<html><script>var config = {"_csrf":"abc\\u002Fdef\\u002Bghi"};</script></html>';
                const mockPdfBuffer = Buffer.alloc(1100000, 'PDF');

                mockFetch.mock.mockImplementation((url) => {
                    if (url.includes('rewards-card/?source=FINANCIAL_SNAPSHOT')) {
                        return Promise.resolve({
                            ok: true,
                            text: () => Promise.resolve(mockCsrfHtml),
                        });
                    }
                    return Promise.resolve({
                        ok: true,
                        blob: () => Promise.resolve(new Blob([mockPdfBuffer], { type: 'application/octet-stream' })),
                    });
                });

                const statement = {
                    statementId: '2025-09-09',
                    statementDate: '2025-09-09',
                    account: {
                        accountId: '22FE-ED53-B5D4177B-0C52-FFCE75E1E3ED',
                        accountType: 'CreditCard',
                        profile: { sessionId: 'test-session' },
                    },
                };

                await downloadStatement(statement);

                const downloadCall = mockFetch.mock.calls[1];
                assert.strictEqual(downloadCall.arguments[1].headers['x-csrf-token'], 'abc/def+ghi');
            });

            it('should throw error when credit card PDF is too small', async () => {
                const mockCsrfHtml = '<html><script>var config = {"_csrf":"token123"};</script></html>';
                const mockPdfBuffer = Buffer.alloc(5000, 'PDF');

                mockFetch.mock.mockImplementation((url) => {
                    if (url.includes('rewards-card/?source=FINANCIAL_SNAPSHOT')) {
                        return Promise.resolve({
                            ok: true,
                            text: () => Promise.resolve(mockCsrfHtml),
                        });
                    }
                    return Promise.resolve({
                        ok: true,
                        blob: () => Promise.resolve(new Blob([mockPdfBuffer], { type: 'application/octet-stream' })),
                    });
                });

                const statement = {
                    statementId: '2025-09-09',
                    statementDate: '2025-09-09',
                    account: {
                        accountId: '22FE-ED53-B5D4177B-0C52-FFCE75E1E3ED',
                        accountType: 'CreditCard',
                        profile: { sessionId: 'test-session' },
                    },
                };

                await assert.rejects(
                    downloadStatement(statement),
                    /Downloaded statement file is too small \(5000 bytes\)/
                );
            });

            it('should throw error when credit card download fails', async () => {
                const mockCsrfHtml = '<html><script>var config = {"_csrf":"token123"};</script></html>';

                mockFetch.mock.mockImplementation((url) => {
                    if (url.includes('rewards-card/?source=FINANCIAL_SNAPSHOT')) {
                        return Promise.resolve({
                            ok: true,
                            text: () => Promise.resolve(mockCsrfHtml),
                        });
                    }
                    return Promise.resolve({
                        ok: false,
                        status: 403,
                        statusText: 'Forbidden',
                    });
                });

                const statement = {
                    statementId: '2025-09-09',
                    statementDate: '2025-09-09',
                    account: {
                        accountId: '22FE-ED53-B5D4177B-0C52-FFCE75E1E3ED',
                        accountType: 'CreditCard',
                        profile: { sessionId: 'test-session' },
                    },
                };

                await assert.rejects(
                    downloadStatement(statement),
                    /Failed to download credit card statement: 403 Forbidden/
                );
            });
        });
    });
});
