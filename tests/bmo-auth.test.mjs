import { beforeEach, describe, it, mock } from 'node:test';
import assert from 'node:assert/strict';

const keys = await crypto.subtle.generateKey({
    name: 'RSA-PSS', modulusLength: 2048,
    publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256',
}, false, ['sign', 'verify']);
const jwk = await crypto.subtle.exportKey('jwk', keys.publicKey);
let version = 0;

describe('BMO existing page token interface', () => {
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
        keyRecord = { jwk, privateKey: keys.privateKey };
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
            { name: 'RSA-PSS', saltLength: 32 }, keys.publicKey,
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
