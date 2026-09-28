/**
 * Unit tests for Chase bank statement API implementation
 * Tests cover credit card and loan account functionality
 * 
 * Fixtures use synthetic values with the documented response shapes.
 */

import { describe, it, beforeEach, mock } from 'node:test';
import assert from 'node:assert/strict';

// Mock global fetch
const mockFetch = mock.fn();
global.fetch = mockFetch;

// Mock crypto using mock.method
const mockRandomUUID = mock.fn(() => '00000000-0000-4000-8000-000000000001');
mock.method(global.crypto, 'randomUUID', mockRandomUUID);

// Mock document.cookie for getSessionId
global.document = {
    cookie: 'v1st=synthetic-session; other=value; JSESSIONID=test',
};

// Import the module after setting up mocks
const chaseModule = await import('../bank/chase.mjs');
const { bankId, bankName, getSessionId, getProfile, getAccounts, getStatements, downloadStatement } = chaseModule;

describe('Chase API', () => {
    beforeEach(() => {
        // Reset fetch mock between tests for isolation
        mockFetch.mock.resetCalls();
    });

    describe('bankId', () => {
        it('should return the correct bank identifier', () => {
            assert.strictEqual(bankId, 'chase');
        });
    });

    describe('bankName', () => {
        it('should return the correct bank name', () => {
            assert.strictEqual(bankName, 'Chase');
        });
    });

    describe('getSessionId', () => {
        it('should extract v1st cookie from document.cookie', () => {
            const sessionId = getSessionId();
            assert.strictEqual(sessionId, 'synthetic-session');
        });

        it('should throw error when v1st cookie is not found', () => {
            const originalCookie = document.cookie;
            document.cookie = 'other=value';

            assert.throws(() => getSessionId(), /v1st cookie not found/);

            document.cookie = originalCookie;
        });
    });

    describe('getProfile', () => {
        it('should extract profile information from app/data/list API', async () => {
            const mockResponse = {
                code: 'SUCCESS',
                personId: 4001,
                profileId: 5001,
                cache: [
                    {
                        url: '/svc/rl/accounts/secure/v1/deck/greeting/list',
                        usage: 'SESSION',
                        response: {
                            greetingId: 'TIME_OF_DAY',
                            greetingName: 'TEST',
                        },
                    },
                    {
                        url: '/svc/rl/accounts/secure/v1/user/metadata/list',
                        usage: 'SESSION',
                        response: {
                            code: 'SUCCESS',
                            personId: 4001,
                            profileId: 5001,
                        },
                    },
                ],
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
                profileId: '5001',
                profileName: 'Test',
            });

            const calls = mockFetch.mock.calls;
            assert.strictEqual(calls.length, 1);
            assert.strictEqual(calls[0].arguments[0], 'https://secure.chase.com/svc/rl/accounts/l4/v1/app/data/list');
            assert.strictEqual(calls[0].arguments[1].method, 'POST');
            assert.strictEqual(calls[0].arguments[1].body, '');
            assert.strictEqual(calls[0].arguments[1].credentials, 'include');
            assert.strictEqual(calls[0].arguments[1].headers['x-jpmc-channel'], 'id=C30');
            assert.strictEqual(calls[0].arguments[1].headers['x-jpmc-csrf-token'], 'NONE');
        });

        it('should convert greeting name from uppercase to title case', async () => {
            const mockResponse = {
                code: 'SUCCESS',
                profileId: 5001,
                greetingName: 'TEST',
            };
            mockFetch.mock.mockImplementationOnce(() => Promise.resolve({ ok: true, json: () => Promise.resolve(mockResponse) }));
            const profile = await getProfile('test-session-id');
            assert.strictEqual(profile.profileName, 'Test');
            assert.notStrictEqual(profile.profileName, 'TEST');
            assert.notStrictEqual(profile.profileName, 'test');
        });

        it('should include correct profile fields', async () => {
            const mockResponse = {
                code: 'SUCCESS',
                personId: 4002,
                greetingName: 'EXAMPLE',
            };
            mockFetch.mock.mockImplementationOnce(() => Promise.resolve({ ok: true, json: () => Promise.resolve(mockResponse) }));
            const profile = await getProfile('another-session-id');
            assert.strictEqual(profile.sessionId, 'another-session-id');
            assert.strictEqual(profile.profileId, '4002');
            assert.strictEqual(profile.profileName, 'Example');
        });

        it('rejects failed cached profile services when their fields are needed', async () => {
            for (const [url, direct] of [
                ['/svc/rl/accounts/secure/v1/deck/greeting/list', { profileId: 5001 }],
                ['/svc/rl/accounts/secure/v1/user/metadata/list', { greetingName: 'TEST' }],
            ]) {
                mockFetch.mock.mockImplementation(async () => ({
                    ok: true,
                    json: async () => ({
                        code: 'SUCCESS',
                        ...direct,
                        cache: [{ url, response: { code: 'SESSION_EXPIRED' } }],
                    }),
                }));
                await assert.rejects(getProfile('test-session'), /profile API.*unsuccessful/);
            }
        });

        it('ignores unused cached service errors when direct profile fields are available', async () => {
            mockFetch.mock.mockImplementation(async () => ({
                ok: true,
                json: async () => ({
                    code: 'SUCCESS', profileId: 5001, greetingName: 'TEST',
                    cache: [
                        { url: '/svc/rl/accounts/secure/v1/deck/greeting/list', response: { code: 'FAILED' } },
                        { url: '/svc/rl/accounts/secure/v1/user/metadata/list', response: { code: 'FAILED', personId: 4001 } },
                        { url: '/unrelated/service', response: { code: 'FAILED' } },
                    ],
                }),
            }));
            assert.deepEqual(await getProfile('test-session'), {
                sessionId: 'test-session', profileId: '5001', profileName: 'Test',
            });
        });
    });

    describe('getAccounts', () => {
        const mockProfile = {
            sessionId: 'test-session',
            profileId: 'test-profile',
            profileName: 'Test User',
        };

        it('should extract accounts from app/data/list API', async () => {
            const mockResponse = {
                code: 'SUCCESS',
                accountTiles: [
                    { accountId: 'GH4', productGroupCode: 2, nickname: 'Synthetic Card', mask: '1234' },
                    { accountId: 'MR7', productGroupCode: 3, nickname: 'Synthetic Auto Loan', mask: '5678' },
                ],
            };
            mockFetch.mock.mockImplementationOnce(() => Promise.resolve({ ok: true, json: () => Promise.resolve(mockResponse) }));
            const accounts = await getAccounts(mockProfile);
            assert.strictEqual(accounts.length, 2);
            assert.strictEqual(accounts[0].accountId, 'GH4');
            assert.strictEqual(accounts[0].accountType, 'CreditCard');
            assert.strictEqual(accounts[1].accountType, 'Loan');
        });

        it('should extract credit card accounts with proper type mapping', async () => {
            const mockResponse = {
                code: 'SUCCESS',
                accountTiles: [
                    { accountId: 'JK8', productGroupCode: 2, nickname: 'Synthetic Card A', mask: '1234' },
                    { accountId: 'PQ5', productGroupCode: 2, nickname: 'Synthetic Card B', mask: '5678' },
                    { accountId: 'XY9', productGroupCode: 3, nickname: 'Synthetic Mortgage', mask: '9012' },
                ],
            };
            mockFetch.mock.mockImplementationOnce(() => Promise.resolve({ ok: true, json: () => Promise.resolve(mockResponse) }));
            const accounts = await getAccounts(mockProfile);
            const creditCards = accounts.filter(acc => acc.accountType === 'CreditCard');
            assert.strictEqual(creditCards.length, 2);
        });

        it('should verify loan account type mapping', async () => {
            const mockResponse = {
                code: 'SUCCESS',
                accountTiles: [
                    { accountId: 'TU62', productGroupCode: 3, nickname: 'Synthetic Auto Loan', mask: '1234' },
                    { accountId: 'VW31', productGroupCode: 2, nickname: 'Synthetic Card', mask: '5678' },
                ],
            };
            mockFetch.mock.mockImplementationOnce(() => Promise.resolve({ ok: true, json: () => Promise.resolve(mockResponse) }));
            const accounts = await getAccounts(mockProfile);
            const loans = accounts.filter(acc => acc.accountType === 'Loan');
            assert.strictEqual(loans.length, 1);
            assert.strictEqual(loans[0].accountId, 'TU62');
        });

        it('maps observed mortgage and auto-loan tile codes without relying on nicknames', async () => {
            mockFetch.mock.mockImplementationOnce(async () => ({
                ok: true,
                json: async () => ({
                    code: 'SUCCESS',
                    cache: [{
                        url: '/svc/rr/accounts/secure/v4/dashboard/tiles/list',
                        response: {
                            accountTiles: [
                                { accountId: 1001, accountTileType: 'MORTGAGE', accountTileDetailType: 'HMG', nickname: 'Home', mask: '1234' },
                                { accountId: 1002, accountTileType: 'AUTOLOAN', accountTileDetailType: 'ALA', nickname: 'Vehicle', mask: '5678' },
                            ],
                        },
                    }],
                }),
            }));
            const accounts = await getAccounts(mockProfile);
            assert.deepEqual(accounts.map(a => a.accountType), ['Loan', 'Loan']);
        });

        it('rejects business failures rather than returning a fallback profile or empty accounts', async () => {
            mockFetch.mock.mockImplementation(async () => ({
                ok: true,
                json: async () => ({ code: 'SESSION_EXPIRED' }),
            }));
            await assert.rejects(getProfile('test-session'), /app data API.*unsuccessful/);
            await assert.rejects(getAccounts(mockProfile), /app data API.*unsuccessful/);
        });

        it('rejects failed or malformed cached dashboard responses', async () => {
            for (const response of [{ code: 'SESSION_EXPIRED' }, { code: 'FAILED', accountTiles: [] }, null, {}]) {
                mockFetch.mock.mockImplementation(async () => ({
                    ok: true,
                    json: async () => ({
                        code: 'SUCCESS',
                        cache: [{ url: '/svc/rr/accounts/secure/v4/dashboard/tiles/list', response }],
                    }),
                }));
                await assert.rejects(getAccounts(mockProfile), /dashboard API|dashboard account list/);
            }
        });

        it('accepts empty dashboard tiles without a code and ignores unrelated cached errors', async () => {
            mockFetch.mock.mockImplementation(async () => ({
                ok: true,
                json: async () => ({
                    code: 'SUCCESS',
                    cache: [
                        { url: '/svc/rr/accounts/secure/v1/menu/list?context=dashboard_main_menu', response: { code: 'FAILED' } },
                        { url: '/svc/rr/accounts/secure/v4/dashboard/tiles/list', response: { accountTiles: [] } },
                    ],
                }),
            }));
            assert.deepEqual(await getAccounts(mockProfile), []);
        });

        it('selects dashboard tiles rather than an unrelated dashboard menu response', async () => {
            mockFetch.mock.mockImplementation(async () => ({
                ok: true,
                json: async () => ({
                    code: 'SUCCESS',
                    cache: [
                        { url: '/svc/rr/accounts/secure/v1/menu/list?context=dashboard_main_menu', response: { code: 'FAILED' } },
                        {
                            url: '/svc/rr/accounts/secure/v4/dashboard/tiles/list',
                            response: {
                                code: 'SUCCESS',
                                accountTiles: [{ accountId: 1001, nickname: 'Synthetic Card', mask: '1234', accountTileType: 'CARD' }],
                            },
                        },
                    ],
                }),
            }));
            assert.equal((await getAccounts(mockProfile))[0]?.accountId, '1001');
        });
    });

    describe('getStatements - Credit Card', () => {
        const mockAccount = {
            profile: { sessionId: 'test', profileId: 'test', profileName: 'Test' },
            accountId: '1001',
            accountName: 'Credit Card A',
            accountMask: '1234',
            accountType: 'CreditCard',
        };

        it('should retrieve credit card statements', async () => {
            const mockResponse = {
                code: 'SUCCESS',
                idaldocRefs: [
                    {
                        documentId: 'synthetic-statement-1',
                        documentDate: '20000331',
                        documentTypeDesc: 'Statement',
                        idaldocType: 'STMT',
                        pageCount: '4',
                    },
                    {
                        documentId: 'synthetic-statement-2',
                        documentDate: '20000229',
                        documentTypeDesc: 'Statement',
                        idaldocType: 'STMT',
                        pageCount: '4',
                    },
                    {
                        documentId: 'synthetic-statement-3',
                        documentDate: '20000131',
                        documentTypeDesc: 'Statement',
                        idaldocType: 'STMT',
                        pageCount: '4',
                    },
                ],
            };

            mockFetch.mock.mockImplementationOnce(() =>
                Promise.resolve({
                    ok: true,
                    json: () => Promise.resolve(mockResponse),
                })
            );

            const statements = await getStatements(mockAccount);

            assert.strictEqual(statements.length, 3);
            assert.strictEqual(statements[0].statementId, 'synthetic-statement-1');
            assert.strictEqual(statements[0].statementDate, '2000-03-31T00:00:00.000Z');
            assert.strictEqual(statements[0].account, mockAccount);

            // Verify statements are sorted by date descending
            assert.ok(new Date(statements[0].statementDate).getTime() > new Date(statements[1].statementDate).getTime());
            assert.ok(new Date(statements[1].statementDate).getTime() > new Date(statements[2].statementDate).getTime());

            // Verify API call
            const calls = mockFetch.mock.calls;
            assert.strictEqual(calls.length, 1);
            assert.strictEqual(
                calls[0].arguments[0],
                'https://secure.chase.com/svc/rr/documents/secure/idal/v2/docref/list'
            );
            assert.strictEqual(calls[0].arguments[1].method, 'POST');
            assert.ok(calls[0].arguments[1].body.includes('accountFilter=' + mockAccount.accountId));
            assert.ok(calls[0].arguments[1].body.includes('dateFilter.idalDateFilterType=CURRENT_YEAR'));
        });

        it('should filter out non-statement documents', async () => {
            const mockResponse = {
                code: 'SUCCESS',
                idaldocRefs: [
                    {
                        documentId: 'stmt-2',
                        documentDate: '20000331',
                        idaldocType: 'STMT',
                    },
                    {
                        documentId: 'notice-3',
                        documentDate: '20000315',
                        idaldocType: 'NOTICE',
                    },
                    {
                        documentId: 'tax-4',
                        documentDate: '20000101',
                        idaldocType: 'TAX',
                    },
                ],
            };

            mockFetch.mock.mockImplementationOnce(() =>
                Promise.resolve({
                    ok: true,
                    json: () => Promise.resolve(mockResponse),
                })
            );

            const statements = await getStatements(mockAccount);

            assert.strictEqual(statements.length, 1);
            assert.strictEqual(statements[0].statementId, 'stmt-2');
        });

        it('should handle empty statement list', async () => {
            const mockResponse = {
                code: 'SUCCESS',
                idaldocRefs: [],
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

        it('should throw error when response format is invalid', async () => {
            mockFetch.mock.mockImplementationOnce(() =>
                Promise.resolve({
                    ok: true,
                    json: () => Promise.resolve(null),
                })
            );

            await assert.rejects(getStatements(mockAccount), /Invalid response format/);
        });

        it('preserves the document calendar date in positive UTC offsets', async () => {
            const previous = process.env.TZ;
            process.env.TZ = 'Asia/Shanghai';
            try {
                mockFetch.mock.mockImplementation(async () => ({
                    ok: true,
                    json: async () => ({
                        code: 'SUCCESS',
                        idaldocRefs: [{ documentId: 'synthetic-statement', documentDate: '20000331', idaldocType: 'STMT' }],
                    }),
                }));
                const statements = await getStatements(mockAccount);
                assert.equal(statements[0].statementDate, '2000-03-31T00:00:00.000Z');
            } finally {
                if (previous === undefined) delete process.env.TZ;
                else process.env.TZ = previous;
            }
        });

        it('rejects business errors and missing document lists rather than reporting no statements', async () => {
            for (const data of [{ code: 'SESSION_EXPIRED' }, { code: 'SUCCESS' }, { idaldocRefs: {} }]) {
                mockFetch.mock.mockImplementation(async () => ({ ok: true, json: async () => data }));
                await assert.rejects(getStatements(mockAccount), /document reference API|document list/);
            }
        });

        it('rejects missing or impossible statement dates instead of inventing a date', async () => {
            for (const date of [undefined, '20000230', 'not-a-date']) {
                mockFetch.mock.mockImplementation(async () => ({
                    ok: true,
                    json: async () => ({
                        code: 'SUCCESS',
                        idaldocRefs: [{ documentId: 'synthetic-statement', documentDate: date, idaldocType: 'STMT' }],
                    }),
                }));
                await assert.rejects(getStatements(mockAccount), /Invalid statement date/);
            }
        });

        it('rejects impossible calendar components in ISO timestamps', async () => {
            for (const date of [
                '2000-02-30T00:00:00.000Z',
                '2001-02-29T12:30:00+08:00',
                '2000-04-31T23:00:00-02:00',
            ]) {
                mockFetch.mock.mockImplementation(async () => ({
                    ok: true,
                    json: async () => ({
                        code: 'SUCCESS',
                        idaldocRefs: [{ documentId: 'synthetic-statement', documentDate: date, idaldocType: 'STMT' }],
                    }),
                }));
                await assert.rejects(getStatements(mockAccount), /Invalid statement date/);
            }
        });

        it('preserves valid calendar dates and ISO timestamps across offset boundaries', async () => {
            for (const [input, expected] of [
                ['20000229', '2000-02-29T00:00:00.000Z'],
                ['2000-02-29', '2000-02-29T00:00:00.000Z'],
                ['2000-02-29T23:45:00-02:00', '2000-03-01T01:45:00.000Z'],
                ['2000-03-01T00:30:00+08:00', '2000-02-29T16:30:00.000Z'],
                ['2000-02-29T12:30:00.123Z', '2000-02-29T12:30:00.123Z'],
            ]) {
                mockFetch.mock.mockImplementation(async () => ({
                    ok: true,
                    json: async () => ({
                        code: 'SUCCESS',
                        idaldocRefs: [{ documentId: 'synthetic-statement', documentDate: input, idaldocType: 'STMT' }],
                    }),
                }));
                const statements = await getStatements(mockAccount);
                assert.equal(statements[0].statementDate, expected);
            }
        });

        it('rejects undocumented locale-dependent date formats', async () => {
            for (const date of ['03/31/2000', 'March 31, 2000', '2000-02-30 00:00:00']) {
                mockFetch.mock.mockImplementation(async () => ({
                    ok: true,
                    json: async () => ({
                        code: 'SUCCESS',
                        idaldocRefs: [{ documentId: 'synthetic-statement', documentDate: date, idaldocType: 'STMT' }],
                    }),
                }));
                await assert.rejects(getStatements(mockAccount), /Invalid statement date/);
            }
        });

        it('rejects malformed rows and unusable IDs without returning partial statement lists', async () => {
            const valid = { idaldocType: 'STMT', documentDate: '20000331', documentId: 'synthetic-statement' };
            for (const row of [
                42, null, [], {},
                { ...valid, documentId: undefined },
                { ...valid, documentId: {} },
                { ...valid, documentId: ' ' },
                { ...valid, documentId: true },
            ]) {
                mockFetch.mock.mockImplementation(async () => ({
                    ok: true,
                    json: async () => ({ code: 'SUCCESS', idaldocRefs: [valid, row] }),
                }));
                await assert.rejects(getStatements(mockAccount), /Invalid document entry|Invalid statement identifier/);
            }
        });

        it('preserves intentional document exclusions and legacy numeric statement IDs', async () => {
            mockFetch.mock.mockImplementation(async () => ({
                ok: true,
                json: async () => ({
                    code: 'SUCCESS',
                    idaldocRefs: [
                        { idaldocType: 'MORTGAGE_YES' },
                        { idaldocType: 'NOTICE' },
                        { idaldocType: 'STMT', accountId: 'different-account' },
                        { idaldocType: 'STMT', documentDate: '20000331', documentId: 1001 },
                    ],
                }),
            }));
            const statements = await getStatements(mockAccount);
            assert.equal(statements.length, 1);
            assert.equal(statements[0].statementId, '1001');
        });
    });

    describe('getStatements - Loan', () => {
        const mockAccount = {
            profile: { sessionId: 'test', profileId: 'test', profileName: 'Test' },
            accountId: '1002',
            accountName: 'Synthetic Mortgage',
            accountMask: '5678',
            accountType: 'Loan',
        };

        it('should retrieve loan statements', async () => {
            const mockResponse = {
                code: 'SUCCESS',
                idaldocRefs: [
                    {
                        documentId: 'synthetic-loan-statement-1',
                        documentDate: '20000302',
                        documentTypeDesc: 'Statement',
                        idaldocType: 'STMT',
                    },
                    {
                        documentId: 'synthetic-loan-statement-2',
                        documentDate: '20000202',
                        documentTypeDesc: 'Statement',
                        idaldocType: 'STMT',
                    },
                    {
                        documentId: 'synthetic-year-end',
                        documentDate: '20000108',
                        documentTypeDesc: 'Year-end mortgage',
                        idaldocType: 'MORTGAGE_YES',
                    },
                ],
            };

            mockFetch.mock.mockImplementationOnce(() =>
                Promise.resolve({
                    ok: true,
                    json: () => Promise.resolve(mockResponse),
                })
            );

            const statements = await getStatements(mockAccount);

            assert.strictEqual(statements.length, 2);
            assert.strictEqual(statements[0].statementId, 'synthetic-loan-statement-1');
            assert.strictEqual(statements[0].statementDate, '2000-03-02T00:00:00.000Z');

            // Verify API call
            const calls = mockFetch.mock.calls;
            assert.ok(calls[0].arguments[1].body.includes('accountFilter=1002'));
        });
    });

    describe('downloadStatement', () => {
        const mockAccount = {
            profile: { sessionId: 'test', profileId: 'test', profileName: 'Test' },
            accountId: '1003',
            accountName: 'Credit Card B',
            accountMask: '9012',
            accountType: 'CreditCard',
        };

        const mockStatement = {
            account: mockAccount,
            statementId: 'synthetic-download-document',
            statementDate: '2000-03-31T00:00:00.000Z',
        };

        it('should download statement PDF', async () => {
            const mockPdfBlob = new Blob(['%PDF-1.7\nsynthetic document'], { type: 'application/pdf' });

            let callCount = 0;
            mockFetch.mock.mockImplementation(() => {
                callCount++;
                if (callCount === 1) {
                    // CSRF token request
                    return Promise.resolve({
                        ok: true,
                        json: () => Promise.resolve({ csrfToken: 'test-csrf-token-123' }),
                    });
                } else if (callCount === 2) {
                    // Document key request
                    return Promise.resolve({
                        ok: true,
                        json: () =>
                            Promise.resolve({
                                docKey: 'synthetic-document-key',
                                docSOR: 'STAR_MS',
                                docURI: '/svc/rr/documents/secure/idal/v5/pdfdoc/star/list',
                            }),
                    });
                } else {
                    // PDF download
                    return Promise.resolve({
                        ok: true,
                        blob: () => Promise.resolve(mockPdfBlob),
                    });
                }
            });

            const blob = await downloadStatement(mockStatement);

            assert.strictEqual(blob, mockPdfBlob);
            assert.ok(blob.size > 0);

            // Verify API calls
            const calls = mockFetch.mock.calls;
            assert.strictEqual(calls.length, 3);

            // Verify CSRF token request
            assert.strictEqual(
                calls[0].arguments[0],
                'https://secure.chase.com/svc/rl/accounts/secure/v1/csrf/token/list'
            );
            assert.strictEqual(calls[0].arguments[1].method, 'POST');

            // Verify document key request
            assert.strictEqual(
                calls[1].arguments[0],
                'https://secure.chase.com/svc/rr/documents/secure/idal/v2/dockey/list'
            );
            assert.ok(calls[1].arguments[1].body.includes('accountFilter=1003'));
            assert.ok(calls[1].arguments[1].body.includes('documentId=synthetic-download-document'));

            // Verify PDF download request
            const downloadUrl = calls[2].arguments[0];
            assert.ok(downloadUrl.startsWith('https://secure.chase.com/svc/rr/documents/secure/idal/v5/pdfdoc/star/list'));
            assert.ok(downloadUrl.includes('docKey=synthetic-document-key'));
            assert.ok(downloadUrl.includes('sor=STAR_MS'));
            assert.ok(downloadUrl.includes('csrftoken=test-csrf-token-123'));
            assert.ok(downloadUrl.includes('download=true'));
            assert.strictEqual(calls[2].arguments[1].method, 'GET');
        });

        it('should throw error when CSRF token is missing', async () => {
            mockFetch.mock.mockImplementationOnce(() =>
                Promise.resolve({
                    ok: true,
                    json: () => Promise.resolve({}),
                })
            );

            await assert.rejects(downloadStatement(mockStatement), /No CSRF token returned/);
        });

        it('should throw error when document key is missing', async () => {
            let callCount = 0;
            mockFetch.mock.mockImplementation(() => {
                callCount++;
                if (callCount === 1) {
                    return Promise.resolve({
                        ok: true,
                        json: () => Promise.resolve({ csrfToken: 'test-csrf-token' }),
                    });
                } else {
                    return Promise.resolve({
                        ok: true,
                        json: () => Promise.resolve({ docSOR: 'STAR_MS' }),
                    });
                }
            });

            await assert.rejects(downloadStatement(mockStatement), /No document key returned/);
        });

        it('should throw error when downloaded PDF is empty', async () => {
            const mockEmptyBlob = new Blob([], { type: 'application/pdf' });

            let callCount = 0;
            mockFetch.mock.mockImplementation(() => {
                callCount++;
                if (callCount === 1) {
                    return Promise.resolve({
                        ok: true,
                        json: () => Promise.resolve({ csrfToken: 'test-csrf-token' }),
                    });
                } else if (callCount === 2) {
                    return Promise.resolve({
                        ok: true,
                        json: () => Promise.resolve({ docKey: 'test-key', docSOR: 'STAR_MS' }),
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

    describe('Error Handling', () => {
        it('rejects non-PDF responses even when the download returns HTTP 200', async () => {
            for (const blob of [
                new Blob(['<html>Sign in</html>'], { type: 'text/html' }),
                new Blob(['{"error":"expired"}'], { type: 'application/pdf' }),
            ]) {
                mockFetch.mock.mockImplementation(async url => {
                    if (url.includes('/csrf/token/')) return { ok: true, json: async () => ({ csrfToken: 'synthetic-csrf' }) };
                    if (url.includes('/dockey/')) return { ok: true, json: async () => ({ code: 'SUCCESS', docKey: 'synthetic-key', docSOR: 'STAR_MS' }) };
                    return { ok: true, blob: async () => blob };
                });
                await assert.rejects(downloadStatement({
                    account: { accountId: '1001' },
                    statementId: 'synthetic-document',
                    statementDate: '2000-03-31T00:00:00.000Z',
                }), /did not return a PDF/);
            }
        });

        it('should throw error when fetch fails', async () => {
            const mockAccount = {
                profile: { sessionId: 'test', profileId: 'test', profileName: 'Test' },
                accountId: '34567',
                accountName: 'Test Account',
                accountMask: '3456',
                accountType: 'CreditCard',
            };

            mockFetch.mock.mockImplementationOnce(() =>
                Promise.resolve({
                    ok: false,
                    status: 401,
                    statusText: 'Unauthorized',
                })
            );

            await assert.rejects(getStatements(mockAccount), /Chase API request failed: 401 Unauthorized/);
        });

        it('should handle network errors', async () => {
            const mockAccount = {
                profile: { sessionId: 'test', profileId: 'test', profileName: 'Test' },
                accountId: '45678',
                accountName: 'Test Account',
                accountMask: '4567',
                accountType: 'CreditCard',
            };

            mockFetch.mock.mockImplementationOnce(() => Promise.reject(new Error('Network error')));

            await assert.rejects(getStatements(mockAccount));
        });
    });
});
