/**
 * Unit tests for Wise bank statement API implementation
 * Tests cover multi-currency account functionality with statement caching
 * 
 * Note: All mock data is based on actual content from analyze/wise_1763902814851.har
 * to ensure tests match real API responses.
 */

import { describe, it, beforeEach, mock } from 'node:test';
import assert from 'node:assert/strict';

// Mock global fetch
const mockFetch = mock.fn();
global.fetch = mockFetch;

// Mock document.cookie for getSessionId
global.document = {
    cookie: 'selected-profile-id-50503398=47742732; appToken=ebe00e8e9f63d3d9bbg0geb899e9bded; other=value',
};

// Mock Intl.DateTimeFormat for timezone
const mockResolvedOptions = mock.fn(() => ({ timeZone: 'America/Los_Angeles' }));
mock.method(Intl.DateTimeFormat.prototype, 'resolvedOptions', mockResolvedOptions);

// Import the module after setting up mocks
const wiseModule = await import('../bank/wise.mjs');
const { bankId, getSessionId, getProfile, getAccounts, getStatements, downloadStatement } = wiseModule;

describe('Wise API', () => {
    beforeEach(() => {
        // Reset fetch mock between tests for isolation
        mockFetch.mock.resetCalls();
    });

    describe('bankId', () => {
        it('should return the correct bank identifier', () => {
            assert.strictEqual(bankId, 'wise');
        });
    });

    describe('getSessionId', () => {
        it('should extract selected-profile-id cookie from document.cookie', () => {
            const sessionId = getSessionId();
            assert.strictEqual(sessionId, 'selected-profile-id-50503398=47742732');
        });

        it('should throw error when selected-profile-id cookie is not found', () => {
            const originalCookie = document.cookie;
            document.cookie = 'appToken=test; other=value';

            assert.throws(() => getSessionId(), /selected-profile-id cookie not found/);

            document.cookie = originalCookie;
        });
    });

    describe('getProfile', () => {
        it('should extract profile information from home page __NEXT_DATA__', async () => {
            const mockHtml = `<!DOCTYPE html><html><body><script id="__NEXT_DATA__" type="application/json">{"props":{"pageProps":{"session":{"userId":50503398},"selectedProfile":{"id":47742732,"type":"PERSONAL","fullName":"John Doe"}}}}</script></body></html>`;

            mockFetch.mock.mockImplementationOnce(() =>
                Promise.resolve({
                    ok: true,
                    text: () => Promise.resolve(mockHtml),
                })
            );

            const profile = await getProfile('selected-profile-id-50503398=47742732');

            assert.deepStrictEqual(profile, {
                sessionId: 'selected-profile-id-50503398=47742732',
                profileId: '47742732',
                profileName: 'John Doe',
            });

            const calls = mockFetch.mock.calls;
            assert.strictEqual(calls.length, 1);
            assert.strictEqual(calls[0].arguments[0], 'https://wise.com/home');
        });

        it('should throw error when __NEXT_DATA__ is not found', async () => {
            mockFetch.mock.mockImplementationOnce(() =>
                Promise.resolve({
                    ok: true,
                    text: () => Promise.resolve('<html><body>No script tag</body></html>'),
                })
            );

            await assert.rejects(
                getProfile('test-session'),
                /Could not find __NEXT_DATA__ in home page/
            );
        });

        it('should throw error when pageProps is missing', async () => {
            const mockHtml = `
                <script id="__NEXT_DATA__" type="application/json">{"props":{}}</script>
            `;

            mockFetch.mock.mockImplementationOnce(() =>
                Promise.resolve({
                    ok: true,
                    text: () => Promise.resolve(mockHtml),
                })
            );

            await assert.rejects(
                getProfile('test-session'),
                /Invalid __NEXT_DATA__ structure: missing pageProps/
            );
        });

        it('should throw error when userId is missing', async () => {
            const mockHtml = `<!DOCTYPE html><html><body><script id="__NEXT_DATA__" type="application/json">{"props":{"pageProps":{"session":{},"selectedProfile":{"id":123}}}}</script></body></html>`;

            mockFetch.mock.mockImplementationOnce(() =>
                Promise.resolve({
                    ok: true,
                    text: () => Promise.resolve(mockHtml),
                })
            );

            await assert.rejects(
                getProfile('test-session'),
                /Could not extract userId from home page/
            );
        });

        it('should throw error when profileId is missing', async () => {
            const mockHtml = `<!DOCTYPE html><html><body><script id="__NEXT_DATA__" type="application/json">{"props":{"pageProps":{"session":{"userId":123},"selectedProfile":{}}}}</script></body></html>`;

            mockFetch.mock.mockImplementationOnce(() =>
                Promise.resolve({
                    ok: true,
                    text: () => Promise.resolve(mockHtml),
                })
            );

            await assert.rejects(
                getProfile('test-session'),
                /Could not extract profileId from home page/
            );
        });
    });

    describe('getAccounts', () => {
        const mockProfile = {
            sessionId: 'selected-profile-id-50503398=47742732',
            profileId: '47742732',
            profileName: 'John Doe',
        };

        it('should extract all balance accounts from launchpad data', async () => {
            const mockHtml = `<!DOCTYPE html><html><body><script id="__NEXT_DATA__" type="application/json">{"props":{"pageProps":{"launchpadData":{"components":[{"id":"section1","components":[{"trackingName":"Section - Balances","components":[{"title":"USD","label":{"text":"·· 62330"},"urn":"urn:wise:balances:61274539","type":"BALANCE"},{"title":"CAD","label":{"text":"·· 10970"},"urn":"urn:wise:balances:61275726","type":"BALANCE"},{"title":"CNY","label":{"text":"·· 700 52"},"urn":"urn:wise:balances:61275774","type":"BALANCE"},{"title":"Add currency","type":"ADD_BALANCE"}]}]}]}}}}</script></body></html>`;

            mockFetch.mock.mockImplementationOnce(() =>
                Promise.resolve({
                    ok: true,
                    text: () => Promise.resolve(mockHtml),
                })
            );

            const accounts = await getAccounts(mockProfile);

            assert.strictEqual(accounts.length, 3);

            // USD account
            assert.strictEqual(accounts[0].accountId, '61274539');
            assert.strictEqual(accounts[0].accountName, 'USD');
            assert.strictEqual(accounts[0].accountMask, '62330');
            assert.strictEqual(accounts[0].accountType, 'Checking');

            // CAD account
            assert.strictEqual(accounts[1].accountId, '61275726');
            assert.strictEqual(accounts[1].accountName, 'CAD');
            assert.strictEqual(accounts[1].accountMask, '10970');

            // CNY account (with space removed)
            assert.strictEqual(accounts[2].accountId, '61275774');
            assert.strictEqual(accounts[2].accountName, 'CNY');
            assert.strictEqual(accounts[2].accountMask, '70052'); // Space and dots removed
        });

        it('should use balance ID when account mask is missing', async () => {
            const mockHtml = `<!DOCTYPE html><html><body><script id="__NEXT_DATA__" type="application/json">{"props":{"pageProps":{"launchpadData":{"components":[{"components":[{"trackingName":"Section - Balances","components":[{"title":"EUR","urn":"urn:wise:balances:23456789","type":"BALANCE"}]}]}]}}}}</script></body></html>`;

            mockFetch.mock.mockImplementationOnce(() =>
                Promise.resolve({
                    ok: true,
                    text: () => Promise.resolve(mockHtml),
                })
            );

            const accounts = await getAccounts(mockProfile);

            assert.strictEqual(accounts.length, 1);
            assert.strictEqual(accounts[0].accountMask, '6789'); // Last 4 digits of balance ID
        });

        it('should throw error when launchpad data is missing', async () => {
            const mockHtml = `<!DOCTYPE html><html><body><script id="__NEXT_DATA__" type="application/json">{"props":{"pageProps":{}}}</script></body></html>`;

            mockFetch.mock.mockImplementationOnce(() =>
                Promise.resolve({
                    ok: true,
                    text: () => Promise.resolve(mockHtml),
                })
            );

            await assert.rejects(
                getAccounts(mockProfile),
                /Invalid __NEXT_DATA__ structure: missing launchpadData/
            );
        });

        it('should throw error when no accounts are found', async () => {
            const mockHtml = `<!DOCTYPE html><html><body><script id="__NEXT_DATA__" type="application/json">{"props":{"pageProps":{"launchpadData":{"components":[]}}}}</script></body></html>`;

            mockFetch.mock.mockImplementationOnce(() =>
                Promise.resolve({
                    ok: true,
                    text: () => Promise.resolve(mockHtml),
                })
            );

            await assert.rejects(
                getAccounts(mockProfile),
                /No accounts found in launchpad data/
            );
        });
    });

    describe('getStatements', () => {
        const mockAccount = {
            profile: {
                sessionId: 'selected-profile-id-50503398=47742732',
                profileId: '47742732',
                profileName: 'John Doe',
            },
            accountId: '61274539',
            accountName: 'USD',
            accountMask: '62330',
            accountType: 'Checking',
        };

        it('should generate 12 monthly statements for the last 12 months', async () => {
            const statements = await getStatements(mockAccount);

            assert.strictEqual(statements.length, 12);

            // Verify statements are monthly and skip current month
            const now = new Date();
            const firstStatement = statements[0];
            const lastStatement = statements[11];

            // First statement should be from last month (1 month ago)
            const firstStatementMonth = new Date(firstStatement.statementDate).getMonth();
            const expectedFirstMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1).getMonth();
            assert.strictEqual(firstStatementMonth, expectedFirstMonth);

            // Last statement should be from 12 months ago
            const lastStatementMonth = new Date(lastStatement.statementDate).getMonth();
            const expectedLastMonth = new Date(now.getFullYear(), now.getMonth() - 12, 1).getMonth();
            assert.strictEqual(lastStatementMonth, expectedLastMonth);
        });

        it('should format statement IDs as date ranges', async () => {
            const statements = await getStatements(mockAccount);

            // Each statement ID should be in format: YYYY-MM-DD,YYYY-MM-DD
            for (const statement of statements) {
                assert.match(statement.statementId, /^\d{4}-\d{2}-\d{2},\d{4}-\d{2}-\d{2}$/);

                // Verify date range covers a full month
                const [fromDate, toDate] = statement.statementId.split(',');
                const from = new Date(fromDate + 'T00:00:00'); // Force to local timezone
                const to = new Date(toDate + 'T00:00:00');

                // From date should be the 1st of the month
                assert.strictEqual(from.getDate(), 1);

                // To date should be the last day of the same month
                assert.strictEqual(from.getMonth(), to.getMonth()); // Same month
                assert.strictEqual(from.getFullYear(), to.getFullYear()); // Same year
                const lastDayOfMonth = new Date(from.getFullYear(), from.getMonth() + 1, 0).getDate();
                assert.strictEqual(to.getDate(), lastDayOfMonth);
            }
        });

        it('should attach account reference to each statement', async () => {
            const statements = await getStatements(mockAccount);

            for (const statement of statements) {
                assert.strictEqual(statement.account, mockAccount);
            }
        });
    });

    describe('downloadStatement', () => {
        // Use fixed October 2025 dates for testing (predictable future date)
        const mockStatement = {
            account: {
                profile: {
                    sessionId: 'selected-profile-id-50503398=47742732',
                    profileId: '47842732',
                    profileName: 'John Doe',
                },
                accountId: '61274539',
                accountName: 'USD',
                accountMask: '62330',
                accountType: 'Checking',
            },
            statementId: '2025-10-01,2025-10-31',
            statementDate: new Date('2025-10-01').toISOString(),
        };

        it('should reuse cached statement if available', async () => {
            // Mock refresh API response with cached statement matching October 2025
            const mockRefreshResponse = {
                layout: [
                    {
                        type: 'list',
                        control: 'statements-list-item-with-action',
                        items: [
                            {
                                title: 'October 1, 2025 - October 31, 2025',
                                tags: [
                                    '',
                                    '{"url":"/v1/profiles/47842732/statement-requests/bcd23456-2345-2345-2345-2345678901bc/statement-file"}',
                                ],
                            },
                        ],
                    },
                ],
            };

            // Mock PDF blob
            const mockPdfBlob = new Blob(['PDF content'], { type: 'application/pdf' });

            mockFetch.mock.mockImplementation((url) => {
                if (url.includes('action=refresh')) {
                    return Promise.resolve({
                        ok: true,
                        json: () => Promise.resolve(mockRefreshResponse),
                    });
                } else if (url.includes('statement-file')) {
                    return Promise.resolve({
                        ok: true,
                        headers: { get: () => 'application/pdf' },
                        blob: () => Promise.resolve(mockPdfBlob),
                    });
                }
                // Should not reach here for cached statement test
                return Promise.reject(new Error('Unexpected URL: ' + url));
            });

            const blob = await downloadStatement(mockStatement);

            assert.strictEqual(blob.size, 11); // 'PDF content'.length
            assert.strictEqual(blob.type, 'application/pdf');

            // Should have called refresh API and download API, but NOT create or poll APIs
            const calls = mockFetch.mock.calls;
            assert.strictEqual(calls.length, 2);
            assert.ok(calls[0].arguments[0].includes('action=refresh'));
            assert.ok(calls[1].arguments[0].includes('bcd23456-2345-2345-2345-2345678901bc'));
            assert.ok(calls[1].arguments[0].includes('statement-file'));
        });

        it('should create new statement if not cached', async () => {
            // Mock refresh API response with no cached statements
            const mockRefreshResponse = {
                layout: [
                    {
                        type: 'list',
                        control: 'statements-list-item-with-action',
                        items: [],
                    },
                ],
            };

            // Mock create statement response - note the action URL format
            const mockCreateResponse = {
                action: {
                    url: 'https://wise.com/hold/v1/profiles/47842732/statements-and-reports/balance-statement/bcd23456-bcde-2345-bcde-2345678901fa',
                },
            };

            // Mock poll response (ready immediately)
            const mockPollResponse = {
                layout: [
                    {
                        components: [
                            {
                                control: 'statements-download-action-button',
                                content: 'Download',
                            },
                        ],
                    },
                ],
            };

            // Mock PDF blob
            const mockPdfBlob = new Blob(['PDF content'], { type: 'application/pdf' });

            let callCount = 0;
            mockFetch.mock.mockImplementation((url) => {
                callCount++;
                if (url.includes('action=refresh')) {
                    return Promise.resolve({
                        ok: true,
                        json: () => Promise.resolve(mockRefreshResponse),
                    });
                } else if (url.includes('action=request')) {
                    return Promise.resolve({
                        ok: true,
                        json: () => Promise.resolve(mockCreateResponse),
                    });
                } else if (url.includes('bcd23456-bcde-2345-bcde-2345678901fa') && !url.includes('statement-file')) {
                    return Promise.resolve({
                        ok: true,
                        json: () => Promise.resolve(mockPollResponse),
                    });
                } else if (url.includes('statement-file')) {
                    return Promise.resolve({
                        ok: true,
                        headers: { get: () => 'application/pdf' },
                        blob: () => Promise.resolve(mockPdfBlob),
                    });
                }
                return Promise.reject(new Error('Unexpected URL: ' + url));
            });

            const blob = await downloadStatement(mockStatement);

            assert.strictEqual(blob.size, 11);
            assert.strictEqual(blob.type, 'application/pdf');

            // Should have called: refresh, create, poll (with 1s delay), download
            const calls = mockFetch.mock.calls;
            assert.ok(calls.length >= 4); // At least refresh, create, poll, download
            assert.ok(calls[0].arguments[0].includes('action=refresh'));
            assert.ok(calls[1].arguments[0].includes('action=request'));
        });

        it('should include required headers in all API calls', async () => {
            // Mock minimal successful flow
            const mockRefreshResponse = { layout: [] };
            const mockCreateResponse = {
                action: {
                    url: 'https://wise.com/hold/v1/profiles/47842732/statements-and-reports/balance-statement/def23456-cdef-3456-cdef-345678912bcd',
                },
            };
            const mockPollResponse = {
                layout: [
                    {
                        components: [
                            { control: 'statements-download-action-button' },
                        ],
                    },
                ],
            };
            const mockPdfBlob = new Blob(['PDF'], { type: 'application/pdf' });

            mockFetch.mock.mockImplementation((url, options) => {
                // Verify all requests include required headers
                assert.ok(options.headers['x-access-token'] === 'Tr4n5f3rw153');
                assert.ok(options.credentials === 'include');

                if (url.includes('action=refresh')) {
                    return Promise.resolve({ ok: true, json: () => Promise.resolve(mockRefreshResponse) });
                } else if (url.includes('action=request')) {
                    return Promise.resolve({ ok: true, json: () => Promise.resolve(mockCreateResponse) });
                } else if (url.includes('def23456-cdef-3456-cdef-345678912bcd') && !url.includes('statement-file')) {
                    return Promise.resolve({ ok: true, json: () => Promise.resolve(mockPollResponse) });
                } else if (url.includes('statement-file')) {
                    return Promise.resolve({ ok: true, headers: { get: () => 'application/pdf' }, blob: () => Promise.resolve(mockPdfBlob) });
                }
                return Promise.reject(new Error('Unexpected URL: ' + url));
            });

            await downloadStatement(mockStatement);

            // All calls should have passed header validation
            assert.ok(mockFetch.mock.calls.length >= 4);
        });

        it('should throw error when refresh API fails', async () => {
            mockFetch.mock.mockImplementationOnce(() =>
                Promise.resolve({
                    ok: false,
                    status: 401,
                    statusText: 'Unauthorized',
                })
            );

            await assert.rejects(
                downloadStatement(mockStatement),
                /Failed to check existing statements: 401 Unauthorized/
            );
        });

        it('should throw error when create statement fails', async () => {
            const mockRefreshResponse = { layout: [] };

            mockFetch.mock.mockImplementation((url) => {
                if (url.includes('action=refresh')) {
                    return Promise.resolve({
                        ok: true,
                        json: () => Promise.resolve(mockRefreshResponse),
                    });
                } else if (url.includes('action=request')) {
                    return Promise.resolve({
                        ok: false,
                        status: 500,
                        statusText: 'Internal Server Error',
                    });
                }
            });

            await assert.rejects(
                downloadStatement(mockStatement),
                /Failed to create statement request: 500 Internal Server Error/
            );
        });

        it('should throw error when download fails', async () => {
            const mockRefreshResponse = {
                layout: [
                    {
                        type: 'list',
                        control: 'statements-list-item-with-action',
                        items: [
                            {
                                title: 'October 1, 2025 - October 31, 2025',
                                tags: ['', '{"url":"/v1/profiles/47842732/statement-requests/def67890-5678-5678-5678-567890abcdef/statement-file"}'],
                            },
                        ],
                    },
                ],
            };

            mockFetch.mock.mockImplementation((url) => {
                if (url.includes('action=refresh')) {
                    return Promise.resolve({
                        ok: true,
                        json: () => Promise.resolve(mockRefreshResponse),
                    });
                } else if (url.includes('statement-file')) {
                    return Promise.resolve({
                        ok: false,
                        status: 404,
                        statusText: 'Not Found',
                    });
                }
                // Should not try to create new statement when cached one exists
                return Promise.reject(new Error('Unexpected URL: ' + url));
            });

            await assert.rejects(
                downloadStatement(mockStatement),
                /Failed to download PDF: 404 Not Found/
            );
        });

        it('should throw error when PDF is empty', async () => {
            const mockRefreshResponse = {
                layout: [
                    {
                        type: 'list',
                        control: 'statements-list-item-with-action',
                        items: [
                            {
                                title: 'October 1, 2025 - October 31, 2025',
                                tags: ['', '{"url":"/v1/profiles/47842732/statement-requests/bcd22222-2222-2222-2222-222222222222/statement-file"}'],
                            },
                        ],
                    },
                ],
            };

            const emptyBlob = new Blob([], { type: 'application/pdf' });

            mockFetch.mock.mockImplementation((url) => {
                if (url.includes('action=refresh')) {
                    return Promise.resolve({
                        ok: true,
                        json: () => Promise.resolve(mockRefreshResponse),
                    });
                } else if (url.includes('statement-file')) {
                    return Promise.resolve({
                        ok: true,
                        headers: { get: () => 'application/pdf' },
                        blob: () => Promise.resolve(emptyBlob),
                    });
                }
                // Should not try to create new statement when cached one exists
                return Promise.reject(new Error('Unexpected URL: ' + url));
            });

            await assert.rejects(
                downloadStatement(mockStatement),
                /Downloaded PDF is empty/
            );
        });
    });
});
