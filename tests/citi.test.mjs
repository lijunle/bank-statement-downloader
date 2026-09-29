/**
 * Unit tests for Citi bank statement API implementation
 * Tests cover credit card account functionality
 * 
 * Fixtures use synthetic values with documented response shapes.
 */

import { describe, it, beforeEach, mock } from 'node:test';
import assert from 'node:assert/strict';

// Mock global fetch
const mockFetch = mock.fn();
global.fetch = mockFetch;

// Mock document.cookie for getSessionId
global.document = {
    cookie: 'bcsid=synthetic-session; citi_authorization=test; client_id=test-uuid; isLoggedIn=true',
};

// Import the module after setting up mocks
const citiModule = await import('../bank/citi.mjs');
const { bankId, getSessionId, getProfile, getAccounts, getStatements, downloadStatement } = citiModule;

describe('Citi API', () => {
    beforeEach(() => {
        // Reset fetch mock between tests for isolation
        mockFetch.mock.resetCalls();
    });

    describe('bankId', () => {
        it('should return the correct bank identifier', () => {
            assert.strictEqual(bankId, 'citi');
        });
    });

    describe('getSessionId', () => {
        it('should extract bcsid cookie from document.cookie', () => {
            const sessionId = getSessionId();
            assert.strictEqual(sessionId, 'synthetic-session');
        });

        it('should throw error when bcsid cookie is not found', () => {
            const originalCookie = document.cookie;
            document.cookie = 'other=value';

            assert.throws(() => getSessionId(), /bcsid cookie not found/);

            document.cookie = originalCookie;
        });
    });

    describe('getProfile', () => {
        it('should extract profile information from welcomeMessage API', async () => {
            const mockResponse = {
                welcomeData: {
                    firstName: 'TEST',
                    lastLoginTime: 'Jan. 01, 2000 (12:00 AM ET)',
                    lastLoginDevice: 'from mobile device.',
                },
                displayTutorialFlag: false,
            };

            mockFetch.mock.mockImplementationOnce(() =>
                Promise.resolve({
                    ok: true,
                    json: () => Promise.resolve(mockResponse),
                })
            );

            const profile = await getProfile('synthetic-session');

            assert.deepStrictEqual(profile, {
                sessionId: 'synthetic-session',
                profileId: 'synthetic-session',
                profileName: 'TEST',
            });

            const calls = mockFetch.mock.calls;
            assert.strictEqual(calls.length, 1);
            assert.strictEqual(
                calls[0].arguments[0],
                'https://online.citi.com/gcgapi/prod/public/v1/digital/customers/globalSiteMessages/welcomeMessage'
            );
        });

        it('should handle missing firstName gracefully', async () => {
            const mockResponse = {
                welcomeData: {
                    lastLoginTime: 'Jan. 01, 2000 (12:00 AM ET)',
                    lastLoginDevice: 'from mobile device.',
                },
                displayTutorialFlag: false,
            };

            mockFetch.mock.mockImplementationOnce(() =>
                Promise.resolve({
                    ok: true,
                    json: () => Promise.resolve(mockResponse),
                })
            );

            const profile = await getProfile('test-session-id');

            assert.strictEqual(profile.profileName, 'User');
        });

        it('should throw error when API response is invalid', async () => {
            mockFetch.mock.mockImplementationOnce(() =>
                Promise.resolve({
                    ok: true,
                    json: () => Promise.resolve({}),
                })
            );

            await assert.rejects(
                async () => await getProfile('test-session-id'),
                /Invalid response format from welcome message API/
            );
        });
    });

    describe('getAccounts', () => {
        const mockProfile = {
            sessionId: 'test-session-id',
            profileId: 'test-profile-id',
            profileName: 'TEST',
        };

        it('should extract credit card accounts from eligibleAccounts API', async () => {
            const mockResponse = {
                userType: 'CARDS',
                fullName: '',
                showInvestmentLink: false,
                showInvestmentsCIFSLink: false,
                showMortgageLink: false,
                showCustomerLevelLettersFlag: false,
                eligibleAccounts: {
                    bankAccounts: [],
                    loanAccounts: [],
                    brokerageAccounts: [],
                    retirementAccounts: [],
                    cardAccounts: [
                        {
                            accountId: 'synthetic-card-id',
                            accountNickname: 'Synthetic Citi Card - 1234',
                            imageUrl: 'https://online.citi.com/cards/svc/img/svgImage/408_Moonstone_Updated.svg',
                            accountType: 'CARDS',
                            paperlessEnrollmentFlag: true,
                            paperlessEligibleFlag: true,
                            productDesc: 'Synthetic Citi Card',
                        },
                    ],
                },
                isCardsHostSystemDownFlag: false,
            };

            mockFetch.mock.mockImplementationOnce(() =>
                Promise.resolve({
                    ok: true,
                    json: () => Promise.resolve(mockResponse),
                })
            );

            const accounts = await getAccounts(mockProfile);

            assert.strictEqual(accounts.length, 1);
            assert.deepStrictEqual(accounts[0], {
                profile: mockProfile,
                accountId: 'synthetic-card-id',
                accountName: 'Synthetic Citi Card - 1234',
                accountMask: '1234',
                accountType: 'CreditCard',
            });

            const calls = mockFetch.mock.calls;
            assert.strictEqual(calls.length, 1);
            assert.strictEqual(
                calls[0].arguments[0],
                'https://online.citi.com/gcgapi/prod/public/v1/v2/digital/accounts/statementsAndLetters/eligibleAccounts/retrieve'
            );

            // Verify request body
            const requestInit = calls[0].arguments[1];
            assert.strictEqual(requestInit.method, 'POST');
            const body = JSON.parse(requestInit.body);
            assert.deepStrictEqual(body, { transactionCode: '1079_statements' });
        });

        it('should handle multiple card accounts', async () => {
            const mockResponse = {
                userType: 'CARDS',
                fullName: '',
                eligibleAccounts: {
                    bankAccounts: [],
                    loanAccounts: [],
                    brokerageAccounts: [],
                    retirementAccounts: [],
                    cardAccounts: [
                        {
                            accountId: 'card-1',
                            accountNickname: 'Citi Double Cash Card - 1234',
                            accountType: 'CARDS',
                            productDesc: 'Citi Double Cash Card',
                        },
                        {
                            accountId: 'card-2',
                            accountNickname: 'Citi Premier Card - 5678',
                            accountType: 'CARDS',
                            productDesc: 'Citi Premier Card',
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

            const accounts = await getAccounts(mockProfile);

            assert.strictEqual(accounts.length, 2);
            assert.strictEqual(accounts[0].accountMask, '1234');
            assert.strictEqual(accounts[1].accountMask, '5678');
        });

        it('should handle bank accounts', async () => {
            const mockResponse = {
                userType: 'BANKING',
                fullName: '',
                eligibleAccounts: {
                    cardAccounts: [],
                    loanAccounts: [],
                    brokerageAccounts: [],
                    retirementAccounts: [],
                    bankAccounts: [
                        {
                            accountId: 'bank-1',
                            accountNickname: 'Citi Savings Account - 9876',
                            accountType: 'BANKING',
                        },
                        {
                            accountId: 'bank-2',
                            accountNickname: 'Citi Checking Account - 5432',
                            accountType: 'BANKING',
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

            const accounts = await getAccounts(mockProfile);

            assert.strictEqual(accounts.length, 2);
            assert.strictEqual(accounts[0].accountType, 'Savings');
            assert.strictEqual(accounts[0].accountMask, '9876');
            assert.strictEqual(accounts[1].accountType, 'Checking');
            assert.strictEqual(accounts[1].accountMask, '5432');
        });

        it('should handle loan accounts', async () => {
            const mockResponse = {
                userType: 'LOANS',
                fullName: '',
                eligibleAccounts: {
                    cardAccounts: [],
                    bankAccounts: [],
                    brokerageAccounts: [],
                    retirementAccounts: [],
                    loanAccounts: [
                        {
                            accountId: 'loan-1',
                            accountNickname: 'Citi Personal Loan - 1111',
                            accountType: 'LOAN',
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

            const accounts = await getAccounts(mockProfile);

            assert.strictEqual(accounts.length, 1);
            assert.strictEqual(accounts[0].accountType, 'Loan');
            assert.strictEqual(accounts[0].accountMask, '1111');
        });

        it('should return empty array when no accounts available', async () => {
            const mockResponse = {
                userType: 'CARDS',
                fullName: '',
                eligibleAccounts: {
                    cardAccounts: [],
                    bankAccounts: [],
                    loanAccounts: [],
                    brokerageAccounts: [],
                    retirementAccounts: [],
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

        it('rejects explicit bank or card host outages instead of caching no accounts', async () => {
            for (const flag of ['bankHostSystemDownFlag', 'cardsHostSystemDownFlag', 'isCardsHostSystemDownFlag']) {
                mockFetch.mock.mockImplementation(async () => ({
                    ok: true,
                    json: async () => ({
                        [flag]: true,
                        eligibleAccounts: { bankAccounts: [], cardAccounts: [], loanAccounts: [] },
                    }),
                }));
                await assert.rejects(getAccounts(mockProfile), /temporarily unavailable/);
            }
        });

        it('rejects malformed account groups and entries instead of returning partial success', async () => {
            for (const eligibleAccounts of [
                {}, [], { cardAccounts: {} }, { cardAccounts: [null] },
                { cardAccounts: [{ accountNickname: 'Synthetic Card - 1234' }] },
                { cardAccounts: [{ accountId: 'synthetic-id', accountNickname: 'Synthetic Card' }] },
            ]) {
                mockFetch.mock.mockImplementation(async () => ({ ok: true, json: async () => ({ eligibleAccounts }) }));
                await assert.rejects(getAccounts(mockProfile), /Invalid .*account/i);
            }
        });
    });

    describe('getStatements', () => {
        const mockAccount = {
            profile: {
                sessionId: 'test-session-id',
                profileId: 'test-profile-id',
                profileName: 'TEST',
            },
            accountId: 'synthetic-card-id',
            accountName: 'Synthetic Citi Card - 1234',
            accountMask: '1234',
            accountType: 'CreditCard',
        };

        it('should extract and parse statements from accountsAndStatements API', async () => {
            const mockResponse = {
                statementsByYear: [
                    {
                        displayYearTitle: '2025',
                        annualAccountSummaryEligibleFlag: true,
                        statementsByMonth: [
                            {
                                displayDate: 'July 17',
                                statementDate: '07/17/2025',
                            },
                            {
                                displayDate: 'June 18',
                                statementDate: '06/18/2025',
                            },
                        ],
                    },
                    {
                        displayYearTitle: '2024',
                        annualAccountSummaryEligibleFlag: false,
                        statementsByMonth: [
                            {
                                displayDate: 'December 18',
                                statementDate: '12/18/2024',
                            },
                        ],
                    },
                ],
                accountOpenDate: '01/03/2022',
                archivedStatementsEligibleFlag: true,
                estatementEnrollmentFlag: true,
            };

            mockFetch.mock.mockImplementationOnce(() =>
                Promise.resolve({
                    ok: true,
                    json: () => Promise.resolve(mockResponse),
                })
            );

            const statements = await getStatements(mockAccount);

            assert.strictEqual(statements.length, 3);

            // Verify statements are sorted by date (newest first)
            assert.strictEqual(statements[0].statementId, '07/17/2025');
            assert.strictEqual(statements[1].statementId, '06/18/2025');
            assert.strictEqual(statements[2].statementId, '12/18/2024');

            // Verify date parsing - now returns ISO string
            assert.strictEqual(typeof statements[0].statementDate, 'string');
            assert.strictEqual(statements[0].statementDate, '2025-07-17T00:00:00.000Z');

            // Verify account reference
            assert.strictEqual(statements[0].account, mockAccount);

            const calls = mockFetch.mock.calls;
            assert.strictEqual(calls.length, 1);
            assert.strictEqual(
                calls[0].arguments[0],
                'https://online.citi.com/gcgapi/prod/public/v1/v2/digital/card/accounts/statements/accountsAndStatements/retrieve'
            );

            // Verify request body
            const requestInit = calls[0].arguments[1];
            assert.strictEqual(requestInit.method, 'POST');
            const body = JSON.parse(requestInit.body);
            assert.deepStrictEqual(body, { accountId: mockAccount.accountId });
        });

        it('should handle empty statements list', async () => {
            const mockResponse = {
                statementsByYear: [],
                accountOpenDate: '01/03/2022',
                archivedStatementsEligibleFlag: true,
                estatementEnrollmentFlag: true,
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

        it('should handle years with no months', async () => {
            const mockResponse = {
                statementsByYear: [
                    {
                        displayYearTitle: '2025',
                        annualAccountSummaryEligibleFlag: true,
                        statementsByMonth: [],
                    },
                ],
                accountOpenDate: '01/03/2022',
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

        it('preserves the statement calendar date in positive time zones', async () => {
            const previous = process.env.TZ;
            process.env.TZ = 'Asia/Shanghai';
            try {
                mockFetch.mock.mockImplementation(async () => ({
                    ok: true,
                    json: async () => ({ statementsByYear: [{ statementsByMonth: [{ statementDate: '03/31/2000' }] }] }),
                }));
                assert.equal((await getStatements(mockAccount))[0].statementDate, '2000-03-31T00:00:00.000Z');
            } finally {
                if (previous === undefined) delete process.env.TZ;
                else process.env.TZ = previous;
            }
        });

        it('rejects impossible and malformed date values instead of normalizing them', async () => {
            for (const statementDate of ['02/30/2000', '02/29/2001', '13/01/2000', '03/31/2000extra', '', null, 20000331]) {
                mockFetch.mock.mockImplementation(async () => ({
                    ok: true,
                    json: async () => ({ statementsByYear: [{ statementsByMonth: [{ statementDate }] }] }),
                }));
                await assert.rejects(getStatements(mockAccount), /Invalid statement date/);
            }
        });

        it('rejects malformed year groups or statement rows instead of skipping them', async () => {
            for (const statementsByYear of [
                {}, [null], [{}], [{ statementsByMonth: null }],
                [{ statementsByMonth: [{ statementDate: '03/31/2000' }, {}] }],
            ]) {
                mockFetch.mock.mockImplementation(async () => ({ ok: true, json: async () => ({ statementsByYear }) }));
                await assert.rejects(getStatements(mockAccount), /Invalid .*statement/i);
            }
        });
    });

    describe('downloadStatement', () => {
        const mockStatement = {
            account: {
                profile: {
                    sessionId: 'test-session-id',
                    profileId: 'test-profile-id',
                    profileName: 'TEST',
                },
                accountId: 'synthetic-card-id',
                accountName: 'Synthetic Citi Card - 1234',
                accountMask: '1234',
                accountType: 'CreditCard',
            },
            statementId: '07/17/2025',
            statementDate: '2025-07-17T00:00:00.000Z',
        };

        it('should download statement PDF', async () => {
            const mockBlob = new Blob(['%PDF-1.7\nsynthetic document'], { type: 'application/pdf' });

            mockFetch.mock.mockImplementationOnce(() =>
                Promise.resolve({
                    ok: true,
                    blob: () => Promise.resolve(mockBlob),
                })
            );

            const blob = await downloadStatement(mockStatement);

            assert.ok(blob instanceof Blob);
            assert.strictEqual(blob.type, 'application/pdf');
            assert.strictEqual(blob.size, mockBlob.size);

            const calls = mockFetch.mock.calls;
            assert.strictEqual(calls.length, 1);
            assert.strictEqual(
                calls[0].arguments[0],
                'https://online.citi.com/gcgapi/prod/public/v1/v2/digital/card/accounts/statements/recent/retrieve'
            );

            // Verify request body
            const requestInit = calls[0].arguments[1];
            assert.strictEqual(requestInit.method, 'POST');
            const body = JSON.parse(requestInit.body);
            assert.deepStrictEqual(body, {
                accountId: mockStatement.account.accountId,
                statementDate: '07/17/2025',
                requestType: 'RECENT STATEMENTS',
            });
        });

        it('should throw error when PDF is empty', async () => {
            const mockBlob = new Blob([], { type: 'application/pdf' });

            mockFetch.mock.mockImplementationOnce(() =>
                Promise.resolve({
                    ok: true,
                    blob: () => Promise.resolve(mockBlob),
                })
            );

            await assert.rejects(
                async () => await downloadStatement(mockStatement),
                /Downloaded PDF is empty/
            );
        });

        it('should throw error when content type is not PDF', async () => {
            const mockData = new Uint8Array([0x48, 0x54, 0x4d, 0x4c]); // HTML
            const mockBlob = new Blob([mockData], { type: 'text/html' });

            mockFetch.mock.mockImplementationOnce(() =>
                Promise.resolve({
                    ok: true,
                    blob: () => Promise.resolve(mockBlob),
                })
            );

            await assert.rejects(
                async () => await downloadStatement(mockStatement),
                /Unexpected content type: text\/html\. Expected PDF/
            );
        });

        it('rejects non-PDF bytes and lookalike PDF MIME types', async () => {
            for (const blob of [
                new Blob(['{"error":"expired"}'], { type: 'application/pdf' }),
                new Blob(['%PDF-1.7\nsynthetic'], { type: 'application/not-pdf' }),
            ]) {
                mockFetch.mock.mockImplementation(async () => ({ ok: true, blob: async () => blob }));
                await assert.rejects(downloadStatement(mockStatement), /PDF/);
            }
        });

        it('rejects an invalid selected date before issuing a download request', async () => {
            await assert.rejects(downloadStatement({ ...mockStatement, statementId: '02/30/2000' }), /Invalid statement date/);
            assert.equal(mockFetch.mock.calls.length, 0);
        });

        it('should handle API errors gracefully', async () => {
            mockFetch.mock.mockImplementationOnce(() =>
                Promise.resolve({
                    ok: false,
                    status: 404,
                    statusText: 'Not Found',
                })
            );

            await assert.rejects(
                async () => await downloadStatement(mockStatement),
                /Citi API request failed: 404 Not Found/
            );
        });
    });

    describe('Error Handling', () => {
        it('should handle network errors', async () => {
            mockFetch.mock.mockImplementationOnce(() =>
                Promise.reject(new Error('Network error'))
            );

            await assert.rejects(
                async () => await getProfile('test-session-id'),
                /Network error/
            );
        });

        it('should handle invalid JSON responses', async () => {
            mockFetch.mock.mockImplementationOnce(() =>
                Promise.resolve({
                    ok: true,
                    json: () => Promise.reject(new Error('Invalid JSON')),
                })
            );

            await assert.rejects(
                async () => await getProfile('test-session-id'),
                /Invalid JSON/
            );
        });

        it('should handle HTTP error responses', async () => {
            mockFetch.mock.mockImplementationOnce(() =>
                Promise.resolve({
                    ok: false,
                    status: 401,
                    statusText: 'Unauthorized',
                })
            );

            await assert.rejects(
                async () => await getProfile('test-session-id'),
                /Citi API request failed: 401 Unauthorized/
            );
        });
    });
});
