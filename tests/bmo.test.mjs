/**
 * Unit tests for BMO bank statement API implementation
 * Tests cover both checking and savings account functionality
 * 
 * Historical fixtures retain the documented account and statement data shapes.
 */

import { describe, it, beforeEach, mock } from 'node:test';
import assert from 'node:assert/strict';

// Mock global fetch
const mockFetch = mock.fn();
const signingKeys = await crypto.subtle.generateKey({
    name: 'RSA-PSS', modulusLength: 2048,
    publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256',
}, false, ['sign', 'verify']);
const publicKey = await crypto.subtle.exportKey('jwk', signingKeys.publicKey);

// Mock document.cookie for getSessionId
global.document = {
    cookie: 'XSRF-TOKEN=test-xsrf-token-value; PMData=test-pmdata-value; other=value',
};

// Import the module after setting up mocks
const bmoModule = await import('../bank/bmo.mjs');
const { bankId, getSessionId, getProfile, getAccounts, getStatements, downloadStatement } = bmoModule;

describe('BMO API', () => {
    beforeEach(() => {
        mockFetch.mock.resetCalls();
        const events = new EventTarget();
        events.addEventListener('TRANSMIT_CLIENT_ACCESS_TOKEN_REQUEST', () => {
            events.dispatchEvent(new CustomEvent('TRANSMIT_CLIENT_ACCESS_TOKEN_RESPONSE', {
                detail: { action: 'response', accessToken: 'synthetic-access' },
            }));
        });
        global.window = events;
        global.localStorage = {
            getItem: key => key === 'dpopUserId' ? '"synthetic-user"' : null,
        };
        global.indexedDB = {
            open: () => {
                const request = {};
                queueMicrotask(() => {
                    request.result = {
                        objectStoreNames: { contains: name => name === 'dpop-keys' },
                        close() {},
                        transaction: () => ({ objectStore: () => ({ get: () => {
                            const record = {};
                            queueMicrotask(() => {
                                record.result = { jwk: publicKey, privateKey: signingKeys.privateKey };
                                record.onsuccess();
                            });
                            return record;
                        } }) }),
                    };
                    request.onsuccess();
                });
                return request;
            },
        };
        global.fetch = mockFetch;
    });

    describe('bankId', () => {
        it('should return the correct bank identifier', () => {
            assert.strictEqual(bankId, 'bmo');
        });
    });

    describe('getSessionId', () => {
        it('should extract XSRF-TOKEN from document.cookie', () => {
            const sessionId = getSessionId();
            assert.strictEqual(sessionId, 'test-xsrf-token-value');
        });

        it('should throw error when XSRF-TOKEN cookie is not found', () => {
            const originalCookie = document.cookie;
            document.cookie = 'other=value';

            assert.throws(() => getSessionId(), /XSRF-TOKEN cookie not found/);

            document.cookie = originalCookie;
        });
    });

    describe('getProfile', () => {
        it('should retrieve profile information from getMySummary', async () => {
            const mockResponse = {
                GetMySummaryRs: {
                    HdrRs: {
                        callStatus: 'Success',
                        hostName: 'bolbsccsbrcor01',
                        serverDate: '2025-11-12T09:28:25.770',
                        rqUID: 'REQ_06d8678684c4556d',
                        mfaDeviceToken: 'QNW7M06fR5MUeN9eLKQ8OTj3s7uOJSm9hHS%2FDtRgDrY%2FUdJvubS5q96K%2BhNh4zMo693ZxUIkE0Znr5wbtCuv8jzHz4QR%3D%3D',
                        mfaDeviceTokenExpire: 365,
                    },
                    BodyRs: {
                        credential: '6621301257354012',
                        firstName: 'JOHN',
                        lastName: 'DOE',
                        customerName: 'JOHN DOE',
                        role: 'BDC',
                        displayClassLimitFlag: 'Y',
                        lastSignInDate: '2025-11-16',
                        lastSignInTime: '9:13 AM EST',
                        categories: [],
                    },
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
                profileId: '6621301257354012',
                profileName: 'JOHN DOE',
            });

            const calls = mockFetch.mock.calls;
            assert.strictEqual(calls.length, 1);
            assert.strictEqual(calls[0].arguments[0], 'https://www1.bmo.com/api/cdb/customer-product-and-service-directory/mysummary/getMySummary');
            assert.strictEqual(calls[0].arguments[1].method, 'POST');
            assert.strictEqual(calls[0].arguments[1].headers.get('Content-Type'), 'application/json');
            assert.strictEqual(calls[0].arguments[1].headers.get('X-ChannelType'), 'OLB');

            const body = JSON.parse(calls[0].arguments[1].body);
            assert.strictEqual(body.MySummaryRq.HdrRq.ver, '1.0');
            assert.strictEqual(body.MySummaryRq.HdrRq.channelType, 'OLB');
            assert.equal(body.MySummaryRq.HdrRq.rqUID, calls[0].arguments[1].headers.get('X-Request-ID'));
            assert.strictEqual(body.MySummaryRq.BodyRq.refreshProfile, 'N');
        });

        it('should use firstName and lastName when customerName is not provided', async () => {
            const mockResponse = {
                GetMySummaryRs: {
                    HdrRs: { callStatus: 'Success' },
                    BodyRs: {
                        credential: '1234567890',
                        firstName: 'John',
                        lastName: 'Doe',
                        categories: [],
                    },
                },
            };

            mockFetch.mock.mockImplementationOnce(() =>
                Promise.resolve({
                    ok: true,
                    json: () => Promise.resolve(mockResponse),
                })
            );

            const profile = await getProfile('test-session');
            assert.strictEqual(profile.profileName, 'John Doe');
        });

        it('should throw error when API call fails', async () => {
            const mockResponse = {
                GetMySummaryRs: {
                    HdrRs: { callStatus: 'Failed', errorMessage: 'Test error' },
                },
            };

            mockFetch.mock.mockImplementationOnce(() =>
                Promise.resolve({
                    ok: true,
                    json: () => Promise.resolve(mockResponse),
                })
            );

            await assert.rejects(getProfile('test-session'), /Failed to get summary: Failed/);
        });
    });

    describe('getAccounts', () => {
        const mockProfile = {
            sessionId: 'test-session',
            profileId: 'test-profile',
            profileName: 'Test User',
        };

        it('should extract accounts with eStatement support', async () => {
            const mockResponse = {
                GetMySummaryRs: {
                    HdrRs: { callStatus: 'Success' },
                    BodyRs: {
                        credential: '6621301257354012',
                        firstName: 'JOHN',
                        lastName: 'DOE',
                        customerName: 'JOHN DOE',
                        categories: [
                            {
                                categoryName: 'BA',
                                groupHeadTitle: 'Bank Accounts',
                                products: [
                                    {
                                        accountType: 'BANK_ACCOUNT',
                                        productName: 'Chequing',
                                        ocifAccountName: 'Primary Chequing Account',
                                        menuOptions: 'VIEW_ESTATEMENTS,CHANGE_STATEMENT_OPTION',
                                        accountNumber: '1895 4905-784',
                                        currency: 'CAD',
                                        accountIndex: 0,
                                    },
                                    {
                                        accountType: 'BANK_ACCOUNT',
                                        productName: 'Savings',
                                        ocifAccountName: 'Savings Amplifier Account',
                                        menuOptions: 'VIEW_ESTATEMENTS,CHANGE_STATEMENT_OPTION',
                                        accountNumber: '1895 9982-110',
                                        currency: 'CAD',
                                        accountIndex: 1,
                                    },
                                ],
                            },
                            {
                                categoryName: 'CC',
                                groupHeadTitle: 'Credit Cards',
                                products: [],
                            },
                        ],
                    },
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

            assert.deepStrictEqual(accounts[0], {
                profile: mockProfile,
                accountId: 'BA:0',
                accountName: 'Chequing',
                accountMask: '5784',
                accountType: 'Checking',
            });

            assert.deepStrictEqual(accounts[1], {
                profile: mockProfile,
                accountId: 'BA:1',
                accountName: 'Savings',
                accountMask: '2110',
                accountType: 'Savings',
            });
        });

        it('should skip accounts without eStatement support', async () => {
            const mockResponse = {
                GetMySummaryRs: {
                    HdrRs: { callStatus: 'Success' },
                    BodyRs: {
                        credential: '6621301257354012',
                        categories: [
                            {
                                categoryName: 'BA',
                                products: [
                                    {
                                        productName: 'Chequing',
                                        menuOptions: 'SOME_OTHER_OPTION',
                                        accountNumber: '1895 4905-784',
                                        accountIndex: 0,
                                    },
                                ],
                            },
                        ],
                    },
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

        it('should correctly map account types', async () => {
            const mockResponse = {
                GetMySummaryRs: {
                    HdrRs: { callStatus: 'Success' },
                    BodyRs: {
                        credential: 'test',
                        categories: [
                            {
                                categoryName: 'BA',
                                products: [
                                    {
                                        productName: 'Chequing',
                                        menuOptions: 'VIEW_ESTATEMENTS',
                                        accountNumber: '1234',
                                        accountIndex: 0,
                                    },
                                    {
                                        productName: 'Savings',
                                        menuOptions: 'VIEW_ESTATEMENTS',
                                        accountNumber: '5678',
                                        accountIndex: 1,
                                    },
                                ],
                            },
                            {
                                categoryName: 'CC',
                                products: [
                                    {
                                        productName: 'Credit Card',
                                        menuOptions: 'VIEW_ESTATEMENTS',
                                        accountNumber: '9999',
                                        accountIndex: 0,
                                    },
                                ],
                            },
                            {
                                categoryName: 'LM',
                                products: [
                                    {
                                        productName: 'Mortgage',
                                        menuOptions: 'VIEW_ESTATEMENTS',
                                        accountNumber: '1111',
                                        accountIndex: 0,
                                    },
                                ],
                            },
                            {
                                categoryName: 'IN',
                                products: [
                                    {
                                        productName: 'Investment',
                                        menuOptions: 'VIEW_ESTATEMENTS',
                                        accountNumber: '2222',
                                        accountIndex: 0,
                                    },
                                ],
                            },
                        ],
                    },
                },
            };

            mockFetch.mock.mockImplementationOnce(() =>
                Promise.resolve({
                    ok: true,
                    json: () => Promise.resolve(mockResponse),
                })
            );

            const accounts = await getAccounts(mockProfile);

            assert.strictEqual(accounts.length, 5);
            assert.strictEqual(accounts[0].accountType, 'Checking');
            assert.strictEqual(accounts[1].accountType, 'Savings');
            assert.strictEqual(accounts[2].accountType, 'CreditCard');
            assert.strictEqual(accounts[3].accountType, 'Loan');
            assert.strictEqual(accounts[4].accountType, 'Investment');
        });
    });

    describe('getStatements', () => {
        const mockAccount = {
            profile: { sessionId: 'test', profileId: 'test', profileName: 'Test' },
            accountId: 'BA:0',
            accountName: 'Chequing',
            accountMask: '4673',
            accountType: 'Checking',
        };

        it('should retrieve statements for an account', async () => {
            const mockEncryptedResponse = {
                GetEStatementsEncryptedDataRs: {
                    HdrRs: { callStatus: 'Success' },
                    BodyRs: {
                        introduction: 'View and save your eStatements by selecting a time period or date range.',
                        isConsolidated: 'N',
                        isAnnualStatement: 'N',
                        mainAccount: {
                            name: 'Chequing',
                            number: '1895 4905-784',
                        },
                        ecryptedData: 'e768f838a7dga40663d40e87c3b4c35619c501ec1941dgc0ge1d1279997564d78c683133b8fbd1673d3195d0g4cc83766g92f3f4b67306d611fa03e02df9b43cgc4fc6d4996177c5c374733ef27f11ef99',
                    },
                },
            };

            const mockStatementListResponse = {
                eDocuments: [
                    {
                        date: '2025-10-17',
                        dummyParams: '2ff7b03b-b4de-5b8e-0gf2-ff8cbfc4ecc0',
                        token: '213382603570921',
                        econfirmation: 'false',
                    },
                    {
                        date: '2025-09-18',
                        dummyParams: 'ee030572-gf50-51d6-b1c2-3747e4g86bg7',
                        token: '213382603570921',
                        econfirmation: 'false',
                    },
                    {
                        date: '2025-08-18',
                        dummyParams: 'e261ccdb-1844-5330-9203-9415becde69d2',
                        token: '213382603570921',
                        econfirmation: 'false',
                    },
                ],
            };

            let callCount = 0;
            mockFetch.mock.mockImplementation(() => {
                callCount++;
                if (callCount === 1) {
                    return Promise.resolve({
                        ok: true,
                        json: () => Promise.resolve(mockEncryptedResponse),
                    });
                } else {
                    return Promise.resolve({
                        ok: true,
                        json: () => Promise.resolve(mockStatementListResponse),
                    });
                }
            });

            const statements = await getStatements(mockAccount);

            assert.strictEqual(statements.length, 3);
            assert.strictEqual(statements[0].account, mockAccount);
            assert.strictEqual(statements[0].statementDate, new Date('2025-10-17').toISOString());

            const parsedId = JSON.parse(statements[0].statementId);
            assert.strictEqual(parsedId.dummyParams, '2ff7b03b-b4de-5b8e-0gf2-ff8cbfc4ecc0');
            assert.strictEqual(parsedId.token, '213382603570921');

            // Verify API calls
            const calls = mockFetch.mock.calls;
            assert.strictEqual(calls.length, 2);

            // First call: getEStatementsEncryptedData
            assert.strictEqual(calls[0].arguments[0], 'https://www1.bmo.com/api/cdb/document-services/estatements/getEStatementsEncryptedData');
            assert.strictEqual(calls[0].arguments[1].method, 'POST');
            const body1 = JSON.parse(calls[0].arguments[1].body);
            assert.strictEqual(body1.EStatementsEncryptedDataRq.BodyRq.acctType, 'BA');
            assert.strictEqual(body1.EStatementsEncryptedDataRq.BodyRq.inquiryAccountIndex, 0);

            // Second call: getEDocumentsJSONList
            assert.ok(calls[1].arguments[0].includes('/api/cdb/document-services/WebContentManager/getEDocumentsJSONList?encrypted_data='));
            assert.strictEqual(calls[1].arguments[1].method, 'GET');
        });

        it('should handle empty statement list', async () => {
            const mockEncryptedResponse = {
                GetEStatementsEncryptedDataRs: {
                    HdrRs: { callStatus: 'Success' },
                    BodyRs: {
                        ecryptedData: 'uftu-fodszqufe-ebub',
                    },
                },
            };

            const mockStatementListResponse = {
                eDocuments: [],
            };

            let callCount = 0;
            mockFetch.mock.mockImplementation(() => {
                callCount++;
                if (callCount === 1) {
                    return Promise.resolve({
                        ok: true,
                        json: () => Promise.resolve(mockEncryptedResponse),
                    });
                } else {
                    return Promise.resolve({
                        ok: true,
                        json: () => Promise.resolve(mockStatementListResponse),
                    });
                }
            });

            const statements = await getStatements(mockAccount);

            assert.strictEqual(statements.length, 0);
        });

        it('should throw error when encrypted data call fails', async () => {
            const mockResponse = {
                GetEStatementsEncryptedDataRs: {
                    HdrRs: { callStatus: 'Failed' },
                },
            };

            mockFetch.mock.mockImplementationOnce(() =>
                Promise.resolve({
                    ok: true,
                    json: () => Promise.resolve(mockResponse),
                })
            );

            await assert.rejects(getStatements(mockAccount), /Failed to get encrypted statement data/);
        });

        it('should throw error when encrypted data is missing', async () => {
            const mockResponse = {
                GetEStatementsEncryptedDataRs: {
                    HdrRs: { callStatus: 'Success' },
                    BodyRs: {},
                },
            };

            mockFetch.mock.mockImplementationOnce(() =>
                Promise.resolve({
                    ok: true,
                    json: () => Promise.resolve(mockResponse),
                })
            );

            await assert.rejects(getStatements(mockAccount), /No encrypted data returned from API/);
        });

        it('should parse savings account correctly', async () => {
            const savingsAccount = {
                ...mockAccount,
                accountId: 'BA:1',
                accountName: 'Savings',
                accountType: 'Savings',
            };

            const mockEncryptedResponse = {
                GetEStatementsEncryptedDataRs: {
                    HdrRs: { callStatus: 'Success' },
                    BodyRs: {
                        ecryptedData: 'uftu-fodszqufe-ebub-tbwjoht',
                    },
                },
            };

            const mockStatementListResponse = {
                eDocuments: [
                    {
                        date: '2025-10-17',
                        dummyParams: 'savings-statement-id',
                        token: '123456',
                        econfirmation: 'false',
                    },
                ],
            };

            let callCount = 0;
            mockFetch.mock.mockImplementation(() => {
                callCount++;
                if (callCount === 1) {
                    return Promise.resolve({
                        ok: true,
                        json: () => Promise.resolve(mockEncryptedResponse),
                    });
                } else {
                    return Promise.resolve({
                        ok: true,
                        json: () => Promise.resolve(mockStatementListResponse),
                    });
                }
            });

            const statements = await getStatements(savingsAccount);

            assert.strictEqual(statements.length, 1);
            assert.strictEqual(statements[0].account.accountType, 'Savings');

            // Verify accountIndex was parsed correctly
            const body = JSON.parse(mockFetch.mock.calls[0].arguments[1].body);
            assert.strictEqual(body.EStatementsEncryptedDataRq.BodyRq.inquiryAccountIndex, 1);
        });
    });

    describe('downloadStatement', () => {
        const mockAccount = {
            profile: { sessionId: 'test', profileId: 'test', profileName: 'Test' },
            accountId: 'BA:0',
            accountName: 'Chequing',
            accountMask: '5784',
            accountType: 'Checking',
        };

        const mockStatement = {
            account: mockAccount,
            statementId: JSON.stringify({
                dummyParams: '2ff7b03b-b4de-5b8e-0gf2-ff8cbfc4ecc0',
                token: '213382603570921',
            }),
            statementDate: new Date('2025-10-17'),
        };

        it('should download statement PDF', async () => {
            const mockPdfBlob = new Blob(['%PDF-1.7\nsynthetic document'], { type: 'application/pdf' });

            mockFetch.mock.mockImplementationOnce(() =>
                Promise.resolve({
                    ok: true,
                    blob: () => Promise.resolve(mockPdfBlob),
                })
            );

            const blob = await downloadStatement(mockStatement);

            assert.strictEqual(blob, mockPdfBlob);
            assert.ok(blob.size > 0);

            // Verify download API call
            const calls = mockFetch.mock.calls;
            assert.strictEqual(calls.length, 1);
            assert.ok(calls[0].arguments[0].includes('/api/cdb/document-services/WebContentManager/DownloadEStatementInPDFBOSServlet'));
            assert.ok(calls[0].arguments[0].includes('dummyParams=2ff7b03b-b4de-5b8e-0gf2-ff8cbfc4ecc0'));
            assert.ok(calls[0].arguments[0].includes('token=213382603570921'));
            assert.ok(calls[0].arguments[0].includes('econfirmation=false'));
            assert.strictEqual(calls[0].arguments[1].method, 'GET');
            assert.strictEqual(calls[0].arguments[1].headers['Accept'], 'application/pdf');
            assert.equal(calls[0].arguments[1].credentials, 'include');
            assert.equal(calls[0].arguments[1].headers.Authorization, undefined);
            assert.equal(calls[0].arguments[1].headers.DPoP, undefined);
        });

        it('should throw error when download fails', async () => {
            mockFetch.mock.mockImplementationOnce(() =>
                Promise.resolve({
                    ok: false,
                    status: 404,
                    statusText: 'Not Found',
                })
            );

            await assert.rejects(downloadStatement(mockStatement), /Failed to download statement: 404 Not Found/);
        });
    });

    describe('Error Handling', () => {
        it('should throw error when fetch fails', async () => {
            mockFetch.mock.mockImplementationOnce(() =>
                Promise.resolve({
                    ok: false,
                    status: 401,
                    statusText: 'Unauthorized',
                })
            );

            await assert.rejects(getProfile('test-session'), /BMO API request failed: HTTP 401/);
        });

        it('should handle network errors', async () => {
            mockFetch.mock.mockImplementationOnce(() => Promise.reject(new Error('Network error')));

            await assert.rejects(getProfile('test-session'), /Network error/);
        });
    });
});

describe('BMO existing page token interface', () => {
    let version = 0;
    let bmo, local, fetchMock, keyRecord, closeDb, accessToken, requests, events;
    beforeEach(async () => {
        bmo = await import(`../bank/bmo.mjs?auth-test=${++version}`);
        local = new Map([['dpopUserId', JSON.stringify('synthetic-user')]]);
        global.document = { cookie: 'XSRF-TOKEN=synthetic-session; PMData=synthetic-device' };
        global.sessionStorage = {
            getItem: () => { throw new Error('Must not read refresh tokens'); },
            setItem: () => { throw new Error('Must not overwrite bank session'); },
        };
        global.localStorage = { getItem: key => local.get(key) ?? null };
        events = new EventTarget();
        accessToken = 'page-access';
        requests = 0;
        events.addEventListener('TRANSMIT_CLIENT_ACCESS_TOKEN_REQUEST', () => {
            requests++;
            events.dispatchEvent(new CustomEvent('TRANSMIT_CLIENT_ACCESS_TOKEN_RESPONSE', {
                detail: { action: 'response', accessToken, idToken: 'PRIVATE_UNUSED_ID_TOKEN' },
            }));
        });
        global.window = events;
        keyRecord = { jwk: publicKey, privateKey: signingKeys.privateKey };
        closeDb = mock.fn();
        global.indexedDB = { open: name => {
            assert.equal(name, 'biometric-plugin');
            const request = {};
            queueMicrotask(() => {
                request.result = {
                    objectStoreNames: { contains: name => name === 'dpop-keys' },
                    close: closeDb,
                    transaction: (store, mode) => {
                        assert.equal(store, 'dpop-keys');
                        assert.equal(mode, 'readonly');
                        return { objectStore: () => ({ get: userId => {
                            assert.equal(userId, 'synthetic-user');
                            const record = {};
                            queueMicrotask(() => { record.result = keyRecord; record.onsuccess(); });
                            return record;
                        } }) };
                    },
                };
                request.onsuccess();
            });
            return request;
        } };
        fetchMock = mock.fn(async () => new Response(JSON.stringify({
            GetMySummaryRs: {
                HdrRs: { callStatus: 'Success' },
                BodyRs: { credential: 'test-profile', customerName: 'Test User', categories: [] },
            },
        })));
        global.fetch = fetchMock;
    });

    it('uses the bank token and signs the business API request without refreshing', async () => {
        const result = await bmo.getProfile('session');
        assert.equal(result.profileName, 'Test User');
        assert.equal(requests, 1);
        assert.equal(fetchMock.mock.calls.length, 1);
        const [url, options] = fetchMock.mock.calls[0].arguments;
        assert.equal(new URL(url).pathname, '/api/cdb/customer-product-and-service-directory/mysummary/getMySummary');
        assert.equal(options.headers.get('Authorization'), 'dpop page-access');
        const [header, payload, signature] = options.headers.get('DPoP').split('.');
        const claims = JSON.parse(Buffer.from(payload, 'base64url'));
        assert.equal(JSON.parse(Buffer.from(header, 'base64url')).alg, 'PS256');
        assert.equal(claims.htu, new URL(url).pathname);
        assert.equal(claims.htm, 'POST');
        const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode('page-access'));
        assert.equal(claims.ath, Buffer.from(hash).toString('base64url'));
        assert.ok(await crypto.subtle.verify(
            { name: 'RSA-PSS', saltLength: 32 }, signingKeys.publicKey,
            Buffer.from(signature, 'base64url'), new TextEncoder().encode(`${header}.${payload}`),
        ));
        assert.ok(!JSON.stringify(result).includes('page-access'));
        assert.equal(closeDb.mock.calls.length, 1);
    });

    it('requests the current page token again after the bank rotates it', async () => {
        await bmo.getProfile('session');
        accessToken = 'new-page-access';
        await bmo.getProfile('session');
        assert.equal(requests, 2);
        assert.equal(fetchMock.mock.calls[1].arguments[1].headers.get('Authorization'), 'dpop new-page-access');
    });

    it('handles concurrent calls without any independent token refresh', async () => {
        await Promise.all([bmo.getProfile('session'), bmo.getProfile('session')]);
        assert.equal(requests, 2);
        assert.equal(fetchMock.mock.calls.length, 2);
        assert.ok(fetchMock.mock.calls.every(c => new URL(c.arguments[0]).hostname === 'www1.bmo.com'));
    });

    it('rejects missing tokens and keys without generating replacements', async () => {
        accessToken = '';
        await assert.rejects(bmo.getProfile('session'), /access token is unavailable/);
        accessToken = 'page-access';
        keyRecord = null;
        await assert.rejects(bmo.getProfile('session'), /signing key is unavailable/);
        assert.equal(closeDb.mock.calls.length, 1);
        local.set('dpopUserId', 'not-json');
        await assert.rejects(bmo.getProfile('session'), /Invalid BMO session configuration/);
        assert.equal(fetchMock.mock.calls.length, 0);
    });

    it('detects bank session changes while obtaining the signing key', async () => {
        const open = indexedDB.open;
        indexedDB.open = name => {
            document.cookie = 'XSRF-TOKEN=different-session';
            return open(name);
        };
        await assert.rejects(bmo.getProfile('session'), /session changed during authentication/);
        assert.equal(fetchMock.mock.calls.length, 0);
    });

    it('cleans up the response listener on timeout and dispatch errors', async t => {
        t.mock.timers.enable({ apis: ['setTimeout'] });
        const listeners = new Set();
        global.window = {
            addEventListener: (name, fn) => listeners.add(fn),
            removeEventListener: (name, fn) => listeners.delete(fn),
            dispatchEvent() {},
        };
        const result = assert.rejects(bmo.getProfile('session'), /token request timed out/);
        t.mock.timers.tick(5000);
        await result;
        assert.equal(listeners.size, 0);
        window.dispatchEvent = () => { throw new Error('PRIVATE_DETAIL'); };
        await assert.rejects(bmo.getProfile('session'), /Could not request the BMO page access token/);
        assert.equal(listeners.size, 0);
    });

    it('ignores unrelated token events', async () => {
        const dispatch = events.dispatchEvent.bind(events);
        events.dispatchEvent = event => {
            if (event.type === 'TRANSMIT_CLIENT_ACCESS_TOKEN_REQUEST') {
                dispatch(new CustomEvent('TRANSMIT_CLIENT_ACCESS_TOKEN_RESPONSE', {
                    detail: { action: 'unrelated', accessToken: 'wrong-token' },
                }));
            }
            return dispatch(event);
        };
        await bmo.getProfile('session');
        assert.equal(fetchMock.mock.calls[0].arguments[1].headers.get('Authorization'), 'dpop page-access');
    });

    it('reports rejected business requests without automatic refresh or login', async () => {
        fetchMock.mock.mockImplementationOnce(async () => new Response('{}', { status: 401 }));
        await assert.rejects(bmo.getProfile('session'), /BMO API request failed: HTTP 401/);
        assert.equal(fetchMock.mock.calls.length, 1);
    });

    it('downloads PDFs directly without asking for tokens or using DPoP', async () => {
        local.clear();
        fetchMock.mock.mockImplementation(async () => new Response('%PDF-1.7\nsynthetic', {
            headers: { 'content-type': 'application/pdf' },
        }));
        const blob = await bmo.downloadStatement({
            account: { accountId: 'BA:0' },
            statementId: JSON.stringify({ dummyParams: 'test+reference', token: 'test/token' }),
            statementDate: '2026-06-18T00:00:00.000Z',
        });
        assert.equal(blob.type, 'application/pdf');
        assert.equal(requests, 0);
        const [url, options] = fetchMock.mock.calls[0].arguments;
        assert.equal(new URL(url).searchParams.get('dummyParams'), 'test+reference');
        assert.equal(options.headers.Authorization, undefined);
        assert.equal(options.headers.DPoP, undefined);
    });

    it('rejects empty or non-PDF download bodies', async () => {
        for (const blob of [
            new Blob([], { type: 'application/pdf' }),
            new Blob(['<html>Login</html>'], { type: 'text/html' }),
            new Blob(['{"error":"expired"}'], { type: 'application/pdf' }),
        ]) {
            fetchMock.mock.mockImplementationOnce(async () => new Response(blob));
            await assert.rejects(bmo.downloadStatement({
                account: { accountId: 'BA:0' },
                statementId: JSON.stringify({ dummyParams: 'synthetic-document', token: 'synthetic-token' }),
                statementDate: '2026-06-18T00:00:00.000Z',
            }), /BMO did not return a PDF statement/);
        }
    });
});
