/**
 * Unit tests for Tangerine Bank statement API implementation
 * Tests cover checking, savings, credit card, line of credit, and mortgage account functionality
 * 
 * Note: All mock data is based on actual content from analyze/tangerine_1763673817887.har
 * to ensure tests match real API responses.
 */

import { describe, it, beforeEach, mock } from 'node:test';
import assert from 'node:assert/strict';

// Mock global fetch
const mockFetch = mock.fn();
global.fetch = mockFetch;

// Mock document.cookie for getSessionId
global.document = {
    cookie: 'CTOK=P|81919892T2; rxVisitor=123; other=value',
};

// Import the module after setting up mocks
const tangerineModule = await import('../bank/tangerine.mjs');
const { bankId, getSessionId, getProfile, getAccounts, getStatements, downloadStatement } = tangerineModule;

describe('Tangerine Bank API', () => {
    beforeEach(() => {
        // Reset fetch mock between tests for isolation
        mockFetch.mock.resetCalls();
    });

    describe('bankId', () => {
        it('should return the correct bank identifier', () => {
            assert.strictEqual(bankId, 'tangerine');
        });
    });

    describe('getSessionId', () => {
        it('should extract CTOK cookie from document.cookie', () => {
            const sessionId = getSessionId();
            assert.strictEqual(sessionId, 'P|81919892T2');
        });

        it('should throw error when CTOK cookie is not found', () => {
            // Override document.cookie for this test
            Object.defineProperty(document, 'cookie', {
                value: 'other=value; rxVisitor=123',
                writable: true,
                configurable: true,
            });

            assert.throws(() => getSessionId(), /No session identifier found/);

            // Restore original cookie
            Object.defineProperty(document, 'cookie', {
                value: 'CTOK=P|81919892T2; rxVisitor=123; other=value',
                writable: true,
                configurable: true,
            });
        });
    });

    describe('getProfile', () => {
        it('should retrieve user profile information', async () => {
            const mockResponse = {
                response_status: {
                    status_code: 'SUCCESS',
                },
                customer: {
                    first_name: 'JOHN',
                    last_name: 'DOE',
                    title: 'Mr',
                    email: 'john.doe@example.com',
                    client_number: '94413718',
                    sin: '***-***-098',
                    date_of_birth: '1990-01-01',
                    client_since_date: '2023-07-20',
                    orange_key: '81919892T2',
                    last_login: 'November 12, 2025 at 5:37 PM ET',
                    langauge: 'ENGLISH',
                    phone_list: [
                        {
                            sequence_number: 35622894,
                            number: '536-609-4312',
                            type: 'CELL',
                            last_updated_date: 1798171911111,
                        },
                    ],
                    address_list: [
                        {
                            country: 'CA',
                            province: 'ON',
                            address_type: 'HOME',
                            city: 'Toronto',
                            address_line1: '123 Main St',
                            postal_code: 'M5H 2N2',
                        },
                    ],
                    servicing_systems: ['CHEQUING', 'SAVINGS'],
                    employment_status: 'EMPLOYED',
                    employer: {
                        company_name: 'Tech Industries',
                    },
                    occupation: {
                        industry_code: 'ABIFA',
                        occupation_code: 'INVAN',
                    },
                    interest_paid_lifetime: 5359.68,
                    fees_saved: 447.77,
                    monthly_fee: 15.4,
                },
            };

            mockFetch.mock.mockImplementationOnce(() =>
                Promise.resolve({
                    ok: true,
                    json: async () => mockResponse,
                })
            );

            const profile = await getProfile('P|81919892T2');

            assert.strictEqual(profile.sessionId, 'P|81919892T2');
            assert.strictEqual(profile.profileId, '94413718');
            assert.strictEqual(profile.profileName, 'Mr JOHN DOE');

            const calls = mockFetch.mock.calls;
            assert.strictEqual(calls.length, 1);
            assert.strictEqual(calls[0].arguments[0], 'https://secure.tangerine.ca/web/rest/v1/customers/my?include-servicing-systems=true');
            assert.strictEqual(calls[0].arguments[1].credentials, 'include');
            assert.strictEqual(calls[0].arguments[1].headers['accept'], 'application/json, text/plain, */*');
            assert.strictEqual(calls[0].arguments[1].headers['x-web-flavour'], 'fbe');
        });

        it('should handle profile without title', async () => {
            const mockResponse = {
                response_status: { status_code: 'SUCCESS' },
                customer: {
                    first_name: 'JOHN',
                    last_name: 'DOE',
                    client_number: '12345678',
                },
            };
            mockFetch.mock.mockImplementationOnce(() => Promise.resolve({ ok: true, json: async () => (mockResponse) }));

            const profile = await getProfile('P|TEST123');
            assert.strictEqual(profile.profileName, 'JOHN DOE');
        });

        it('should throw error when profile response is invalid', async () => {
            mockFetch.mock.mockImplementationOnce(() =>
                Promise.resolve({
                    ok: true,
                    json: async () => ({}),
                })
            );

            await assert.rejects(
                () => getProfile('P|TEST123'),
                /Invalid response format from customer profile API/
            );
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
                () => getProfile('P|TEST123'),
                /Tangerine API request failed: 401 Unauthorized/
            );
        });
    });

    describe('getAccounts', () => {
        const mockProfile = {
            sessionId: 'P|TEST123',
            profileId: '94413718',
            profileName: 'Test User',
        };

        it('should retrieve all accounts with correct type mapping', async () => {
            const mockResponse = {
                response_status: {
                    status_code: 'SUCCESS',
                },
                restrictions: [],
                accounts: [
                    {
                        number: '42434445464748495041424344454647ec3ed5212eb03c795g2bcf46d25dd4e1',
                        account_balance: 1234.56,
                        currency_type: 'CAD',
                        nickname: '',
                        description: 'Tangerine Chequing Account',
                        goal_account: false,
                        display_name: '5129315461',
                        type: 'CHEQUING',
                        product_code: '4000',
                    },
                    {
                        number: '4243444546474849504142434445464798e287b4b55d6bce90dfb545cfg2e8f3',
                        account_balance: 5678.90,
                        currency_type: 'CAD',
                        nickname: '',
                        description: 'Tangerine Savings Account',
                        goal_account: false,
                        display_name: '4151189461',
                        type: 'SAVINGS',
                        product_code: '3000',
                    },
                    {
                        number: '42434445464748495041424344454647bbccddee2345678901bcdefg23456789',
                        account_balance: 2500.00,
                        currency_type: 'CAD',
                        nickname: 'My TFSA',
                        description: 'Tangerine TFSA Savings',
                        goal_account: false,
                        display_name: '4161189461',
                        type: 'TFSA_SAVINGS',
                        product_code: '3200',
                    },
                    {
                        number: '42434445464748495041424344454647ddeeff223344556677889900bbccddee',
                        account_balance: -1500.00,
                        currency_type: 'CAD',
                        nickname: '',
                        description: 'Tangerine Money-Back Credit Card',
                        goal_account: false,
                        display_name: '6511234567',
                        type: 'CREDIT_CARD',
                        product_code: '5400',
                    },
                    {
                        number: '42434445464748495041424344454647ffgg11223344556677889900bbccddee',
                        account_balance: 10000.00,
                        currency_type: 'CAD',
                        nickname: '',
                        description: 'Tangerine Line of Credit',
                        goal_account: false,
                        display_name: '7211098765',
                        type: 'LINE_OF_CREDIT',
                        product_code: '6100',
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

            assert.strictEqual(accounts.length, 5);

            // Checking account
            assert.strictEqual(accounts[0].accountId, '42434445464748495041424344454647ec3ed5212eb03c795g2bcf46d25dd4e1');
            assert.strictEqual(accounts[0].accountName, 'Tangerine Chequing Account');
            assert.strictEqual(accounts[0].accountMask, '5461');
            assert.strictEqual(accounts[0].accountType, 'Checking');
            assert.strictEqual(accounts[0].profile, mockProfile);

            // Savings account
            assert.strictEqual(accounts[1].accountType, 'Savings');
            assert.strictEqual(accounts[1].accountMask, '9461');

            // TFSA Savings account
            assert.strictEqual(accounts[2].accountType, 'Savings');
            assert.strictEqual(accounts[2].accountName, 'Tangerine TFSA Savings');

            // Credit Card
            assert.strictEqual(accounts[3].accountType, 'CreditCard');
            assert.strictEqual(accounts[3].accountMask, '4567');

            // Line of Credit
            assert.strictEqual(accounts[4].accountType, 'Loan');
            assert.strictEqual(accounts[4].accountMask, '8765');

            const calls = mockFetch.mock.calls;
            assert.strictEqual(calls.length, 1);
            assert.strictEqual(calls[0].arguments[0], 'https://secure.tangerine.ca/web/rest/pfm/v1/accounts');
        });

        it('should handle RSP_SAVINGS as Savings type', async () => {
            const mockResponse = {
                response_status: { status_code: 'SUCCESS' },
                restrictions: [],
                accounts: [
                    {
                        number: 'test123',
                        display_name: '3100123456',
                        description: 'RSP Savings',
                        type: 'RSP_SAVINGS',
                        product_code: '3100',
                    },
                ],
            };
            mockFetch.mock.mockImplementationOnce(() => Promise.resolve({ ok: true, json: async () => (mockResponse) }));

            const accounts = await getAccounts(mockProfile);
            assert.strictEqual(accounts[0].accountType, 'Savings');
        });

        it('should handle MORTGAGE as Loan type', async () => {
            const mockResponse = {
                response_status: { status_code: 'SUCCESS' },
                restrictions: [],
                accounts: [
                    {
                        number: 'test456',
                        display_name: '7200987654',
                        description: 'Tangerine Mortgage',
                        type: 'MORTGAGE',
                        product_code: '7200',
                    },
                ],
            };
            mockFetch.mock.mockImplementationOnce(() => Promise.resolve({ ok: true, json: async () => (mockResponse) }));

            const accounts = await getAccounts(mockProfile);
            assert.strictEqual(accounts[0].accountType, 'Loan');
        });

        it('should handle GIC as Savings type', async () => {
            const mockResponse = {
                response_status: { status_code: 'SUCCESS' },
                restrictions: [],
                accounts: [
                    {
                        number: 'test789',
                        display_name: '3300555555',
                        description: 'Tangerine GIC',
                        type: 'GIC',
                        product_code: '3300',
                    },
                ],
            };
            mockFetch.mock.mockImplementationOnce(() => Promise.resolve({ ok: true, json: async () => (mockResponse) }));

            const accounts = await getAccounts(mockProfile);
            assert.strictEqual(accounts[0].accountType, 'Savings');
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
                /Invalid response format from accounts API/
            );
        });
    });

    describe('getStatements', () => {
        const mockProfile = {
            sessionId: 'P|TEST123',
            profileId: '94413718',
            profileName: 'Test User',
        };

        const mockCheckingAccount = {
            profile: mockProfile,
            accountId: 'chequing123',
            accountName: 'Tangerine Chequing Account',
            accountMask: '4350',
            accountType: 'Checking',
        };

        const mockSavingsAccount = {
            profile: mockProfile,
            accountId: 'savings456',
            accountName: 'Tangerine Savings Account',
            accountMask: '8350',
            accountType: 'Savings',
        };

        const mockCreditCardAccount = {
            profile: mockProfile,
            accountId: 'creditcard789',
            accountName: 'Tangerine Credit Card',
            accountMask: '3456',
            accountType: 'CreditCard',
        };

        it('should retrieve statements for checking account', async () => {
            // First call - get available months
            const mockMonthsResponse = {
                response_status: { status_code: 'SUCCESS' },
                months: [
                    { month: '2025-10', description: 'October 2025' },
                    { month: '2025-09', description: 'September 2025' },
                    { month: '2025-08', description: 'August 2025' },
                ],
                statements: [
                    {
                        end_date: '2025-10-31',
                        description: 'Mr JOHN DOE - Oct 2025',
                        statement_id: 'PENzNDEzNzE4LTc4NjIwLVVPSC0yMw',
                        statement_type: 'CHQ',
                        statement_filename: 'Tangerine-Chequing_Oct25.pdf',
                    },
                ],
            };

            // Subsequent calls - get statements for each month
            const mockOctoberResponse = {
                response_status: { status_code: 'SUCCESS' },
                statements: [
                    {
                        end_date: '2025-10-31',
                        description: 'Mr JOHN DOE - Oct 2025',
                        statement_id: 'PENzNDEzNzE4LTc4NjIwLVVPSC0yMw',
                        statement_type: 'CHQ',
                        statement_filename: 'Tangerine-Chequing_Oct25.pdf',
                    },
                    {
                        end_date: '2025-10-31',
                        description: 'Mr JOHN DOE - Oct 2025',
                        statement_id: 'PENzNDEzNzE4LTc4NjIwLVVPSC0yMg',
                        statement_type: 'BSTMT',
                        statement_filename: 'Tangerine-eStatement_Oct25.pdf',
                    },
                ],
            };

            const mockSeptemberResponse = {
                response_status: { status_code: 'SUCCESS' },
                statements: [
                    {
                        end_date: '2025-09-30',
                        description: 'Mr JOHN DOE - Sep 2025',
                        statement_id: 'PENzNDEzNzE4LTc4NjIwLVVPSC0yMQ',
                        statement_type: 'CHQ',
                        statement_filename: 'Tangerine-Chequing_Sep25.pdf',
                    },
                ],
            };

            const mockAugustResponse = {
                response_status: { status_code: 'SUCCESS' },
                statements: [
                    {
                        end_date: '2025-08-31',
                        description: 'Mr JOHN DOE - Aug 2025',
                        statement_id: 'PENzNDEzNzE4LTc4NjIwLVVPSC0yMA',
                        statement_type: 'CHQ',
                        statement_filename: 'Tangerine-Chequing_Aug25.pdf',
                    },
                ],
            };

            const responses = [
                { ok: true, json: async () => mockMonthsResponse },
                { ok: true, json: async () => mockOctoberResponse },
                { ok: true, json: async () => mockSeptemberResponse },
                { ok: true, json: async () => mockAugustResponse },
            ];
            mockFetch.mock.mockImplementation(() => Promise.resolve(responses.shift()));

            const statements = await getStatements(mockCheckingAccount);

            // Should only include CHQ statements (3 total)
            assert.strictEqual(statements.length, 3);
            assert.strictEqual(statements[0].statementId, 'PENzNDEzNzE4LTc4NjIwLVVPSC0yMw');
            assert.strictEqual(statements[0].statementDate, '2025-10-31');
            assert.strictEqual(statements[1].statementId, 'PENzNDEzNzE4LTc4NjIwLVVPSC0yMQ');
            assert.strictEqual(statements[1].statementDate, '2025-09-30');
            assert.strictEqual(statements[2].statementId, 'PENzNDEzNzE4LTc4NjIwLVVPSC0yMA');
            assert.strictEqual(statements[2].statementDate, '2025-08-31');

            // Verify all statements belong to the correct account
            statements.forEach(stmt => {
                assert.strictEqual(stmt.account, mockCheckingAccount);
            });

            // Verify API calls
            const calls = mockFetch.mock.calls;
            assert.strictEqual(calls.length, 4); // 1 initial + 3 month requests
            assert.ok(calls[0].arguments[0].includes('/web/rest/v1/customers/my/documents/statements'));
            assert.ok(calls[1].arguments[0].includes('start-month=2025-10&end-month=2025-10'));
            assert.ok(calls[2].arguments[0].includes('start-month=2025-09&end-month=2025-09'));
            assert.ok(calls[3].arguments[0].includes('start-month=2025-08&end-month=2025-08'));
        });

        it('should retrieve statements for savings account', async () => {
            const mockMonthsResponse = {
                response_status: { status_code: 'SUCCESS' },
                months: [{ month: '2025-10', description: 'October 2025' }],
                statements: [],
            };

            const mockOctoberResponse = {
                response_status: { status_code: 'SUCCESS' },
                statements: [
                    {
                        end_date: '2025-10-31',
                        description: 'Mr JOHN DOE - Oct 2025',
                        statement_id: 'PENzNDEzNzE4LTc4NjIwLVVPSC0yMg',
                        statement_type: 'BSTMT',
                        statement_filename: 'Tangerine-eStatement_Oct25.pdf',
                    },
                    {
                        end_date: '2025-10-31',
                        description: 'Mr JOHN DOE - Oct 2025',
                        statement_id: 'PENzNDEzNzE4LTc4NjIwLVVPSC0yMw',
                        statement_type: 'CHQ',
                        statement_filename: 'Tangerine-Chequing_Oct25.pdf',
                    },
                ],
            };

            const responses = [
                { ok: true, json: async () => mockMonthsResponse },
                { ok: true, json: async () => mockOctoberResponse },
            ];
            mockFetch.mock.mockImplementation(() => Promise.resolve(responses.shift()));

            const statements = await getStatements(mockSavingsAccount);

            // Should only include BSTMT statements
            assert.strictEqual(statements.length, 1);
            assert.strictEqual(statements[0].statementId, 'PENzNDEzNzE4LTc4NjIwLVVPSC0yMg');
            assert.strictEqual(statements[0].account, mockSavingsAccount);
        });

        it('should retrieve statements for credit card account', async () => {
            const mockMonthsResponse = {
                response_status: { status_code: 'SUCCESS' },
                months: [{ month: '2025-10', description: 'October 2025' }],
                statements: [],
            };

            const mockOctoberResponse = {
                response_status: { status_code: 'SUCCESS' },
                statements: [
                    {
                        end_date: '2025-10-31',
                        description: 'Mr JOHN DOE - Oct 2025',
                        statement_id: 'PENzNDEzNzE4LTc4NjIwLVVPSC0yNA',
                        statement_type: 'VISA',
                        statement_filename: 'Tangerine-CreditCard_Oct25.pdf',
                    },
                    {
                        end_date: '2025-10-31',
                        description: 'Mr JOHN DOE - Oct 2025',
                        statement_id: 'PENzNDEzNzE4LTc4NjIwLVVPSC0yMg',
                        statement_type: 'BSTMT',
                        statement_filename: 'Tangerine-eStatement_Oct25.pdf',
                    },
                ],
            };

            const responses = [
                { ok: true, json: async () => mockMonthsResponse },
                { ok: true, json: async () => mockOctoberResponse },
            ];
            mockFetch.mock.mockImplementation(() => Promise.resolve(responses.shift()));

            const statements = await getStatements(mockCreditCardAccount);

            // Should only include VISA statements
            assert.strictEqual(statements.length, 1);
            assert.strictEqual(statements[0].statementId, 'PENzNDEzNzE4LTc4NjIwLVVPSC0yNA');
            assert.strictEqual(statements[0].account, mockCreditCardAccount);
        });

        it('should handle loan accounts (LOC and MTG)', async () => {
            const mockLoanAccount = {
                profile: mockProfile,
                accountId: 'loan123',
                accountName: 'Tangerine Line of Credit',
                accountMask: '7654',
                accountType: 'Loan',
            };

            const mockMonthsResponse = {
                response_status: { status_code: 'SUCCESS' },
                months: [{ month: '2025-10', description: 'October 2025' }],
                statements: [],
            };

            const mockOctoberResponse = {
                response_status: { status_code: 'SUCCESS' },
                statements: [
                    {
                        end_date: '2025-10-31',
                        description: 'Mr JOHN DOE - Oct 2025',
                        statement_id: 'PENzNDEzNzE4LTc4NjIwLVVPSC0yNQ',
                        statement_type: 'LOC',
                        statement_filename: 'Tangerine-LOC_Oct25.pdf',
                    },
                    {
                        end_date: '2025-10-31',
                        description: 'Mr JOHN DOE - Oct 2025',
                        statement_id: 'PENzNDEzNzE4LTc4NjIwLVVPSC0yNg',
                        statement_type: 'MTG',
                        statement_filename: 'Tangerine-Mortgage_Oct25.pdf',
                    },
                ],
            };

            const responses = [
                { ok: true, json: async () => mockMonthsResponse },
                { ok: true, json: async () => mockOctoberResponse },
            ];
            mockFetch.mock.mockImplementation(() => Promise.resolve(responses.shift()));

            const statements = await getStatements(mockLoanAccount);

            // Should include both LOC and MTG statements
            assert.strictEqual(statements.length, 2);
            assert.ok(statements.some(s => s.statementId === 'PENzNDEzNzE4LTc4NjIwLVVPSC0yNQ'));
            assert.ok(statements.some(s => s.statementId === 'PENzNDEzNzE4LTc4NjIwLVVPSC0yNg'));
        });

        it('should limit to 12 months of history', async () => {
            const mockMonthsResponse = {
                response_status: { status_code: 'SUCCESS' },
                months: Array.from({ length: 29 }, (_, i) => ({
                    month: `2025-${String(10 - i).padStart(2, '0')}`,
                    description: `Month ${i}`,
                })),
                statements: [],
            };

            // Initial call to get months list + Mock 12 month responses
            const responses = [
                { ok: true, json: async () => mockMonthsResponse },
                ...Array.from({ length: 12 }, () => ({
                    ok: true,
                    json: async () => ({ response_status: { status_code: 'SUCCESS' }, statements: [] }),
                })),
            ];
            mockFetch.mock.mockImplementation(() => Promise.resolve(responses.shift()));

            await getStatements(mockCheckingAccount);

            // Should only make 13 API calls (1 initial + 12 month requests)
            const calls = mockFetch.mock.calls;
            assert.strictEqual(calls.length, 13);
        });

        it('should sort statements by date descending', async () => {
            const mockMonthsResponse = {
                response_status: { status_code: 'SUCCESS' },
                months: [
                    { month: '2025-10', description: 'October 2025' },
                    { month: '2025-09', description: 'September 2025' },
                ],
                statements: [],
            };

            const mockOctoberResponse = {
                response_status: { status_code: 'SUCCESS' },
                statements: [
                    {
                        end_date: '2025-10-31',
                        statement_id: 'OCT',
                        statement_type: 'CHQ',
                    },
                ],
            };

            const mockSeptemberResponse = {
                response_status: { status_code: 'SUCCESS' },
                statements: [
                    {
                        end_date: '2025-09-30',
                        statement_id: 'SEP',
                        statement_type: 'CHQ',
                    },
                ],
            };

            const responses = [
                { ok: true, json: async () => mockMonthsResponse },
                { ok: true, json: async () => mockOctoberResponse },
                { ok: true, json: async () => mockSeptemberResponse },
            ];
            mockFetch.mock.mockImplementation(() => Promise.resolve(responses.shift()));

            const statements = await getStatements(mockCheckingAccount);

            assert.strictEqual(statements[0].statementDate, '2025-10-31');
            assert.strictEqual(statements[1].statementDate, '2025-09-30');
        });

        it('should continue fetching other months if one month fails', async () => {
            const mockMonthsResponse = {
                response_status: { status_code: 'SUCCESS' },
                months: [
                    { month: '2025-10', description: 'October 2025' },
                    { month: '2025-09', description: 'September 2025' },
                ],
                statements: [],
            };

            const mockOctoberResponse = {
                response_status: { status_code: 'SUCCESS' },
                statements: [
                    {
                        end_date: '2025-10-31',
                        statement_id: 'OCT',
                        statement_type: 'CHQ',
                    },
                ],
            };

            const responses = [
                { ok: true, json: async () => mockMonthsResponse },
                { ok: false, status: 500, statusText: 'Internal Server Error' },
                { ok: true, json: async () => mockOctoberResponse },
            ];
            mockFetch.mock.mockImplementation(() => Promise.resolve(responses.shift()));

            const statements = await getStatements(mockCheckingAccount);

            // Should still get October statement even though September failed
            assert.strictEqual(statements.length, 1);
            assert.strictEqual(statements[0].statementId, 'OCT');
        });

        it('should throw error when initial response is invalid', async () => {
            mockFetch.mock.mockImplementationOnce(() =>
                Promise.resolve({
                    ok: true,
                    json: async () => ({}),
                })
            );

            await assert.rejects(
                () => getStatements(mockCheckingAccount),
                /Invalid response format from statements API/
            );
        });
    });

    describe('downloadStatement', () => {
        const mockProfile = {
            sessionId: 'P|TEST123',
            profileId: '94413718',
            profileName: 'Test User',
        };

        const mockAccount = {
            profile: mockProfile,
            accountId: 'chequing123',
            accountName: 'Tangerine Chequing Account',
            accountMask: '4350',
            accountType: 'Checking',
        };

        const mockStatement = {
            account: mockAccount,
            statementId: 'PENzNDEzNzE4LTc4NjIwLVVPSC0yMw',
            statementDate: '2025-10-31',
        };

        it('should download statement PDF successfully', async () => {
            const mockListResponse = {
                response_status: { status_code: 'SUCCESS' },
                statements: [
                    {
                        end_date: '2025-10-31',
                        description: 'Mr JOHN DOE - Oct 2025',
                        statement_id: 'PENzNDEzNzE4LTc4NjIwLVVPSC0yMw',
                        statement_type: 'CHQ',
                        statement_filename: 'Tangerine-Chequing_Oct25.pdf',
                    },
                ],
            };

            const mockPdfBlob = new Blob(['PDF content'], { type: 'application/pdf' });

            const responses = [
                { ok: true, json: async () => mockListResponse },
                { ok: true, blob: async () => mockPdfBlob },
            ];
            mockFetch.mock.mockImplementation(() => Promise.resolve(responses.shift()));

            const blob = await downloadStatement(mockStatement);

            assert.strictEqual(blob.type, 'application/pdf');

            const calls = mockFetch.mock.calls;
            assert.strictEqual(calls.length, 2);

            // First call - get statement details
            assert.ok(calls[0].arguments[0].includes('/web/rest/v1/customers/my/documents/statements'));
            assert.ok(calls[0].arguments[0].includes('start-month=2025-10&end-month=2025-10'));

            // Second call - download PDF
            assert.ok(calls[1].arguments[0].includes('/web/docs/rest/v1/customers/my/documents/statements/PENzNDEzNzE4LTc4NjIwLVVPSC0yMw'));
            assert.ok(calls[1].arguments[0].includes('statement-type=CHQ'));
            assert.ok(calls[1].arguments[0].includes('file-name=Tangerine-Chequing_Oct25.pdf'));
            assert.ok(calls[1].arguments[0].includes('language=EN'));
            assert.strictEqual(calls[1].arguments[1].headers['accept'], 'application/pdf');
        });

        it('should download savings statement with correct parameters', async () => {
            const mockSavingsAccount = {
                profile: mockProfile,
                accountId: 'savings456',
                accountName: 'Tangerine Savings Account',
                accountMask: '8350',
                accountType: 'Savings',
            };

            const mockSavingsStatement = {
                account: mockSavingsAccount,
                statementId: 'PENzNDEzNzE4LTc4NjIwLVVPSC0yMg',
                statementDate: '2025-09-30',
            };

            const mockListResponse = {
                response_status: { status_code: 'SUCCESS' },
                statements: [
                    {
                        end_date: '2025-09-30',
                        statement_id: 'PENzNDEzNzE4LTc4NjIwLVVPSC0yMg',
                        statement_type: 'BSTMT',
                        statement_filename: 'Tangerine-eStatement_Sep25.pdf',
                    },
                ],
            };

            const mockPdfBlob = new Blob(['PDF content'], { type: 'application/pdf' });

            const responses = [
                { ok: true, json: async () => mockListResponse },
                { ok: true, blob: async () => mockPdfBlob },
            ];
            mockFetch.mock.mockImplementation(() => Promise.resolve(responses.shift()));

            await downloadStatement(mockSavingsStatement);

            const calls = mockFetch.mock.calls;
            assert.ok(calls[1].arguments[0].includes('statement-type=BSTMT'));
            assert.ok(calls[1].arguments[0].includes('file-name=Tangerine-eStatement_Sep25.pdf'));
        });

        it('should extract month from statement date correctly', async () => {
            const mockStatementWithDifferentDate = {
                account: mockAccount,
                statementId: 'TEST123',
                statementDate: '2025-05-15', // Mid-month date
            };

            const mockListResponse = {
                response_status: { status_code: 'SUCCESS' },
                statements: [
                    {
                        end_date: '2025-05-15',
                        statement_id: 'TEST123',
                        statement_type: 'CHQ',
                        statement_filename: 'statement.pdf',
                    },
                ],
            };

            const mockPdfBlob = new Blob(['PDF content'], { type: 'application/pdf' });

            const responses = [
                { ok: true, json: async () => mockListResponse },
                { ok: true, blob: async () => mockPdfBlob },
            ];
            mockFetch.mock.mockImplementation(() => Promise.resolve(responses.shift()));

            await downloadStatement(mockStatementWithDifferentDate);

            const calls = mockFetch.mock.calls;
            assert.ok(calls[0].arguments[0].includes('start-month=2025-05&end-month=2025-05'));
        });

        it('should throw error when statement is not found in list', async () => {
            const mockListResponse = {
                response_status: { status_code: 'SUCCESS' },
                statements: [], // Empty list
            };

            mockFetch.mock.mockImplementationOnce(() =>
                Promise.resolve({
                    ok: true,
                    json: async () => mockListResponse,
                })
            );

            await assert.rejects(
                () => downloadStatement(mockStatement),
                /Statement not found in list/
            );
        });

        it('should handle statement with default filename', async () => {
            const mockListResponse = {
                response_status: { status_code: 'SUCCESS' },
                statements: [
                    {
                        end_date: '2025-10-31',
                        statement_id: 'PENzNDEzNzE4LTc4NjIwLVVPSC0yMw',
                        statement_type: 'CHQ',
                        // No statement_filename provided
                    },
                ],
            };

            const mockPdfBlob = new Blob(['PDF content'], { type: 'application/pdf' });

            const responses = [
                { ok: true, json: async () => mockListResponse },
                { ok: true, blob: async () => mockPdfBlob },
            ];
            mockFetch.mock.mockImplementation(() => Promise.resolve(responses.shift()));

            await downloadStatement(mockStatement);

            const calls = mockFetch.mock.calls;
            assert.ok(calls[1].arguments[0].includes('file-name=statement.pdf'));
        });

        it('should throw error when API request fails', async () => {
            mockFetch.mock.mockImplementation(() =>
                Promise.resolve({
                    ok: false,
                    status: 404,
                    statusText: 'Not Found',
                })
            );

            await assert.rejects(
                () => downloadStatement(mockStatement),
                /Tangerine API request failed: 404 Not Found/
            );
        });
    });
});
