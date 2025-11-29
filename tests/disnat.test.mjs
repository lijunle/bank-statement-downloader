/**
 * Unit tests for Disnat bank statement API implementation
 * Tests cover brokerage account functionality
 * 
 * Note: All mock data is based on actual content from analyze/disnat.har
 * to ensure tests match real API responses.
 */

import { describe, it, beforeEach, mock } from 'node:test';
import assert from 'node:assert/strict';

// Mock global fetch
const mockFetch = mock.fn();
global.fetch = mockFetch;

// Mock document.cookie for getSessionId
global.document = {
    cookie: 'JSESSIONID=129D9984B3592E2D32G19B0642G51050; XSRF-TOKEN=e468g38d-0396-5b02-0f4g-d48gc2e5f964; other=value',
};

// Import the module after setting up mocks
const disnatModule = await import('../bank/disnat.mjs');
const { bankId, getSessionId, getProfile, getAccounts, getStatements, downloadStatement } = disnatModule;

describe('Disnat API', () => {
    beforeEach(() => {
        // Reset fetch mock between tests for isolation
        mockFetch.mock.resetCalls();
    });

    describe('bankId', () => {
        it('should return the correct bank identifier', () => {
            assert.strictEqual(bankId, 'disnat');
        });
    });

    describe('getSessionId', () => {
        it('should extract XSRF-TOKEN cookie from document.cookie', () => {
            const sessionId = getSessionId();
            assert.strictEqual(sessionId, 'e468g38d-0396-5b02-0f4g-d48gc2e5f964');
        });

        it('should throw error when XSRF-TOKEN cookie is not found', () => {
            const originalCookie = document.cookie;
            document.cookie = 'JSESSIONID=test; other=value';

            assert.throws(() => getSessionId(), /XSRF-TOKEN cookie is missing/);

            document.cookie = originalCookie;
        });
    });

    describe('getProfile', () => {
        it('should extract profile information from demographics API', async () => {
            const mockResponse = {
                status: 'OK',
                payload: {
                    demographics: {
                        self: {
                            firstName: 'JOHN',
                            lastName: 'DOE',
                            language: 'EN',
                            tradingPlatformAllowed: false,
                        },
                        emailAddress: 'john.doe@example.com',
                        referenceClientDemographicsJson: {
                            clientType: 'INDIVIDU',
                            sexCode: 'M',
                            clientCode: '6N3KA',
                            businessLineCode: 'DC',
                            age: 35,
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

            const profile = await getProfile('e468g38d-0396-5b02-0f4g-d48gc2e5f964');

            assert.deepStrictEqual(profile, {
                sessionId: 'e468g38d-0396-5b02-0f4g-d48gc2e5f964',
                profileId: '6N3KA',
                profileName: 'JOHN DOE',
            });

            const calls = mockFetch.mock.calls;
            assert.strictEqual(calls.length, 1);
            const [url, options] = calls[0].arguments;
            assert.match(url, /\/s9web\/secure\/demographics\?_=\d+/);
            assert.strictEqual(options.credentials, 'include');
        });

        it('should throw error when demographics API returns invalid response', async () => {
            mockFetch.mock.mockImplementationOnce(() =>
                Promise.resolve({
                    ok: true,
                    json: () => Promise.resolve({ status: 'ERROR' }),
                })
            );

            await assert.rejects(
                getProfile('test-session-id'),
                /Invalid response format from demographics API/
            );
        });

        it('should throw error when clientCode is missing', async () => {
            mockFetch.mock.mockImplementationOnce(() =>
                Promise.resolve({
                    ok: true,
                    json: () =>
                        Promise.resolve({
                            status: 'OK',
                            payload: {
                                demographics: {
                                    self: { firstName: 'JOHN', lastName: 'DOE' },
                                    referenceClientDemographicsJson: {},
                                },
                            },
                        }),
                })
            );

            await assert.rejects(
                getProfile('test-session-id'),
                /Client code not found in demographics response/
            );
        });

        it('should use clientCode as fallback when name is empty', async () => {
            mockFetch.mock.mockImplementationOnce(() =>
                Promise.resolve({
                    ok: true,
                    json: () =>
                        Promise.resolve({
                            status: 'OK',
                            payload: {
                                demographics: {
                                    self: { firstName: '', lastName: '' },
                                    referenceClientDemographicsJson: {
                                        clientCode: '6N3KA',
                                    },
                                },
                            },
                        }),
                })
            );

            const profile = await getProfile('test-session-id');
            assert.strictEqual(profile.profileName, '6N3KA');
        });
    });

    describe('getAccounts', () => {
        it('should retrieve CAD and USD cash accounts from portfolio API', async () => {
            const mockProfile = {
                sessionId: 'test-session',
                profileId: '6N3KA',
                profileName: 'JOHN DOE',
            };

            const mockResponse = {
                referenceClientId: '6N3KA',
                clients: [
                    {
                        clientId: '6N3KA',
                        name: 'JOHN DOE',
                        accounts: [
                            {
                                accountId: '6N3KAA2',
                                accountType: 'CASH',
                                primaryCurrency: 'CAD',
                                accountStatusCode: 'OPEN',
                                balances: [
                                    {
                                        accountNumber: '6N3KAA2',
                                        currency: 'CAD',
                                        summary: {
                                            cash: 4843.35,
                                            securities: 3728.4,
                                            total: 8571.75,
                                        },
                                    },
                                ],
                            },
                            {
                                accountId: '6N3KAB0',
                                accountType: 'CASH',
                                primaryCurrency: 'USD',
                                accountStatusCode: 'OPEN',
                                balances: [
                                    {
                                        accountNumber: '6N3KAB0',
                                        currency: 'USD',
                                        summary: {
                                            cash: 8.8,
                                            securities: 0,
                                            total: 8.8,
                                        },
                                    },
                                ],
                            },
                        ],
                    },
                ],
            };

            mockFetch.mock.mockImplementationOnce(() =>
                Promise.resolve({
                    ok: true,
                    json: () => Promise.resolve(mockResponse),
                })
            );

            const accounts = await getAccounts(mockProfile);

            assert.strictEqual(accounts.length, 2);

            // Verify CAD account
            assert.strictEqual(accounts[0].accountId, '6N3KAA2');
            assert.strictEqual(accounts[0].accountName, 'CASH CAD');
            assert.strictEqual(accounts[0].accountMask, 'KAA2');
            assert.strictEqual(accounts[0].accountType, 'Investment');

            // Verify USD account
            assert.strictEqual(accounts[1].accountId, '6N3KAB0');
            assert.strictEqual(accounts[1].accountName, 'CASH USD');
            assert.strictEqual(accounts[1].accountMask, 'KAB0');
            assert.strictEqual(accounts[1].accountType, 'Investment');

            const calls = mockFetch.mock.calls;
            assert.strictEqual(calls.length, 1);
            const [url] = calls[0].arguments;
            assert.match(url, /\/s9web\/secure\/web-api\/v2\/portfolio\/group\/6N3KADC/);
        });

        it('should handle accounts with empty account numbers', async () => {
            const mockProfile = {
                sessionId: 'test-session',
                profileId: '6N3KA',
                profileName: 'JOHN DOE',
            };

            const mockResponse = {
                clients: [
                    {
                        clientId: '6N3KA',
                        accounts: [
                            {
                                accountId: '6N3KAA2',
                                accountType: 'CASH',
                                primaryCurrency: 'CAD',
                                balances: [
                                    {
                                        accountNumber: '',
                                        currency: 'CAD',
                                    },
                                ],
                            },
                        ],
                    },
                ],
            };

            mockFetch.mock.mockImplementationOnce(() =>
                Promise.resolve({
                    ok: true,
                    json: () => Promise.resolve(mockResponse),
                })
            );

            const accounts = await getAccounts(mockProfile);

            assert.strictEqual(accounts.length, 1);
            assert.strictEqual(accounts[0].accountMask, 'KAA2'); // Uses accountId as fallback
        });

        it('should map RRSP account type correctly', async () => {
            const mockProfile = {
                sessionId: 'test-session',
                profileId: '6N3KA',
                profileName: 'JOHN DOE',
            };

            const mockResponse = {
                clients: [
                    {
                        clientId: '6N3KA',
                        accounts: [
                            {
                                accountId: '6N3KAC1',
                                accountType: 'RRSP',
                                primaryCurrency: 'CAD',
                                balances: [{ accountNumber: '6N3KAC1' }],
                            },
                        ],
                    },
                ],
            };

            mockFetch.mock.mockImplementationOnce(() =>
                Promise.resolve({
                    ok: true,
                    json: () => Promise.resolve(mockResponse),
                })
            );

            const accounts = await getAccounts(mockProfile);

            assert.strictEqual(accounts[0].accountType, 'Investment');
        });

        it('should throw error when no accounts are found', async () => {
            const mockProfile = {
                sessionId: 'test-session',
                profileId: '6N3KA',
                profileName: 'JOHN DOE',
            };

            mockFetch.mock.mockImplementationOnce(() =>
                Promise.resolve({
                    ok: true,
                    json: () => Promise.resolve({ clients: [] }),
                })
            );

            await assert.rejects(
                getAccounts(mockProfile),
                /No accounts found in portfolio response/
            );
        });

        it('should throw error when portfolio API returns invalid response', async () => {
            const mockProfile = {
                sessionId: 'test-session',
                profileId: '6N3KA',
                profileName: 'JOHN DOE',
            };

            mockFetch.mock.mockImplementationOnce(() =>
                Promise.resolve({
                    ok: true,
                    json: () => Promise.resolve({}),
                })
            );

            await assert.rejects(
                getAccounts(mockProfile),
                /Invalid response format from portfolio API/
            );
        });
    });

    describe('getStatements', () => {
        it('should retrieve account statements with tokens', async () => {
            const mockAccount = {
                profile: {
                    sessionId: 'test-session',
                    profileId: '6N3KA',
                    profileName: 'JOHN DOE',
                },
                accountId: '6N3KAA2',
                accountName: 'CASH CAD',
                accountMask: 'JZA2',
                accountType: 'Investment',
            };

            const mockResponse = [
                {
                    date: '2025-10-31',
                    descriptions: ['DOE JOHN'],
                    id: '211952809',
                    token: '578g5c4e-bg1d-5658-cd85-6035450d14e0',
                    type: 'ETATCOMPTE',
                    clientId: '6N3KA',
                    accountId: '',
                    version: 'ORIGINAL',
                },
                {
                    date: '2025-09-30',
                    descriptions: ['DOE JOHN'],
                    id: '211229050',
                    token: '9f56e7e3-434b-56e2-9539-10g451108f36',
                    type: 'ETATCOMPTE',
                    clientId: '6N3KA',
                    accountId: '',
                    version: 'ORIGINAL',
                },
                {
                    date: '2025-08-31',
                    descriptions: ['DOE JOHN'],
                    id: '100330026',
                    token: 'd8g9f0e2-345b-56c7-90de-1fg234567890',
                    type: 'ETATCOMPTE',
                    clientId: '6N3KA',
                    accountId: '',
                    version: 'ORIGINAL',
                },
            ];

            mockFetch.mock.mockImplementationOnce(() =>
                Promise.resolve({
                    ok: true,
                    json: () => Promise.resolve(mockResponse),
                })
            );

            const statements = await getStatements(mockAccount);

            assert.strictEqual(statements.length, 3);

            // Verify statement structure - statementDate is now ISO string
            assert.strictEqual(statements[0].statementId, '578g5c4e-bg1d-5658-cd85-6035450d14e0');
            assert.strictEqual(statements[0].statementDate, '2025-10-31T00:00:00.000Z');
            assert.strictEqual(statements[0].account, mockAccount);

            assert.strictEqual(statements[1].statementId, '9f56e7e3-434b-56e2-9539-10g451108f36');
            assert.strictEqual(statements[1].statementDate, '2025-09-30T00:00:00.000Z');

            // Verify API call
            const calls = mockFetch.mock.calls;
            assert.strictEqual(calls.length, 1);
            const [url] = calls[0].arguments;
            assert.match(url, /\/s9web\/secure\/web-api\/v2\/documents\/info\/clients/);
            assert.match(url, /clientCodes=6N3KA/);
            assert.match(url, /documentTypes=ETATCOMPTE/);
        });

        it('should filter out non-ETATCOMPTE documents', async () => {
            const mockAccount = {
                profile: {
                    sessionId: 'test-session',
                    profileId: '6N3KA',
                    profileName: 'JOHN DOE',
                },
                accountId: '6N3KAA2',
                accountName: 'CASH CAD',
                accountMask: 'JZA2',
                accountType: 'Investment',
            };

            const mockResponse = [
                {
                    date: '2025-10-31',
                    id: '211952809',
                    token: '578g5c4e-bg1d-5658-cd85-6035450d14e0',
                    type: 'ETATCOMPTE',
                    clientId: '6N3KA',
                },
                {
                    date: '2025-10-31',
                    id: '211952810',
                    token: 'bcd23456-7890-1bcd-efg1-234567890bcd',
                    type: 'RAP_PERF',
                    clientId: '6N3KA',
                },
            ];

            mockFetch.mock.mockImplementationOnce(() =>
                Promise.resolve({
                    ok: true,
                    json: () => Promise.resolve(mockResponse),
                })
            );

            const statements = await getStatements(mockAccount);

            assert.strictEqual(statements.length, 1);
            assert.strictEqual(statements[0].statementId, '578g5c4e-bg1d-5658-cd85-6035450d14e0');
        });

        it('should skip documents with missing tokens', async () => {
            const mockAccount = {
                profile: {
                    sessionId: 'test-session',
                    profileId: '6N3KA',
                    profileName: 'JOHN DOE',
                },
                accountId: '6N3KAA2',
                accountName: 'CASH CAD',
                accountMask: 'JZA2',
                accountType: 'Investment',
            };

            const mockResponse = [
                {
                    date: '2025-10-31',
                    id: '211952809',
                    token: '578g5c4e-bg1d-5658-cd85-6035450d14e0',
                    type: 'ETATCOMPTE',
                    clientId: '6N3KA',
                },
                {
                    date: '2025-09-30',
                    id: '211229050',
                    token: null,
                    type: 'ETATCOMPTE',
                    clientId: '6N3KA',
                },
            ];

            mockFetch.mock.mockImplementationOnce(() =>
                Promise.resolve({
                    ok: true,
                    json: () => Promise.resolve(mockResponse),
                })
            );

            const statements = await getStatements(mockAccount);

            assert.strictEqual(statements.length, 1);
            assert.strictEqual(statements[0].statementId, '578g5c4e-bg1d-5658-cd85-6035450d14e0');
        });

        it('should skip documents with invalid dates', async () => {
            const mockAccount = {
                profile: {
                    sessionId: 'test-session',
                    profileId: '6N3KA',
                    profileName: 'JOHN DOE',
                },
                accountId: '6N3KAA2',
                accountName: 'CASH CAD',
                accountMask: 'JZA2',
                accountType: 'Investment',
            };

            const mockResponse = [
                {
                    date: '2025-10-31',
                    id: '211952809',
                    token: '578g5c4e-bg1d-5658-cd85-6035450d14e0',
                    type: 'ETATCOMPTE',
                    clientId: '6N3KA',
                },
                {
                    date: 'invalid-date',
                    id: '211229050',
                    token: '9f56e7e3-434b-56e2-9539-10g451108f36',
                    type: 'ETATCOMPTE',
                    clientId: '6N3KA',
                },
            ];

            mockFetch.mock.mockImplementationOnce(() =>
                Promise.resolve({
                    ok: true,
                    json: () => Promise.resolve(mockResponse),
                })
            );

            const statements = await getStatements(mockAccount);

            assert.strictEqual(statements.length, 1);
            assert.strictEqual(statements[0].statementId, '578g5c4e-bg1d-5658-cd85-6035450d14e0');
        });

        it('should throw error when documents API returns invalid response', async () => {
            const mockAccount = {
                profile: {
                    sessionId: 'test-session',
                    profileId: '6N3KA',
                    profileName: 'JOHN DOE',
                },
                accountId: '6N3KAA2',
                accountName: 'CASH CAD',
                accountMask: 'JZA2',
                accountType: 'Investment',
            };

            mockFetch.mock.mockImplementationOnce(() =>
                Promise.resolve({
                    ok: true,
                    json: () => Promise.resolve({ error: 'Invalid' }),
                })
            );

            await assert.rejects(
                getStatements(mockAccount),
                /Invalid response format from documents API/
            );
        });
    });

    describe('downloadStatement', () => {
        it('should download PDF using statement token', async () => {
            const mockStatement = {
                account: {
                    profile: {
                        sessionId: 'test-session',
                        profileId: '6N3KA',
                        profileName: 'JOHN DOE',
                    },
                    accountId: '6N3KAA2',
                    accountName: 'CASH CAD',
                    accountMask: 'JZA2',
                    accountType: 'Investment',
                },
                statementId: '578g5c4e-bg1d-5658-cd85-6035450d14e0',
                statementDate: new Date('2025-10-31'),
            };

            const mockPdfBlob = new Blob(['PDF content'], { type: 'application/pdf' });

            mockFetch.mock.mockImplementationOnce(() =>
                Promise.resolve({
                    ok: true,
                    headers: {
                        get: (name) => (name === 'content-type' ? 'application/pdf;charset=UTF-8' : null),
                    },
                    blob: () => Promise.resolve(mockPdfBlob),
                })
            );

            const blob = await downloadStatement(mockStatement);

            assert.strictEqual(blob.size, mockPdfBlob.size);
            assert.strictEqual(blob.type, 'application/pdf');

            const calls = mockFetch.mock.calls;
            assert.strictEqual(calls.length, 1);
            const [url] = calls[0].arguments;
            assert.match(url, /\/s9web\/secure\/web-api\/v2\/documents\?token=578g5c4e-bg1d-5658-cd85-6035450d14e0/);
        });

        it('should throw error when token is missing', async () => {
            const mockStatement = {
                account: {
                    profile: {
                        sessionId: 'test-session',
                        profileId: '6N3KA',
                        profileName: 'JOHN DOE',
                    },
                    accountId: '6N3KAA2',
                    accountName: 'CASH CAD',
                    accountMask: 'JZA2',
                    accountType: 'Investment',
                },
                statementId: '',
                statementDate: new Date('2025-10-31'),
            };

            await assert.rejects(
                downloadStatement(mockStatement),
                /Download token not found/
            );
        });

        it('should throw error when response is not PDF', async () => {
            const mockStatement = {
                account: {
                    profile: {
                        sessionId: 'test-session',
                        profileId: '6N3KA',
                        profileName: 'JOHN DOE',
                    },
                    accountId: '6N3KAA2',
                    accountName: 'CASH CAD',
                    accountMask: 'JZA2',
                    accountType: 'Investment',
                },
                statementId: '578g5c4e-bg1d-5658-cd85-6035450d14e0',
                statementDate: new Date('2025-10-31'),
            };

            mockFetch.mock.mockImplementationOnce(() =>
                Promise.resolve({
                    ok: true,
                    headers: {
                        get: (name) => (name === 'content-type' ? 'text/html' : null),
                    },
                    blob: () => Promise.resolve(new Blob(['<html>'])),
                })
            );

            await assert.rejects(
                downloadStatement(mockStatement),
                /Expected PDF but received text\/html/
            );
        });

        it('should throw error when blob is empty', async () => {
            const mockStatement = {
                account: {
                    profile: {
                        sessionId: 'test-session',
                        profileId: '6N3KA',
                        profileName: 'JOHN DOE',
                    },
                    accountId: '6N3KAA2',
                    accountName: 'CASH CAD',
                    accountMask: 'JZA2',
                    accountType: 'Investment',
                },
                statementId: '578g5c4e-bg1d-5658-cd85-6035450d14e0',
                statementDate: new Date('2025-10-31'),
            };

            const emptyBlob = new Blob([], { type: 'application/pdf' });

            mockFetch.mock.mockImplementationOnce(() =>
                Promise.resolve({
                    ok: true,
                    headers: {
                        get: (name) => (name === 'content-type' ? 'application/pdf' : null),
                    },
                    blob: () => Promise.resolve(emptyBlob),
                })
            );

            await assert.rejects(
                downloadStatement(mockStatement),
                /Downloaded statement is empty/
            );
        });

        it('should throw error when API request fails', async () => {
            const mockStatement = {
                account: {
                    profile: {
                        sessionId: 'test-session',
                        profileId: '6N3KA',
                        profileName: 'JOHN DOE',
                    },
                    accountId: '6N3KAA2',
                    accountName: 'CASH CAD',
                    accountMask: 'JZA2',
                    accountType: 'Investment',
                },
                statementId: '578g5c4e-bg1d-5658-cd85-6035450d14e0',
                statementDate: new Date('2025-10-31'),
            };

            mockFetch.mock.mockImplementationOnce(() =>
                Promise.resolve({
                    ok: false,
                    status: 400,
                    statusText: 'Bad Request',
                })
            );

            await assert.rejects(
                downloadStatement(mockStatement),
                /Disnat API request failed: 400 Bad Request/
            );
        });
    });
});

