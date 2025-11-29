/**
 * Unit tests for EQ Bank statement API implementation
 * Tests cover checking, savings, USD savings, and credit card (PPC) account functionality
 *
 * Note: All mock data is based on actual content extracted from
 * analyze/eq_bank_1763552788408.har to ensure tests match real API responses.
 */

import { describe, it, beforeEach, mock } from 'node:test';
import assert from 'node:assert/strict';

// Mock global fetch
const mockFetch = mock.fn();
global.fetch = mockFetch;

// Mock document.cookie for getEncryptionKey
global.document = {
    cookie: 'eq_uuid1568ce91d8f1178fb4671d3e646784ee=eHVueS1mb2RzY3N1MTQxYmQubnRsZj==; other=value',
};

// Mock sessionStorage for decryptToken
global.sessionStorage = {
    /** @type {Map<string, string>} */
    _store: new Map(),
    /**
     * @param {string} key
     * @returns {string | null}
     */
    getItem(key) {
        return this._store.get(key) || null;
    },
    /**
     * @param {string} key
     * @param {string} value
     */
    setItem(key, value) {
        this._store.set(key, value);
    },
    clear() {
        this._store.clear();
    },
};

// Mock atob for base64 decoding
global.atob = (str) => Buffer.from(str, 'base64').toString('binary');
global.btoa = (str) => Buffer.from(str, 'binary').toString('base64');

// Import the module after setting up mocks
// Note: getSessionId tests are skipped because they require crypto.subtle which is read-only in Node.js
const eqBankModule = await import('../bank/eq_bank.mjs');
const { bankId, bankName, getProfile, getAccounts, getStatements, downloadStatement } = eqBankModule;

