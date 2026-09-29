/**
 * Unit tests for Chime bank statement API implementation
 * Tests cover GraphQL API with persisted queries
 * 
 * Fixtures use synthetic values and documented response shapes.
 */

import { describe, it, beforeEach, mock } from 'node:test';
import assert from 'node:assert/strict';

// Mock global fetch
const mockFetch = mock.fn();
global.fetch = mockFetch;

// Mock document.cookie for getSessionId
global.document = {
    cookie: 'chime_session=id=synthetic-session&end_ts=946684800000; __Host-uid=1001; chime_user_id=1001',
};

// Mock Intl for timezone
global.Intl = {
    DateTimeFormat: () => ({
        resolvedOptions: () => ({ timeZone: 'America/Los_Angeles' })
    })
};

// Import the module after setting up mocks
const chimeModule = await import('../bank/chime.mjs');
const { bankId, getSessionId, getProfile, getAccounts, getStatements, downloadStatement } = chimeModule;

describe('Chime API', () => {
    beforeEach(() => {
        // Reset fetch mock between tests for isolation
        mockFetch.mock.resetCalls();
    });

    describe('bankId', () => {
        it('should return the correct bank identifier', () => {
            assert.strictEqual(bankId, 'chime');
        });
    });

    describe('getSessionId', () => {
        it('should extract session ID from chime_session cookie', () => {
            const sessionId = getSessionId();
            assert.strictEqual(sessionId, 'synthetic-session');
        });

        it('should fall back to __Host-authn cookie if chime_session not found', () => {
            const originalCookie = document.cookie;
            document.cookie = '__Host-authn=test-authn-value; other=value';

            const sessionId = getSessionId();
            assert.strictEqual(sessionId, 'test-authn-value');

            document.cookie = originalCookie;
        });

        it('should throw error when no session cookies are found', () => {
            const originalCookie = document.cookie;
            document.cookie = 'other=value';

            assert.throws(() => getSessionId(), /Chime session cookie not found/);

            document.cookie = originalCookie;
        });
    });

    describe('getProfile', () => {
        it('should extract profile information from UserQuery', async () => {
            const mockResponse = {
                data: {
                    me: {
                        first_name: 'John',
                        last_name: 'Doe',
                        username: 'John-Doe',
                        email: 'john.doe@example.com',
                        phone: '1234567890',
                        address: '123 Main St',
                        city: 'Anytown',
                        state_code: 'USA',
                        zip_code: '12345',
                        __typename: 'User'
                    }
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
                profileId: '1001',
                profileName: 'John Doe',
            });

            // Verify API call
            const calls = mockFetch.mock.calls;
            assert.strictEqual(calls.length, 1);
            assert.strictEqual(calls[0].arguments[0], 'https://app.chime.com/api/graphql');
            assert.strictEqual(calls[0].arguments[1].method, 'POST');
            assert.strictEqual(calls[0].arguments[1].credentials, 'include');

            const requestBody = JSON.parse(calls[0].arguments[1].body);
            assert.strictEqual(requestBody.operationName, 'UserQuery');
            assert.strictEqual(requestBody.extensions.persistedQuery.sha256Hash, 'md5:f4a5ebcc4103cf23f7e582af45b0edd0');
        });

        it('should handle profile with only first name', async () => {
            const mockResponse = {
                data: {
                    me: {
                        first_name: 'Alice',
                        last_name: '',
                        email: 'alice@example.com',
                        __typename: 'User'
                    }
                }
            };

            mockFetch.mock.mockImplementationOnce(() =>
                Promise.resolve({
                    ok: true,
                    json: () => Promise.resolve(mockResponse),
                })
            );

            const profile = await getProfile('test-session-id');
            assert.strictEqual(profile.profileName, 'Alice');
        });

        it('should handle profile with only last name', async () => {
            const mockResponse = {
                data: {
                    me: {
                        first_name: '',
                        last_name: 'Smith',
                        email: 'smith@example.com',
                        __typename: 'User'
                    }
                }
            };

            mockFetch.mock.mockImplementationOnce(() =>
                Promise.resolve({
                    ok: true,
                    json: () => Promise.resolve(mockResponse),
                })
            );

            const profile = await getProfile('test-session-id');
            assert.strictEqual(profile.profileName, 'Smith');
        });

        it('should fall back to profile ID when name is not available', async () => {
            const mockResponse = {
                data: {
                    me: {
                        first_name: '',
                        last_name: '',
                        email: 'user@example.com',
                        __typename: 'User'
                    }
                }
            };

            mockFetch.mock.mockImplementationOnce(() =>
                Promise.resolve({
                    ok: true,
                    json: () => Promise.resolve(mockResponse),
                })
            );

            const profile = await getProfile('test-session-id');
            assert.strictEqual(profile.profileName, '1001');
        });
    });

    describe('getAccounts', () => {
        const mockProfile = {
            sessionId: 'test-session',
            profileId: 'test-profile',
            profileName: 'Test User',
        };

        it('should extract checking account from HomeFeedAccountsQuery', async () => {
            const mockResponse = {
                data: {
                    user: {
                        bank_account_v2: {
                            savings_account: null,
                            primary_funding_account: {
                                id: '00000000-0000-4000-8000-000000000001',
                                account_name: 'Checking',
                                display_balance: {
                                    amount: { value: '0.0' }
                                },
                                __typename: 'BankAccountV2CheckingAccount'
                            },
                            secured_credit_account: null,
                            __typename: 'BankAccountV2QueryRoot'
                        }
                    }
                }
            };

            mockFetch.mock.mockImplementationOnce(() =>
                Promise.resolve({
                    ok: true,
                    json: () => Promise.resolve(mockResponse),
                })
            );

            mockFetch.mock.mockImplementationOnce(async () => ({
                ok: true,
                json: async () => ({ data: { me: { bank_account_v2: {
                    primary_funding_account: { id: mockResponse.data.user.bank_account_v2.primary_funding_account.id, account_number: '000000001234' },
                } } } }),
            }), 1);
            const accounts = await getAccounts(mockProfile);

            assert.strictEqual(accounts.length, 1);
            assert.strictEqual(accounts[0].accountId, '00000000-0000-4000-8000-000000000001');
            assert.strictEqual(accounts[0].accountName, 'Checking');
            assert.strictEqual(accounts[0].accountMask, '1234');
            assert.strictEqual(accounts[0].accountType, 'Checking');
            assert.strictEqual(accounts[0].profile, mockProfile);

            // Verify API call
            const calls = mockFetch.mock.calls;
            assert.strictEqual(calls.length, 2);
            const requestBody = JSON.parse(calls[0].arguments[1].body);
            assert.strictEqual(requestBody.operationName, 'HomeFeedAccountsQuery');
            assert.strictEqual(requestBody.extensions.persistedQuery.sha256Hash, 'md5:ca98a6f37e5df3c609f762c922dd5edb');
            const infoBody = JSON.parse(calls[1].arguments[1].body);
            assert.equal(infoBody.operationName, 'AccountInfoQuery');
            assert.equal(infoBody.extensions.persistedQuery.sha256Hash, 'md5:e57adf8d54262ff92f7b952f3aac90b7');
            assert.ok(!JSON.stringify(accounts).includes('000000001234'));
        });

        it('rejects missing or mismatched checking details without a UUID mask fallback', async () => {
            for (const detail of [null, { id: 'another-id', account_number: '000000001234' }, { id: 'checking-id' }]) {
                mockFetch.mock.mockImplementation(async (_, options) => ({
                    ok: true,
                    json: async () => JSON.parse(options.body).operationName === 'HomeFeedAccountsQuery'
                        ? { data: { user: { bank_account_v2: { primary_funding_account: { id: 'checking-id', account_name: 'Checking' } } } } }
                        : { data: { me: { bank_account_v2: { primary_funding_account: detail } } } },
                }));
                await assert.rejects(getAccounts(mockProfile), /checking account details/);
            }
        });

        it('rejects missing or malformed checking accounts before requesting details', async () => {
            for (const primary of [
                undefined, false, 0, '', [], {},
                { account_name: 'Checking' },
                { id: null }, { id: 1234 }, { id: {} }, { id: '' }, { id: ' \t' },
            ]) {
                const callsBefore = mockFetch.mock.calls.length;
                mockFetch.mock.mockImplementation(async () => ({
                    ok: true,
                    json: async () => ({
                        data: { user: { bank_account_v2: {
                            ...(primary === undefined ? {} : { primary_funding_account: primary }),
                            savings_account: null,
                            secured_credit_account: null,
                        } } },
                    }),
                }));
                await assert.rejects(getAccounts(mockProfile), /Invalid Chime checking account data/);
                assert.equal(mockFetch.mock.calls.length, callsBefore + 1);
                assert.equal(JSON.parse(mockFetch.mock.calls.at(-1).arguments[1].body).operationName, 'HomeFeedAccountsQuery');
            }
        });

        it('uses savings account details when checking is explicitly absent', async () => {
            mockFetch.mock.mockImplementationOnce(async () => ({
                ok: true,
                json: async () => ({
                    data: { user: { bank_account_v2: {
                        primary_funding_account: null,
                        savings_account: { id: 'savings-id-456', account_name: 'Savings' },
                        secured_credit_account: { id: 'credit-id-789', account_name: 'Credit Card' },
                    } } },
                }),
            }));
            mockFetch.mock.mockImplementationOnce(async () => ({
                ok: true,
                json: async () => ({ data: { me: { bank_account_v2: {
                    savings_account: { id: 'savings-id-456', account_number: '000000005678' },
                } } } }),
            }), 1);
            assert.deepEqual(await getAccounts(mockProfile), [
                { profile: mockProfile, accountId: 'savings-id-456', accountName: 'Savings', accountMask: '5678', accountType: 'Savings' },
                { profile: mockProfile, accountId: 'credit-id-789', accountName: 'Credit Card', accountMask: '-789', accountType: 'CreditCard' },
            ]);
            assert.equal(mockFetch.mock.calls.length, 2);
            const body = JSON.parse(mockFetch.mock.calls[1].arguments[1].body);
            assert.equal(body.operationName, 'SavingsAccountInfoQuery');
            assert.deepEqual(body.variables, {});
            assert.match(body.query, /savings_account\s*\{\s*id\s+account_number\s*\}/);
            assert.equal(body.extensions, undefined);
        });

        it('should extract multiple accounts including savings and credit', async () => {
            const mockResponse = {
                data: {
                    user: {
                        bank_account_v2: {
                            primary_funding_account: {
                                id: 'checking-id-123',
                                account_name: 'Checking',
                                __typename: 'BankAccountV2CheckingAccount'
                            },
                            savings_account: {
                                id: 'savings-id-456',
                                account_name: 'Savings',
                                __typename: 'BankAccountV2SavingsAccount'
                            },
                            secured_credit_account: {
                                id: 'credit-id-789',
                                account_name: 'Credit Card',
                                __typename: 'BankAccountV2CreditAccount'
                            },
                            __typename: 'BankAccountV2QueryRoot'
                        }
                    }
                }
            };

            mockFetch.mock.mockImplementationOnce(() =>
                Promise.resolve({
                    ok: true,
                    json: () => Promise.resolve(mockResponse),
                })
            );

            mockFetch.mock.mockImplementationOnce(async () => ({
                ok: true,
                json: async () => ({ data: { me: { bank_account_v2: {
                    primary_funding_account: { id: 'checking-id-123', account_number: '000000001234' },
                } } } }),
            }), 1);
            mockFetch.mock.mockImplementationOnce(async () => ({
                ok: true,
                json: async () => ({ data: { me: { bank_account_v2: {
                    savings_account: { id: 'savings-id-456', account_number: '000000005678' },
                } } } }),
            }), 2);
            const accounts = await getAccounts(mockProfile);

            assert.strictEqual(accounts.length, 3);

            const checking = accounts.find(a => a.accountType === 'Checking');
            assert.strictEqual(checking.accountId, 'checking-id-123');
            assert.strictEqual(checking.accountName, 'Checking');

            const savings = accounts.find(a => a.accountType === 'Savings');
            assert.strictEqual(savings.accountId, 'savings-id-456');
            assert.strictEqual(savings.accountName, 'Savings');
            assert.strictEqual(savings.accountMask, '5678');

            const credit = accounts.find(a => a.accountType === 'CreditCard');
            assert.strictEqual(credit.accountId, 'credit-id-789');
            assert.strictEqual(credit.accountName, 'Credit Card');
            assert.strictEqual(credit.accountMask, '-789');
            assert.equal(checking.accountMask, '1234');
            assert.equal(mockFetch.mock.calls.length, 3);
            assert.ok(!JSON.stringify(accounts).includes('000000001234'));
            assert.ok(!JSON.stringify(accounts).includes('000000005678'));
        });

        it('rejects missing or malformed savings accounts before requesting details', async () => {
            for (const savings of [
                undefined, false, 0, '', [], {}, { account_name: 'Savings' },
                { id: null }, { id: 1234 }, { id: {} }, { id: '' }, { id: ' \t' },
            ]) {
                const before = mockFetch.mock.calls.length;
                mockFetch.mock.mockImplementation(async () => ({
                    ok: true,
                    json: async () => ({ data: { user: { bank_account_v2: {
                        primary_funding_account: null,
                        ...(savings === undefined ? {} : { savings_account: savings }),
                        secured_credit_account: null,
                    } } } }),
                }));
                await assert.rejects(getAccounts(mockProfile), /Invalid Chime savings account data/);
                assert.equal(mockFetch.mock.calls.length, before + 1);
            }
        });

        it('rejects invalid savings details without using a UUID or checking number', async () => {
            for (const details of [
                null, {}, { id: 'different-id', account_number: '000000005678' },
                { id: 'savings-id' }, { id: 'savings-id', account_number: 5678 },
                { id: 'savings-id', account_number: '' }, { id: 'savings-id', account_number: 'abc5678' },
                { id: 'savings-id', account_number: '123' },
            ]) {
                mockFetch.mock.mockImplementation(async (_, options) => ({
                    ok: true,
                    json: async () => JSON.parse(options.body).operationName === 'HomeFeedAccountsQuery'
                        ? { data: { user: { bank_account_v2: {
                            primary_funding_account: null,
                            savings_account: { id: 'savings-id', account_name: 'Savings' },
                            secured_credit_account: null,
                        } } } }
                        : { data: { me: { bank_account_v2: {
                            primary_funding_account: { id: 'savings-id', account_number: '000000001234' },
                            savings_account: details,
                        } } } },
                }));
                await assert.rejects(getAccounts(mockProfile), /Invalid or mismatched Chime savings account details/);
            }
        });

        it('should return empty array when no accounts exist', async () => {
            const mockResponse = {
                data: {
                    user: {
                        bank_account_v2: {
                            primary_funding_account: null,
                            savings_account: null,
                            secured_credit_account: null,
                            __typename: 'BankAccountV2QueryRoot'
                        }
                    }
                }
            };

            mockFetch.mock.mockImplementationOnce(() =>
                Promise.resolve({
                    ok: true,
                    json: () => Promise.resolve(mockResponse),
                })
            );

            const accounts = await getAccounts(mockProfile);
            assert.strictEqual(accounts.length, 0);
            assert.equal(mockFetch.mock.calls.length, 1);
        });
    });

    describe('getStatements', () => {
        const mockAccount = {
            profile: { sessionId: 'test', profileId: 'test', profileName: 'Test' },
            accountId: '00000000-0000-4000-8000-000000000001',
            accountName: 'Checking',
            accountMask: '1234',
            accountType: 'Checking',
        };

        it('should retrieve checking account statements', async () => {
            const mockResponse = {
                data: {
                    statements: {
                        statement_accounts: [
                            {
                                name: 'Checking',
                                account_type: 'checking',
                                statement_periods: [
                                    {
                                        display_name: 'October 2025',
                                        id: '1001_20251031',
                                        month: 10,
                                        year: 2025,
                                        __typename: 'StatementPeriod'
                                    },
                                    {
                                        display_name: 'September 2025',
                                        id: '1001_20250930',
                                        month: 9,
                                        year: 2025,
                                        __typename: 'StatementPeriod'
                                    },
                                    {
                                        display_name: 'August 2025',
                                        id: '1001_20250831',
                                        month: 8,
                                        year: 2025,
                                        __typename: 'StatementPeriod'
                                    }
                                ],
                                __typename: 'StatementAccount'
                            }
                        ],
                        __typename: 'StatementsRoot'
                    }
                }
            };

            mockFetch.mock.mockImplementationOnce(() =>
                Promise.resolve({
                    ok: true,
                    json: () => Promise.resolve(mockResponse),
                })
            );

            const statements = await getStatements(mockAccount);

            assert.strictEqual(statements.length, 3);
            assert.strictEqual(statements[0].statementId, '1001_20251031');
            assert.strictEqual(statements[0].statementDate, '2025-10-01T00:00:00.000Z');
            assert.strictEqual(statements[0].account, mockAccount);

            assert.strictEqual(statements[1].statementId, '1001_20250930');
            assert.strictEqual(statements[1].statementDate, '2025-09-01T00:00:00.000Z');

            // Verify statements are sorted by date descending (newest first)
            assert.ok(new Date(statements[0].statementDate).getTime() > new Date(statements[1].statementDate).getTime());
            assert.ok(new Date(statements[1].statementDate).getTime() > new Date(statements[2].statementDate).getTime());

            // Verify API call
            const calls = mockFetch.mock.calls;
            assert.strictEqual(calls.length, 1);
            const requestBody = JSON.parse(calls[0].arguments[1].body);
            assert.strictEqual(requestBody.operationName, 'DocumentsQuery');
            assert.deepStrictEqual(requestBody.variables.account_types, ['credit', 'checking', 'savings']);
            assert.strictEqual(requestBody.extensions.persistedQuery.sha256Hash, 'md5:a17bd74480800ce36bfbc0c4b1516bae');
        });

        it('should retrieve savings account statements', async () => {
            const savingsAccount = {
                ...mockAccount,
                accountId: 'savings-id-456',
                accountName: 'Savings',
                accountType: 'Savings',
            };

            const mockResponse = {
                data: {
                    statements: {
                        statement_accounts: [
                            {
                                name: 'Checking',
                                account_type: 'checking',
                                statement_periods: []
                            },
                            {
                                name: 'Savings',
                                account_type: 'savings',
                                statement_periods: [
                                    {
                                        display_name: 'October 2025',
                                        id: 'savings_20251031',
                                        month: 10,
                                        year: 2025
                                    }
                                ]
                            }
                        ]
                    }
                }
            };

            mockFetch.mock.mockImplementationOnce(() =>
                Promise.resolve({
                    ok: true,
                    json: () => Promise.resolve(mockResponse),
                })
            );

            const statements = await getStatements(savingsAccount);

            assert.strictEqual(statements.length, 1);
            assert.strictEqual(statements[0].statementId, 'savings_20251031');
            assert.strictEqual(statements[0].account, savingsAccount);
        });

        it('should retrieve credit account statements', async () => {
            const creditAccount = {
                ...mockAccount,
                accountId: 'credit-id-789',
                accountName: 'Credit Card',
                accountType: 'CreditCard',
            };

            const mockResponse = {
                data: {
                    statements: {
                        statement_accounts: [
                            {
                                name: 'Credit',
                                account_type: 'credit',
                                statement_periods: [
                                    {
                                        display_name: 'November 2025',
                                        id: 'credit_20251130',
                                        month: 11,
                                        year: 2025
                                    }
                                ]
                            }
                        ]
                    }
                }
            };

            mockFetch.mock.mockImplementationOnce(() =>
                Promise.resolve({
                    ok: true,
                    json: () => Promise.resolve(mockResponse),
                })
            );

            const statements = await getStatements(creditAccount);

            assert.strictEqual(statements.length, 1);
            assert.strictEqual(statements[0].statementId, 'credit_20251130');
            assert.strictEqual(statements[0].statementDate, '2025-11-01T00:00:00.000Z');
        });

        it('should return empty array when no statements exist', async () => {
            const mockResponse = {
                data: {
                    statements: {
                        statement_accounts: [
                            {
                                name: 'Checking',
                                account_type: 'checking',
                                statement_periods: []
                            }
                        ]
                    }
                }
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

        it('should reject incomplete statement periods rather than return a partial list', async () => {
            const mockResponse = {
                data: {
                    statements: {
                        statement_accounts: [
                            {
                                name: 'Checking',
                                account_type: 'checking',
                                statement_periods: [
                                    {
                                        display_name: 'October 2025',
                                        id: 'stmt-1',
                                        month: 10,
                                        year: 2025
                                    },
                                    {
                                        display_name: 'September 2025',
                                        // Missing id
                                        month: 9,
                                        year: 2025
                                    },
                                    {
                                        display_name: 'August 2025',
                                        id: 'stmt-3',
                                        // Missing month and year
                                    }
                                ]
                            }
                        ]
                    }
                }
            };

            mockFetch.mock.mockImplementationOnce(() =>
                Promise.resolve({
                    ok: true,
                    json: () => Promise.resolve(mockResponse),
                })
            );

            await assert.rejects(getStatements(mockAccount), /Invalid statement period/);
        });

        it('keeps the selected month in UTC for positive time zones', async () => {
            const previous = process.env.TZ;
            process.env.TZ = 'Asia/Shanghai';
            try {
                mockFetch.mock.mockImplementation(async () => ({
                    ok: true,
                    json: async () => ({ data: { statements: { statement_accounts: [{
                        account_type: 'checking', statement_periods: [{ id: 'synthetic-period', month: 1, year: 2000 }],
                    }] } } }),
                }));
                assert.equal((await getStatements(mockAccount))[0].statementDate, '2000-01-01T00:00:00.000Z');
            } finally {
                if (previous === undefined) delete process.env.TZ;
                else process.env.TZ = previous;
            }
        });

        it('rejects invalid month/year values without normalizing them', async () => {
            for (const [month, year] of [[13, 2000], [0, 2000], [1.5, 2000], [1, '2000']]) {
                mockFetch.mock.mockImplementation(async () => ({
                    ok: true,
                    json: async () => ({ data: { statements: { statement_accounts: [{
                        account_type: 'checking', statement_periods: [{ id: 'synthetic-period', month, year }],
                    }] } } }),
                }));
                await assert.rejects(getStatements(mockAccount), /Invalid statement period/);
            }
        });
    });

    describe('downloadStatement', () => {
        const mockAccount = {
            profile: { sessionId: 'test', profileId: 'test', profileName: 'Test' },
            accountId: '00000000-0000-4000-8000-000000000001',
            accountName: 'Checking',
            accountMask: '1234',
            accountType: 'Checking',
        };

        const mockStatement = {
            account: mockAccount,
            statementId: '1001_20251031',
            statementDate: '2025-10-01T00:00:00.000Z',
        };

        it('should download statement PDF', async () => {
            const pdfBase64 = btoa('%PDF-1.7\nsynthetic document');
            const pdfBytes = Uint8Array.from(atob(pdfBase64), c => c.charCodeAt(0));

            const mockResponse = {
                data: {
                    statements: {
                        statement_accounts: [
                            {
                                name: 'Checking',
                                monthly_pdf_statement: {
                                    encoded_pdf: pdfBase64
                                }
                            }
                        ]
                    }
                }
            };

            mockFetch.mock.mockImplementationOnce(() =>
                Promise.resolve({
                    ok: true,
                    json: () => Promise.resolve(mockResponse),
                })
            );

            const blob = await downloadStatement(mockStatement);

            assert.strictEqual(blob.type, 'application/pdf');
            assert.strictEqual(blob.size, pdfBytes.length);

            // Verify API call
            const calls = mockFetch.mock.calls;
            assert.strictEqual(calls.length, 1);
            const requestBody = JSON.parse(calls[0].arguments[1].body);
            assert.strictEqual(requestBody.operationName, 'GetMonthlyPdfStatementQuery');
            assert.deepStrictEqual(requestBody.variables, {
                account_types: ['checking'],
                month: 10,
                year: 2025
            });
            assert.strictEqual(requestBody.extensions.persistedQuery.sha256Hash, 'md5:409087bebf32f903eaab1e1498e1a724');
        });

        it('should download savings statement PDF', async () => {
            const savingsStatement = {
                account: {
                    ...mockAccount,
                    accountType: 'Savings',
                },
                statementId: 'savings_20250930',
                statementDate: '2025-09-01T00:00:00.000Z',
            };

            const pdfBase64 = 'JVBERi0xLjQK';
            const mockResponse = {
                data: {
                    statements: {
                        statement_accounts: [
                            {
                                name: 'Savings',
                                monthly_pdf_statement: {
                                    encoded_pdf: pdfBase64
                                }
                            }
                        ]
                    }
                }
            };

            mockFetch.mock.mockImplementationOnce(() =>
                Promise.resolve({
                    ok: true,
                    json: () => Promise.resolve(mockResponse),
                })
            );

            await downloadStatement(savingsStatement);

            const requestBody = JSON.parse(mockFetch.mock.calls[0].arguments[1].body);
            assert.deepStrictEqual(requestBody.variables.account_types, ['savings']);
            assert.strictEqual(requestBody.variables.month, 9);
            assert.strictEqual(requestBody.variables.year, 2025);
        });

        it('should download credit statement PDF', async () => {
            const creditStatement = {
                account: {
                    ...mockAccount,
                    accountType: 'CreditCard',
                },
                statementId: 'credit_20251130',
                statementDate: '2025-11-01T00:00:00.000Z',
            };

            const pdfBase64 = 'JVBERi0xLjQK';
            const mockResponse = {
                data: {
                    statements: {
                        statement_accounts: [
                            {
                                name: 'Credit',
                                monthly_pdf_statement: {
                                    encoded_pdf: pdfBase64
                                }
                            }
                        ]
                    }
                }
            };

            mockFetch.mock.mockImplementationOnce(() =>
                Promise.resolve({
                    ok: true,
                    json: () => Promise.resolve(mockResponse),
                })
            );

            await downloadStatement(creditStatement);

            const requestBody = JSON.parse(mockFetch.mock.calls[0].arguments[1].body);
            assert.deepStrictEqual(requestBody.variables.account_types, ['credit']);
            assert.strictEqual(requestBody.variables.month, 11);
        });

        it('should throw error when encoded PDF is not found', async () => {
            const mockResponse = {
                data: {
                    statements: {
                        statement_accounts: [
                            {
                                name: 'Checking',
                                monthly_pdf_statement: null
                            }
                        ]
                    }
                }
            };

            mockFetch.mock.mockImplementationOnce(() =>
                Promise.resolve({
                    ok: true,
                    json: () => Promise.resolve(mockResponse),
                })
            );

            await assert.rejects(
                downloadStatement(mockStatement),
                /Encoded PDF not found in response/
            );
        });

        it('should throw error when no matching account in response', async () => {
            const mockResponse = {
                data: {
                    statements: {
                        statement_accounts: []
                    }
                }
            };

            mockFetch.mock.mockImplementationOnce(() =>
                Promise.resolve({
                    ok: true,
                    json: () => Promise.resolve(mockResponse),
                })
            );

            await assert.rejects(
                downloadStatement(mockStatement),
                /Encoded PDF not found in response/
            );
        });
    });

    describe('Error Handling', () => {
        it('rejects missing operation data instead of returning empty results', async () => {
            for (const value of [null, [], {}, { data: null }, { data: {} }]) {
                mockFetch.mock.mockImplementation(async () => ({ ok: true, json: async () => value }));
                await assert.rejects(getProfile('synthetic-session'), /Invalid/);
                await assert.rejects(getAccounts({ sessionId: 'test', profileId: 'test', profileName: 'Test' }), /Invalid/);
                await assert.rejects(getStatements({ accountId: 'checking-id', accountType: 'Checking' }), /Invalid/);
            }
        });

        it('uses the UTC selected month for downloads even in negative time zones', async () => {
            const previous = process.env.TZ;
            process.env.TZ = 'America/Los_Angeles';
            try {
                mockFetch.mock.mockImplementation(async () => ({
                    ok: true,
                    json: async () => ({ data: { statements: { statement_accounts: [{
                        name: 'Checking', monthly_pdf_statement: { encoded_pdf: btoa('%PDF-1.7\nsynthetic') },
                    }] } } }),
                }));
                await downloadStatement({ account: { accountType: 'Checking' }, statementId: 'synthetic-period', statementDate: '2000-01-01T00:00:00.000Z' });
                assert.deepEqual(JSON.parse(mockFetch.mock.calls[0].arguments[1].body).variables,
                    { account_types: ['checking'], month: 1, year: 2000 });
            } finally {
                if (previous === undefined) delete process.env.TZ;
                else process.env.TZ = previous;
            }
        });

        it('rejects decoded non-PDF data and ambiguous download buckets', async () => {
            for (const accounts of [
                [{ monthly_pdf_statement: { encoded_pdf: btoa('<html>Sign in</html>') } }],
                [{ monthly_pdf_statement: { encoded_pdf: btoa('%PDF-1.7\none') } }, { monthly_pdf_statement: { encoded_pdf: btoa('%PDF-1.7\ntwo') } }],
            ]) {
                mockFetch.mock.mockImplementation(async () => ({
                    ok: true,
                    json: async () => ({ data: { statements: { statement_accounts: accounts } } }),
                }));
                await assert.rejects(downloadStatement({ account: { accountType: 'Checking' }, statementId: 'synthetic-period', statementDate: '2000-01-01T00:00:00.000Z' }),
                    /PDF|Ambiguous/);
            }
        });

        it('should throw error when GraphQL request fails', async () => {
            const mockProfile = {
                sessionId: 'test',
                profileId: 'test',
                profileName: 'Test',
            };

            mockFetch.mock.mockImplementationOnce(() =>
                Promise.resolve({
                    ok: false,
                    status: 401,
                    statusText: 'Unauthorized',
                })
            );

            await assert.rejects(
                getAccounts(mockProfile),
                /Chime GraphQL error 401 Unauthorized \(HomeFeedAccountsQuery\)/
            );
        });

        it('should throw error when GraphQL response contains errors', async () => {
            const mockProfile = {
                sessionId: 'test',
                profileId: 'test',
                profileName: 'Test',
            };

            mockFetch.mock.mockImplementationOnce(() =>
                Promise.resolve({
                    ok: true,
                    json: () => Promise.resolve({
                        errors: [
                            { message: 'Authentication required' },
                            { message: 'Invalid token' }
                        ]
                    }),
                })
            );

            await assert.rejects(
                getAccounts(mockProfile),
                /Invalid GraphQL response for HomeFeedAccountsQuery: Authentication required; Invalid token/
            );
        });

        it('should throw error when GraphQL response is invalid', async () => {
            const mockProfile = {
                sessionId: 'test',
                profileId: 'test',
                profileName: 'Test',
            };

            mockFetch.mock.mockImplementationOnce(() =>
                Promise.resolve({
                    ok: true,
                    json: () => Promise.resolve(null),
                })
            );

            await assert.rejects(
                getAccounts(mockProfile),
                /Invalid GraphQL response for HomeFeedAccountsQuery/
            );
        });

        it('should handle network errors', async () => {
            const mockProfile = {
                sessionId: 'test',
                profileId: 'test',
                profileName: 'Test',
            };

            mockFetch.mock.mockImplementationOnce(() =>
                Promise.reject(new Error('Network error'))
            );

            await assert.rejects(
                getAccounts(mockProfile),
                /Network error/
            );
        });
    });
});
