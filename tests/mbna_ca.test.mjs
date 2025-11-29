/**
 * Unit tests for MBNA Canada bank statement API implementation
 * Tests cover credit card account functionality
 * 
 * Note: All mock data is based on actual content from analyze/mbna_ca_1763634839146.har
 * to ensure tests match real API responses.
 */

import { describe, it, beforeEach, mock } from 'node:test';
import assert from 'node:assert/strict';

// Mock global fetch
const mockFetch = mock.fn();
global.fetch = mockFetch;

// Mock document for getSessionId
global.document = {
    cookie: 'com.td.last_login=2874747274142; TD-persist=SOC; forceLanguage=en; OptConsentGroups=%2CC0001%2CC0002%2CC0004%2C',
};

// Import the module after setting up mocks
const mbnaModule = await import('../bank/mbna_ca.mjs');
const { bankId, getSessionId, getProfile, getAccounts, getStatements, downloadStatement } = mbnaModule;

describe('MBNA Canada API', () => {
    beforeEach(() => {
        // Reset fetch mock between tests for isolation
        mockFetch.mock.resetCalls();
    });

    describe('bankId', () => {
        it('should return the correct bank identifier', () => {
            assert.strictEqual(bankId, 'mbna_ca');
        });
    });

    describe('getSessionId', () => {
        it('should extract com.td.last_login cookie from document.cookie', () => {
            const sessionId = getSessionId();
            assert.strictEqual(sessionId, '2874747274142');
        });

        it('should throw error when com.td.last_login cookie not found', () => {
            const originalCookie = document.cookie;
            document.cookie = 'TD-persist=SOC; forceLanguage=en';

            assert.throws(() => getSessionId(), /Session cookie not found/);

            document.cookie = originalCookie;
        });
    });

    describe('getProfile', () => {
        it('should extract profile information from customer-profile API', async () => {
            const mockResponse = {
                customerName: {
                    firstname: 'JOHN',
                    lastname: 'DOE'
                }
            };

            mockFetch.mock.mockImplementationOnce(() =>
                Promise.resolve({
                    ok: true,
                    json: () => Promise.resolve(mockResponse),
                })
            );

            const sessionId = '2874747274142';
            const profile = await getProfile(sessionId);

            // Verify API call
            assert.strictEqual(mockFetch.mock.calls.length, 1);
            const [url, options] = mockFetch.mock.calls[0].arguments;
            assert.strictEqual(url, 'https://service.mbna.ca/waw/mbna/customer-profile');
            assert.strictEqual(options.method, 'GET');
            assert.strictEqual(options.headers.Accept, 'application/json, text/plain, */*');
            assert.strictEqual(options.credentials, 'include');

            // Verify profile structure
            assert.strictEqual(profile.sessionId, sessionId);
            assert.strictEqual(profile.profileId, 'JOHN_DOE');
            assert.strictEqual(profile.profileName, 'JOHN DOE');
        });

        it('should throw error when API call fails', async () => {
            mockFetch.mock.mockImplementationOnce(() =>
                Promise.resolve({
                    ok: false,
                    status: 401,
                    statusText: 'Unauthorized',
                })
            );

            const sessionId = '2874747274142';
            await assert.rejects(
                async () => await getProfile(sessionId),
                /Failed to get profile: 401 Unauthorized/
            );
        });
    });

    describe('getAccounts', () => {
        it('should retrieve credit card account from accounts/summary API', async () => {
            const mockResponse = [
                {
                    cardName: 'MBNA Rewards World Elite® Mastercard®',
                    accountId: '11353522844',
                    endingIn: '4623',
                    allowedAccountSummary: true,
                    cardNameShort: 'MBNA Rewards World Elite®',
                    eligibleForPaperlessOffer: false,
                    enrolledForPaperlessStatements: true,
                    pchName: 'JOHN DOE',
                    accountCurrentSetting: 'ONLINE',
                    accountEmail: 'john.doe@example.com',
                    allowedStandardEForms: true,
                    primaryCardHolder: true
                }
            ];

            mockFetch.mock.mockImplementationOnce(() =>
                Promise.resolve({
                    ok: true,
                    json: () => Promise.resolve(mockResponse),
                })
            );

            const profile = {
                sessionId: '2874747274142',
                profileId: 'JOHN_DOE',
                profileName: 'JOHN DOE',
            };

            const accounts = await getAccounts(profile);

            // Verify API call
            assert.strictEqual(mockFetch.mock.calls.length, 1);
            const [url, options] = mockFetch.mock.calls[0].arguments;
            assert.strictEqual(url, 'https://service.mbna.ca/waw/mbna/accounts/summary');
            assert.strictEqual(options.method, 'GET');
            assert.strictEqual(options.headers.Accept, 'application/json, text/plain, */*');
            assert.strictEqual(options.credentials, 'include');

            // Verify accounts structure
            assert.strictEqual(accounts.length, 1);
            assert.strictEqual(accounts[0].accountId, '11353522844');
            assert.strictEqual(accounts[0].accountName, 'MBNA Rewards World Elite® Mastercard®');
            assert.strictEqual(accounts[0].accountMask, '4623');
            assert.strictEqual(accounts[0].accountType, 'CreditCard');
            assert.deepStrictEqual(accounts[0].profile, profile);
        });

        it('should handle empty account list', async () => {
            mockFetch.mock.mockImplementationOnce(() =>
                Promise.resolve({
                    ok: true,
                    json: () => Promise.resolve([]),
                })
            );

            const profile = {
                sessionId: '2874747274142',
                profileId: 'JOHN_DOE',
                profileName: 'JOHN DOE',
            };

            const accounts = await getAccounts(profile);
            assert.strictEqual(accounts.length, 0);
        });

        it('should throw error when API call fails', async () => {
            mockFetch.mock.mockImplementationOnce(() =>
                Promise.resolve({
                    ok: false,
                    status: 500,
                    statusText: 'Internal Server Error',
                })
            );

            const profile = {
                sessionId: '2874747274142',
                profileId: 'JOHN_DOE',
                profileName: 'JOHN DOE',
            };

            await assert.rejects(
                async () => await getAccounts(profile),
                /Failed to get accounts: 500 Internal Server Error/
            );
        });
    });

    describe('getStatements', () => {
        it('should retrieve statements for multiple years', async () => {
            const mockResponse2025 = {
                errorCode: '',
                dmsAvailable: true,
                StatementItem: [
                    {
                        closingDate: 'Nov 17, 2025 12:00:00 AM',
                        closingDateFmted: '2025-11-17',
                        documentId: '04BF7E0D6137CE8F',
                        description: ' ',
                        statementFileName: 'eStmt_2025-11-17.PDF',
                        dmsAvailable: false
                    },
                    {
                        closingDate: 'Oct 17, 2025 12:00:00 AM',
                        closingDateFmted: '2025-10-17',
                        documentId: '98B956F0G579F387',
                        description: ' ',
                        statementFileName: 'eStmt_2025-10-17.PDF',
                        dmsAvailable: false
                    }
                ]
            };

            const mockResponse2024 = {
                errorCode: '',
                dmsAvailable: true,
                StatementItem: [
                    {
                        closingDate: 'Dec 17, 2024 12:00:00 AM',
                        closingDateFmted: '2024-12-17',
                        documentId: '23456789',
                        description: ' ',
                        statementFileName: 'eStmt_2024-12-17.PDF',
                        dmsAvailable: false
                    }
                ]
            };

            let callCount = 0;
            mockFetch.mock.mockImplementation(() => {
                callCount++;
                // First call (2025)
                if (callCount === 1) {
                    return Promise.resolve({
                        ok: true,
                        json: () => Promise.resolve(mockResponse2025),
                    });
                }
                // Second call (2024)
                if (callCount === 2) {
                    return Promise.resolve({
                        ok: true,
                        json: () => Promise.resolve(mockResponse2024),
                    });
                }
                // Remaining years - no statements
                return Promise.resolve({
                    ok: false,
                    status: 404,
                });
            });

            const account = {
                profile: {
                    sessionId: '2874747274142',
                    profileId: 'JOHN_DOE',
                    profileName: 'JOHN DOE',
                },
                accountId: '11353522844',
                accountName: 'MBNA Rewards World Elite® Mastercard®',
                accountMask: '4623',
                accountType: 'CreditCard',
            };

            const statements = await getStatements(account);

            // Verify we tried to fetch 7 years
            assert.strictEqual(mockFetch.mock.calls.length, 7);

            // Verify statements structure
            assert.strictEqual(statements.length, 3);
            assert.strictEqual(statements[0].statementId, '2025-11-17');
            assert.strictEqual(statements[0].statementDate, '2025-11-17');
            assert.strictEqual(statements[1].statementId, '2025-10-17');
            assert.strictEqual(statements[1].statementDate, '2025-10-17');
            assert.strictEqual(statements[2].statementId, '2024-12-17');
            assert.strictEqual(statements[2].statementDate, '2024-12-17');
            assert.deepStrictEqual(statements[0].account, account);
        });

        it('should handle years with no statements gracefully', async () => {
            mockFetch.mock.mockImplementation(() =>
                Promise.resolve({
                    ok: false,
                    status: 404,
                })
            );

            const account = {
                profile: {
                    sessionId: '2874747274142',
                    profileId: 'JOHN_DOE',
                    profileName: 'JOHN DOE',
                },
                accountId: '11353522844',
                accountName: 'MBNA Rewards World Elite® Mastercard®',
                accountMask: '4623',
                accountType: 'CreditCard',
            };

            const statements = await getStatements(account);

            // Should have tried 7 years but got no statements
            assert.strictEqual(mockFetch.mock.calls.length, 7);
            assert.strictEqual(statements.length, 0);
        });

        it('should handle API errors gracefully and continue', async () => {
            let callCount = 0;
            mockFetch.mock.mockImplementation(() => {
                callCount++;
                if (callCount === 1) {
                    // First year throws error
                    return Promise.reject(new Error('Network error'));
                }
                // Other years return 404
                return Promise.resolve({
                    ok: false,
                    status: 404,
                });
            });

            const account = {
                profile: {
                    sessionId: '2874747274142',
                    profileId: 'JOHN_DOE',
                    profileName: 'JOHN DOE',
                },
                accountId: '11353522844',
                accountName: 'MBNA Rewards World Elite® Mastercard®',
                accountMask: '4623',
                accountType: 'CreditCard',
            };

            const statements = await getStatements(account);

            // Should have tried all 7 years despite error
            assert.strictEqual(mockFetch.mock.calls.length, 7);
            assert.strictEqual(statements.length, 0);
        });

        it('should verify correct API URL format for each year', async () => {
            mockFetch.mock.mockImplementation(() =>
                Promise.resolve({
                    ok: false,
                    status: 404,
                })
            );

            const account = {
                profile: {
                    sessionId: '2874747274142',
                    profileId: 'JOHN_DOE',
                    profileName: 'JOHN DOE',
                },
                accountId: '11353522844',
                accountName: 'MBNA Rewards World Elite® Mastercard®',
                accountMask: '4623',
                accountType: 'CreditCard',
            };

            await getStatements(account);

            const currentYear = new Date().getFullYear();
            for (let i = 0; i < 7; i++) {
                const year = currentYear - i;
                const [url, options] = mockFetch.mock.calls[i].arguments;
                assert.strictEqual(
                    url,
                    `https://service.mbna.ca/waw/mbna/accounts/11353522844/statement-history/${year}`
                );
                assert.strictEqual(options.method, 'GET');
                assert.strictEqual(options.credentials, 'include');
            }
        });
    });

    describe('downloadStatement', () => {
        it('should download statement PDF with correct URL format', async () => {
            const mockBlob = new Blob(['PDF content'], { type: 'application/pdf' });

            mockFetch.mock.mockImplementationOnce(() =>
                Promise.resolve({
                    ok: true,
                    blob: () => Promise.resolve(mockBlob),
                })
            );

            const statement = {
                account: {
                    profile: {
                        sessionId: '2874747274142',
                        profileId: 'JOHN_DOE',
                        profileName: 'JOHN DOE',
                    },
                    accountId: '11353522844',
                    accountName: 'MBNA Rewards World Elite® Mastercard®',
                    accountMask: '4623',
                    accountType: 'CreditCard',
                },
                statementId: '2025-11-17',
                statementDate: '2025-11-17',
            };

            const blob = await downloadStatement(statement);

            // Verify API call
            assert.strictEqual(mockFetch.mock.calls.length, 1);
            const [url, options] = mockFetch.mock.calls[0].arguments;
            assert.strictEqual(
                url,
                'https://service.mbna.ca/waw/mbna/accounts/11353522844/statement-history/open-save/selected-date/2025-11-17?format=PDF&contentDisposition=attachment&folder=&insertDocId='
            );
            assert.strictEqual(options.method, 'GET');
            assert.strictEqual(options.headers.Accept, 'application/pdf, */*');
            assert.strictEqual(options.credentials, 'include');

            // Verify blob
            assert.strictEqual(blob, mockBlob);
        });

        it('should throw error when download fails', async () => {
            mockFetch.mock.mockImplementationOnce(() =>
                Promise.resolve({
                    ok: false,
                    status: 403,
                    statusText: 'Forbidden',
                })
            );

            const statement = {
                account: {
                    profile: {
                        sessionId: '2874747274142',
                        profileId: 'JOHN_DOE',
                        profileName: 'JOHN DOE',
                    },
                    accountId: '11353522844',
                    accountName: 'MBNA Rewards World Elite® Mastercard®',
                    accountMask: '4623',
                    accountType: 'CreditCard',
                },
                statementId: '2025-11-17',
                statementDate: '2025-11-17',
            };

            await assert.rejects(
                async () => await downloadStatement(statement),
                /Failed to download statement: 403 Forbidden/
            );
        });
    });
});