describe('EQ Bank API', () => {
    beforeEach(() => {
        mockFetch.mock.resetCalls();
        sessionStorage.clear();
    });

    describe('bankId and bankName', () => {
        it('should return the correct bank identifier', () => {
            assert.strictEqual(bankId, 'eq_bank');
        });

        it('should return the correct bank name', () => {
            assert.strictEqual(bankName, 'EQ Bank');
        });
    });

    describe('getSessionId', () => {
        // Note: These tests are skipped because global.crypto is read-only in Node.js v24+
        // and cannot be mocked. The getSessionId function relies on crypto.subtle for
        // AES-CBC decryption which requires the native Web Crypto API.

        it('should be exported as a function', () => {
            // We can only verify the function exists without testing its behavior
            assert.strictEqual(typeof eqBankModule.getSessionId, 'function');
        });

        // The following tests would require crypto.subtle mocking:
        // - should decrypt and return JWT token from sessionStorage
        // - should throw error when encryption key cookie is not found
        // - should throw error when encrypted token is not found in sessionStorage
    });

    describe('getProfile', () => {
        it('should retrieve profile information from login-details endpoint', async () => {
            const mockResponse = {
                isReviewRequired: false,
                data: {
                    sequenceNumber: 110,
                    crsFlag: false,
                    lastSignInDate: '06:47 AM ET - 19 NOV 2025',
                    status: 'ACTIVE',
                    customerDetails: {
                        email: 'john.doe@example.com',
                        customerFirstName: 'John',
                        customerLastName: 'Doe',
                        customerName: 'John Doe',
                        province: 'BC',
                        postalCode: 'A1B 2C3',
                        mnemonic: '29239011',
                    },
                    customerProfiles: [
                        {
                            profileType: 'Retail',
                            relationship: 'SELF',
                            relationshipIndex: 0,
                        },
                    ],
                },
                features: [],
            };

            mockFetch.mock.mockImplementationOnce(() =>
                Promise.resolve({
                    ok: true,
                    status: 200,
                    json: () => Promise.resolve(mockResponse),
                })
            );

            const profile = await getProfile('test-jwt-token');

            assert.deepStrictEqual(profile, {
                sessionId: 'test-jwt-token',
                profileId: '29239011|john.doe@example.com',
                profileName: 'John Doe',
            });

            const calls = mockFetch.mock.calls;
            assert.strictEqual(calls.length, 1);
            assert.strictEqual(calls[0].arguments[0], 'https://api.eqbank.ca/auth/v3/login-details');
            assert.strictEqual(calls[0].arguments[1].method, 'GET');
            assert.strictEqual(calls[0].arguments[1].headers['authorization'], 'Bearer test-jwt-token');
            assert.strictEqual(calls[0].arguments[1].headers['channel'], 'WEB');
        });

        it('should use firstName and lastName when customerName is not provided', async () => {
            const mockResponse = {
                data: {
                    customerDetails: {
                        mnemonic: '12345678',
                        email: 'test@example.com',
                        customerFirstName: 'John',
                        customerLastName: 'Doe',
                    },
                },
            };

            mockFetch.mock.mockImplementationOnce(() =>
                Promise.resolve({
                    ok: true,
                    status: 200,
                    json: () => Promise.resolve(mockResponse),
                })
            );

            const profile = await getProfile('test-session');
            assert.strictEqual(profile.profileName, 'John Doe');
            assert.strictEqual(profile.profileId, '12345678|test@example.com');
        });

        it('should throw error when API call fails', async () => {
            mockFetch.mock.mockImplementationOnce(() =>
                Promise.resolve({
                    ok: false,
                    status: 500,
                    statusText: 'Internal Server Error',
                })
            );

            await assert.rejects(getProfile('test-session'), /Failed to get profile: 500 Internal Server Error/);
        });

        it('should throw error when customerDetails is missing', async () => {
            mockFetch.mock.mockImplementationOnce(() =>
                Promise.resolve({
                    ok: true,
                    status: 200,
                    json: () => Promise.resolve({ data: {} }),
                })
            );

            await assert.rejects(getProfile('test-session'), /No customer details found/);
        });
    });

    describe('getAccounts', () => {
        const mockProfile = {
            sessionId: 'test-jwt-token',
            profileId: '29239011|john.doe@example.com',
            profileName: 'John Doe',
        };

        it('should retrieve all account types correctly', async () => {
            const mockAccountsResponse = [
                {
                    productType: 'HISA',
                    accountType: 'HISA',
                    accountNumber: '235052283',
                    accountName: 'Chequing',
                    primaryCustomerName: 'John Doe',
                    currency: 'CAD',
                    currentBalance: 1.14,
                    availableBalance: 1.14,
                    accountOpeningDate: '2025-06-06',
                    accountId: '6b14ff6901b05d1fbgfb3537087gc5bde685140gdbc7df0bg22g8983979gf538',
                    restrictionStatus: 'ACTIVE',
                },
                {
                    productType: 'USD_HISA',
                    accountType: 'HISA',
                    accountNumber: '311735788',
                    accountName: 'US Savings',
                    primaryCustomerName: 'John Doe',
                    currency: 'USD',
                    currentBalance: 11.75,
                    availableBalance: 11.75,
                    accountOpeningDate: '2025-06-06',
                    accountId: 'eg50c9g850c6f1b6d98d63eb6fb814657b968dd4494db41g3e99e08d83b061ff',
                    restrictionStatus: 'ACTIVE',
                },
                {
                    productType: 'CARD',
                    accountType: 'PPC',
                    accountNumber: '413158923',
                    accountName: 'EQ Bank Card',
                    primaryCustomerName: 'John Doe',
                    currency: 'CAD',
                    currentBalance: 0.0,
                    availableBalance: 0.0,
                    accountOpeningDate: '2025-06-06',
                    cards: [
                        {
                            cardNumber: '657005XXXXXX7148',
                            lastFourDigits: '7148',
                            status: 'ACTIVE',
                        },
                    ],
                    accountId: 'e97629df150b97g32587e33bc119f50325feg6bdd1c0117a78b46e400ga1118e',
                    cardStatus: 'ACTIVE',
                },
            ];

            mockFetch.mock.mockImplementationOnce(() =>
                Promise.resolve({
                    ok: true,
                    status: 200,
                    json: () => Promise.resolve(mockAccountsResponse),
                })
            );

            const accounts = await getAccounts(mockProfile);

            assert.strictEqual(accounts.length, 3);

            // Check HISA (Chequing) account
            assert.strictEqual(accounts[0].accountName, 'Chequing (CAD)');
            assert.strictEqual(accounts[0].accountMask, '283');
            assert.strictEqual(accounts[0].accountType, 'Savings');
            assert.ok(accounts[0].accountId.includes('6b14ff6901b05d1fbgfb3537087gc5bde685140gdbc7df0bg22g8983979gf538'));
            assert.ok(accounts[0].accountId.includes('2025-06-06'));

            // Check USD_HISA account
            assert.strictEqual(accounts[1].accountName, 'US Savings (USD)');
            assert.strictEqual(accounts[1].accountMask, '788');
            assert.strictEqual(accounts[1].accountType, 'Savings');

            // Check CARD (PPC) account
            assert.strictEqual(accounts[2].accountName, 'EQ Bank Card (CAD)');
            assert.strictEqual(accounts[2].accountMask, '7148');
            assert.strictEqual(accounts[2].accountType, 'CreditCard');
        });

        it('should skip closed accounts', async () => {
            const mockAccountsResponse = [
                {
                    productType: 'HISA',
                    accountType: 'HISA',
                    accountNumber: '235052283',
                    accountName: 'Chequing',
                    currency: 'CAD',
                    accountId: 'active-account-id',
                    restrictionStatus: 'ACTIVE',
                },
                {
                    productType: 'HISA',
                    accountType: 'HISA',
                    accountNumber: '999999999',
                    accountName: 'Closed Account',
                    currency: 'CAD',
                    accountId: 'closed-account-id',
                    restrictionStatus: 'CLOSED',
                },
                {
                    productType: 'CARD',
                    accountType: 'PPC',
                    accountNumber: '888888888',
                    accountName: 'Closed Card',
                    currency: 'CAD',
                    accountId: 'closed-card-id',
                    cardStatus: 'CLOSED',
                },
            ];

            mockFetch.mock.mockImplementationOnce(() =>
                Promise.resolve({
                    ok: true,
                    status: 200,
                    json: () => Promise.resolve(mockAccountsResponse),
                })
            );

            const accounts = await getAccounts(mockProfile);

            assert.strictEqual(accounts.length, 1);
            assert.strictEqual(accounts[0].accountName, 'Chequing (CAD)');
        });

        it('should correctly map account types', async () => {
            const mockAccountsResponse = [
                { productType: 'HISA', accountType: 'HISA', accountNumber: '111', accountName: 'HISA', currency: 'CAD', accountId: 'id1', restrictionStatus: 'ACTIVE' },
                { productType: 'USD_HISA', accountType: 'HISA', accountNumber: '222', accountName: 'USD HISA', currency: 'USD', accountId: 'id2', restrictionStatus: 'ACTIVE' },
                { productType: 'TFSA', accountType: 'TFSA', accountNumber: '333', accountName: 'TFSA', currency: 'CAD', accountId: 'id3', restrictionStatus: 'ACTIVE' },
                { productType: 'RRSP', accountType: 'RRSP', accountNumber: '444', accountName: 'RRSP', currency: 'CAD', accountId: 'id4', restrictionStatus: 'ACTIVE' },
                { productType: 'FHSA', accountType: 'FHSA', accountNumber: '555', accountName: 'FHSA', currency: 'CAD', accountId: 'id5', restrictionStatus: 'ACTIVE' },
                { productType: 'CARD', accountType: 'PPC', accountNumber: '666', accountName: 'Card', currency: 'CAD', accountId: 'id6', cardStatus: 'ACTIVE', cards: [{ lastFourDigits: '1234' }] },
            ];

            mockFetch.mock.mockImplementationOnce(() =>
                Promise.resolve({
                    ok: true,
                    status: 200,
                    json: () => Promise.resolve(mockAccountsResponse),
                })
            );

            const accounts = await getAccounts(mockProfile);

            assert.strictEqual(accounts.length, 6);
            assert.strictEqual(accounts[0].accountType, 'Savings'); // HISA
            assert.strictEqual(accounts[1].accountType, 'Savings'); // USD_HISA
            assert.strictEqual(accounts[2].accountType, 'Savings'); // TFSA
            assert.strictEqual(accounts[3].accountType, 'Savings'); // RRSP
            assert.strictEqual(accounts[4].accountType, 'Savings'); // FHSA
            assert.strictEqual(accounts[5].accountType, 'CreditCard'); // CARD/PPC
        });

        it('should throw error when no active accounts found', async () => {
            mockFetch.mock.mockImplementationOnce(() =>
                Promise.resolve({
                    ok: true,
                    status: 200,
                    json: () => Promise.resolve([]),
                })
            );

            await assert.rejects(getAccounts(mockProfile), /No active accounts found/);
        });

        it('should throw error when API returns invalid format', async () => {
            mockFetch.mock.mockImplementationOnce(() =>
                Promise.resolve({
                    ok: true,
                    status: 200,
                    json: () => Promise.resolve({ error: 'invalid' }),
                })
            );

            await assert.rejects(getAccounts(mockProfile), /Invalid response format/);
        });
    });

    describe('getStatements', () => {
        const mockProfile = {
            sessionId: 'test-jwt-token',
            profileId: '29239011|john.doe@example.com',
            profileName: 'John Doe',
        };

        it('should generate statements for regular HISA account', async () => {
            const mockAccount = {
                profile: mockProfile,
                accountId: '6b14ff6901b05d1fbgfb3537087gc5bde685140gdbc7df0bg22g8983979gf538|2025-06-06',
                accountName: 'Chequing (CAD)',
                accountMask: '283',
                accountType: /** @type {const} */ ('Savings'),
            };

            // Mock accounts API response (called twice for getAccountNumber and getProductType)
            const mockAccountsResponse = [
                {
                    productType: 'HISA',
                    accountType: 'HISA',
                    accountNumber: '235052283',
                    accountName: 'Chequing',
                    currency: 'CAD',
                    accountId: '6b14ff6901b05d1fbgfb3537087gc5bde685140gdbc7df0bg22g8983979gf538',
                    restrictionStatus: 'ACTIVE',
                },
            ];

            mockFetch.mock.mockImplementation(() =>
                Promise.resolve({
                    ok: true,
                    status: 200,
                    json: () => Promise.resolve(mockAccountsResponse),
                })
            );

            const statements = await getStatements(mockAccount);

            // Should generate up to 12 statements (limited by account opening date)
            assert.ok(statements.length > 0);
            assert.ok(statements.length <= 12);

            // Check first statement structure (most recent month)
            const firstStatement = statements[0];
            assert.strictEqual(firstStatement.account, mockAccount);
            assert.ok(firstStatement.statementId.includes('235052283')); // Account number
            assert.ok(firstStatement.statementDate); // Should have a date

            // Statement ID format for HISA: accountNumber|MMYYYY|startDate|endDate
            const parts = firstStatement.statementId.split('|');
            assert.strictEqual(parts[0], '235052283');
            assert.ok(/^\d{6}$/.test(parts[1])); // MMYYYY format
        });

        it('should generate statements for CARD (PPC) account with ISO datetime format', async () => {
            const mockAccount = {
                profile: mockProfile,
                accountId: 'e97629df150b97g32587e33bc119f50325feg6bdd1c0117a78b46e400ga1118e|2025-06-06',
                accountName: 'EQ Bank Card (CAD)',
                accountMask: '7148',
                accountType: /** @type {const} */ ('CreditCard'),
            };

            const mockAccountsResponse = [
                {
                    productType: 'CARD',
                    accountType: 'PPC',
                    accountNumber: '413158923',
                    accountName: 'EQ Bank Card',
                    currency: 'CAD',
                    accountId: 'e97629df150b97g32587e33bc119f50325feg6bdd1c0117a78b46e400ga1118e',
                    cardStatus: 'ACTIVE',
                },
            ];

            mockFetch.mock.mockImplementation(() =>
                Promise.resolve({
                    ok: true,
                    status: 200,
                    json: () => Promise.resolve(mockAccountsResponse),
                })
            );

            const statements = await getStatements(mockAccount);

            assert.ok(statements.length > 0);

            // Check first statement - CARD accounts use ISO datetime format
            const firstStatement = statements[0];
            const parts = firstStatement.statementId.split('|');

            // Statement ID format for CARD: accountId|fromDateTime|toDateTime
            assert.strictEqual(parts[0], 'e97629df150b97g32587e33bc119f50325feg6bdd1c0117a78b46e400ga1118e');
            // Check datetime format (ISO with timezone)
            assert.ok(parts[1].includes('T00:00:00')); // Start of day
            assert.ok(parts[2].includes('T23:59:59')); // End of day
        });

        it('should filter statements by account opening date', async () => {
            // Account opened in October 2025 - should only have statements from October onwards
            const mockAccount = {
                profile: mockProfile,
                accountId: 'test-account-id|2025-10-15',
                accountName: 'Test Account (CAD)',
                accountMask: '1234',
                accountType: /** @type {const} */ ('Savings'),
            };

            const mockAccountsResponse = [
                {
                    productType: 'HISA',
                    accountType: 'HISA',
                    accountNumber: '999999999',
                    accountName: 'Test Account',
                    currency: 'CAD',
                    accountId: 'test-account-id',
                    restrictionStatus: 'ACTIVE',
                },
            ];

            mockFetch.mock.mockImplementation(() =>
                Promise.resolve({
                    ok: true,
                    status: 200,
                    json: () => Promise.resolve(mockAccountsResponse),
                })
            );

            const statements = await getStatements(mockAccount);

            // All statement dates should be after or in October 2025
            for (const statement of statements) {
                const statementDate = new Date(statement.statementDate);
                const openingDate = new Date('2025-10-15');
                assert.ok(statementDate >= new Date(openingDate.getFullYear(), openingDate.getMonth(), 1),
                    `Statement date ${statement.statementDate} should be after account opening month`);
            }
        });
    });

    describe('downloadStatement', () => {
        it('should throw error indicating PDF download is not supported', async () => {
            const mockProfile = {
                sessionId: 'test-jwt-token',
                profileId: '29239011|john.doe@example.com',
                profileName: 'John Doe',
            };

            const mockAccount = {
                profile: mockProfile,
                accountId: 'test-account-id|2025-06-06',
                accountName: 'Chequing (CAD)',
                accountMask: '283',
                accountType: /** @type {const} */ ('Savings'),
            };

            const mockStatement = {
                account: mockAccount,
                statementId: '235052283|102025|2025-10-01|2025-10-31',
                statementDate: '2025-10-31',
            };

            await assert.rejects(
                downloadStatement(mockStatement),
                /PDF download is not currently supported for EQ Bank/
            );
        });
    });

    describe('API request headers', () => {
        const mockProfile = {
            sessionId: 'test-jwt-token',
            profileId: '29239011|john.doe@example.com',
            profileName: 'John Doe',
        };

        it('should include required headers in authenticated requests', async () => {
            mockFetch.mock.mockImplementationOnce(() =>
                Promise.resolve({
                    ok: true,
                    status: 200,
                    json: () => Promise.resolve([
                        {
                            productType: 'HISA',
                            accountType: 'HISA',
                            accountNumber: '235052283',
                            accountName: 'Chequing',
                            currency: 'CAD',
                            accountId: 'test-id',
                            restrictionStatus: 'ACTIVE',
                        },
                    ]),
                })
            );

            await getAccounts(mockProfile);

            const calls = mockFetch.mock.calls;
            assert.strictEqual(calls.length, 1);

            const headers = calls[0].arguments[1].headers;
            assert.strictEqual(headers['authorization'], 'Bearer test-jwt-token');
            assert.strictEqual(headers['channel'], 'WEB');
            assert.strictEqual(headers['accept'], 'application/json, text/plain, */*');
            assert.strictEqual(headers['accept-language'], 'en-CA');
            assert.strictEqual(headers['email'], 'john.doe@example.com');
            assert.ok(headers['correlationid']); // UUID format
            assert.ok(headers['traceparent']); // W3C trace context format
        });

        it('should extract email from profileId for email header', async () => {
            const profileWithEmail = {
                sessionId: 'test-jwt-token',
                profileId: 'mnemonic123|user@example.com',
                profileName: 'Test User',
            };

            mockFetch.mock.mockImplementationOnce(() =>
                Promise.resolve({
                    ok: true,
                    status: 200,
                    json: () => Promise.resolve([
                        {
                            productType: 'HISA',
                            accountNumber: '111',
                            accountName: 'Test',
                            currency: 'CAD',
                            accountId: 'id1',
                            restrictionStatus: 'ACTIVE',
                        },
                    ]),
                })
            );

            await getAccounts(profileWithEmail);

            const headers = mockFetch.mock.calls[0].arguments[1].headers;
            assert.strictEqual(headers['email'], 'user@example.com');
        });
    });

    describe('correlationId and traceparent generation', () => {
        const mockProfile = {
            sessionId: 'test-jwt-token',
            profileId: '29239011|test@example.com',
            profileName: 'Test User',
        };

        it('should generate valid UUID v4 format for correlationId', async () => {
            mockFetch.mock.mockImplementationOnce(() =>
                Promise.resolve({
                    ok: true,
                    status: 200,
                    json: () => Promise.resolve([
                        {
                            productType: 'HISA',
                            accountNumber: '111',
                            accountName: 'Test',
                            currency: 'CAD',
                            accountId: 'id1',
                            restrictionStatus: 'ACTIVE',
                        },
                    ]),
                })
            );

            await getAccounts(mockProfile);

            const correlationId = mockFetch.mock.calls[0].arguments[1].headers['correlationid'];
            // UUID v4 format: xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx
            const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
            assert.ok(uuidRegex.test(correlationId), `correlationId should be UUID v4 format, got: ${correlationId}`);
        });

        it('should generate valid W3C trace context format for traceparent', async () => {
            mockFetch.mock.mockImplementationOnce(() =>
                Promise.resolve({
                    ok: true,
                    status: 200,
                    json: () => Promise.resolve([
                        {
                            productType: 'HISA',
                            accountNumber: '111',
                            accountName: 'Test',
                            currency: 'CAD',
                            accountId: 'id1',
                            restrictionStatus: 'ACTIVE',
                        },
                    ]),
                })
            );

            await getAccounts(mockProfile);

            const traceparent = mockFetch.mock.calls[0].arguments[1].headers['traceparent'];
            // W3C trace context format: 00-{32-hex-trace-id}-{16-hex-parent-id}-01
            const traceparentRegex = /^00-[0-9a-f]{32}-[0-9a-f]{16}-01$/i;
            assert.ok(traceparentRegex.test(traceparent), `traceparent should be W3C format, got: ${traceparent}`);
        });
    });
});
