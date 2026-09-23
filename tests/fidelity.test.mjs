/**
 * Fidelity tests use synthetic examples of the current Document Center responses.
 * Credit-card tests retain coverage of the historical GraphQL compatibility path.
 */
import { describe, it, beforeEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import {
    bankId, getSessionId, getProfile, getAccounts, getStatements, downloadStatement,
} from '../bank/fidelity.mjs';

const mockFetch = mock.fn();
global.fetch = mockFetch;
global.document = { cookie: '' };

const profile = {
    sessionId: 'test-session',
    profileId: 'person@example.com',
    profileName: 'person@example.com',
};
const account = {
    profile,
    accountId: 'ACCOUNT0001',
    accountName: 'Example investment account',
    accountMask: '0001',
    accountType: 'Investment',
};
const card = { ...account, accountType: 'CreditCard', accountId: 'synthetic-card-id' };
const contactsUrl = 'https://digitalservices.fidelity.com/ftgw/dp/rwcf-cm-contacts/v4/customers/contacts/get';
const accountsUrl = 'https://dpservice.fidelity.com/ftgw/dp/customer-am-acctnxt/v2/accounts';
const statementsUrl = 'https://digitalservices.fidelity.com/ftgw/dp/retail-am-financialdoc/v1/accounts/communications/financial-documents/statements';
const downloadUrl = 'https://digitalservices.fidelity.com/ftgw/dp/retail-am-financialdoc/v2/accounts/communications/financial-documents/download';
const cardUrl = 'https://digital.fidelity.com/ftgw/digital/credit-card/api/graphql';

function respond(data, status = 200, statusText = 'OK') {
    mockFetch.mock.mockImplementationOnce(async () => new Response(JSON.stringify(data), {
        status, statusText, headers: { 'content-type': 'application/json; charset=UTF-8' },
    }));
}

function request() {
    assert.equal(mockFetch.mock.calls.length, 1);
    const [url, options] = mockFetch.mock.calls[0].arguments;
    assert.equal(options.method, 'POST');
    assert.equal(options.credentials, 'include');
    return { url, headers: options.headers, body: JSON.parse(options.body) };
}

function documentEntry(overrides = {}) {
    return {
        id: 'synthetic-statement-id',
        type: 'PI Monthly/Quarterly Statement',
        acctNum: account.accountId,
        periodStartDate: 1767243600,
        periodEndDate: 1769835600,
        generatedDate: 1769835600,
        isHouseholded: false,
        formatTypes: { formatType: { isPDF: true, isCSV: false } },
        ...overrides,
    };
}

function statementList(entries) {
    return { statement: { docDetails: { docDetail: entries } } };
}

const pdfText = '%PDF-1.7\nsynthetic unit-test payload\n%%EOF';
function pdfResponse(overrides = {}) {
    return {
        document: {
            docDetail: {
                contentType: 'application/pdf',
                content: Buffer.from(pdfText).toString('base64'),
                encoding: 'Base64',
                deflated: 'Y',
                updateViewedInd: true,
                ...overrides,
            },
        },
    };
}

describe('Fidelity API', () => {
    beforeEach(() => {
        mockFetch.mock.resetCalls();
        mockFetch.mock.mockImplementation(async () => { throw new Error('Unexpected fetch'); });
        document.cookie = 'MC=test-session; other=value';
    });

    it('has the expected bank ID', () => assert.equal(bankId, 'fidelity'));

    describe('getSessionId', () => {
        for (const cookie of ['MC', 'FC', 'RC', 'SC']) {
            it(`extracts the ${cookie} session cookie`, () => {
                document.cookie = `${cookie}=test-session; other=value`;
                assert.equal(getSessionId(), 'test-session');
            });
        }

        it('reports when login is required', () => {
            document.cookie = 'other=value';
            assert.throws(getSessionId, /Fidelity session not found.*Documents page/);
        });
    });

    describe('getProfile', () => {
        it('requests only email data and selects the primary retail email', async () => {
            respond({ emails: [
                { email: 'workplace@example.com', type: 'PRIMARY', custRel: 'WORKPLACE' },
                { email: 'secondary@example.com', type: 'SECONDARY', custRel: 'RETAIL' },
                { email: profile.profileId, type: 'PRIMARY', custRel: 'RETAIL' },
            ] });
            assert.deepEqual(await getProfile(profile.sessionId), profile);
            const sent = request();
            assert.equal(sent.url, contactsUrl);
            assert.deepEqual(sent.body, {
                workplaceSrcs: ['PARTICIPANT'], contactTypes: ['EMAIL'], addrDetails: ['CUSTOMER'],
            });
            assert.equal(sent.headers['appid'], 'AP162039');
            assert.equal(sent.headers['appname'], 'Enterprise Personal Info');
            assert.equal(sent.headers['fid-originating-app-id'], 'AP162039');
            assert.equal(sent.headers['fid-originating-app-version'], '2');
        });

        it('reports HTTP failures without falling back to a fabricated profile', async () => {
            respond({}, 403, 'Forbidden');
            await assert.rejects(getProfile('session'), /Failed to get profile: Fidelity API request failed: 403 Forbidden/);
        });

        for (const data of [{}, { emails: null }, { emails: {} }]) {
            it(`rejects a missing or malformed email list: ${JSON.stringify(data)}`, async () => {
                respond(data);
                await assert.rejects(getProfile('session'), /Email list not found/);
            });
        }

        it('rejects missing or ambiguous primary retail emails', async () => {
            for (const emails of [[], [
                { email: 'one@example.com', type: 'PRIMARY', custRel: 'RETAIL' },
                { email: 'two@example.com', type: 'PRIMARY', custRel: 'RETAIL' },
            ]]) {
                respond({ emails });
                await assert.rejects(getProfile('session'), /Expected one primary retail email/);
            }
        });

        it('rejects invalid email values', async () => {
            respond({ emails: [{ email: '', type: 'PRIMARY', custRel: 'RETAIL' }] });
            await assert.rejects(getProfile('session'), /Invalid primary retail email/);
        });

        it('does not treat an HTML login response as profile data', async () => {
            mockFetch.mock.mockImplementationOnce(async () => new Response('<html>Login</html>', {
                headers: { 'content-type': 'text/html' },
            }));
            await assert.rejects(getProfile('session'), /Expected a JSON response.*sign in/);
        });

        it('rejects an invalid top-level JSON structure', async () => {
            respond([]);
            await assert.rejects(getProfile('session'), /Invalid Fidelity API response structure/);
        });
    });

    describe('getAccounts', () => {
        it('uses the current REST response and retains the credit-card field mapping', async () => {
            respond({ acctDetails: [
                { acctNum: account.accountId, acctType: 'Brokerage', preferenceDetail: { name: account.accountName, isHidden: false } },
                { acctNum: '0002', acctType: 'Fidelity Credit Card', preferenceDetail: { name: 'Example credit card' }, creditCardDetail: { creditCardAcctNumber: card.accountId } },
            ] });
            const accounts = await getAccounts(profile);
            assert.deepEqual(accounts[0], account);
            assert.deepEqual(accounts[1], { ...card, accountName: 'Example credit card', accountMask: '0002' });
            const sent = request();
            assert.equal(sent.url, accountsUrl);
            assert(sent.body.acctCategory.split(',').includes('FidelityCreditCards'));
            assert.deepEqual(sent.body.filters, {
                returnCustomerAttrDetail: true,
                returnPreferenceDetail: true,
                returnAcctRelAttrDetail: true,
                returnAcctIndDetail: true,
                returnOrderedAccounts: true,
                returnAcctStateDetail: true,
            });
            assert.equal(sent.headers['appid'], 'AP160308');
            assert.equal(sent.headers['fid-originating-app-version'], '1');
        });

        it('skips hidden accounts and records without an account identifier', async () => {
            respond({ acctDetails: [
                { acctNum: account.accountId, acctType: 'Brokerage', preferenceDetail: { name: account.accountName } },
                { acctNum: 'HIDDEN0002', preferenceDetail: { name: 'Hidden', isHidden: true } },
                { acctNum: null, preferenceDetail: { name: 'Aggregate' } },
            ] });
            assert.deepEqual(await getAccounts(profile), [account]);
        });

        it('uses the subtype name when no preference name is supplied', async () => {
            respond({ acctDetails: [{ acctNum: account.accountId, acctType: 'SPS', acctSubTypeDesc: 'Stock plan' }] });
            assert.equal((await getAccounts(profile))[0].accountName, 'Stock plan');
        });

        it('retains the account number when an optional card identifier is empty', async () => {
            respond({ acctDetails: [{
                acctNum: account.accountId,
                acctType: 'Brokerage',
                preferenceDetail: { name: account.accountName },
                creditCardDetail: { creditCardAcctNumber: '' },
            }] });
            assert.deepEqual(await getAccounts(profile), [account]);
        });

        it('accepts a genuinely empty account list', async () => {
            respond({ acctDetails: [] });
            assert.deepEqual(await getAccounts(profile), []);
        });

        it('rejects a missing account array or malformed entry', async () => {
            respond({ sysMsgs: {} });
            await assert.rejects(getAccounts(profile), /Account list not found/);
            respond({ acctDetails: [null] });
            await assert.rejects(getAccounts(profile), /Invalid account entry/);
        });

        it('reports HTTP errors', async () => {
            respond({}, 401, 'Unauthorized');
            await assert.rejects(getAccounts(profile), /Failed to get accounts: Fidelity API request failed: 401 Unauthorized/);
        });
    });

    describe('getStatements - Brokerage', () => {
        it('maps the current response and Unix seconds to statement dates', async () => {
            respond(statementList([documentEntry()]));
            assert.deepEqual(await getStatements(account), [{
                account, statementId: 'synthetic-statement-id', statementDate: '2026-01-31',
            }]);
            const sent = request();
            assert.equal(sent.url, statementsUrl);
            assert.equal(sent.body.docType, 'STMT');
            assert.equal(sent.body.hasCryptoAccount, false);
            assert.equal(sent.body.annuityAccountLookup, true);
            assert.match(sent.body.startDate, /^\d{4}-\d{2}-\d{2}$/);
            assert.match(sent.body.endDate, /^\d{4}-\d{2}-\d{2}$/);
            assert(sent.body.startDate < sent.body.endDate);
            assert.equal(sent.body.operationName, undefined);
        });

        it('retains consolidated statements without an account number', async () => {
            respond(statementList([documentEntry({ acctNum: undefined, isHouseholded: true })]));
            assert.equal((await getStatements(account)).length, 1);
        });

        it('matches individual statements using the complete account ID, not just the mask', async () => {
            respond(statementList([
                documentEntry(),
                documentEntry({ id: 'other-statement', acctNum: 'OTHER0001' }),
            ]));
            const statements = await getStatements(account);
            assert.equal(statements.length, 1);
            assert.equal(statements[0].statementId, 'synthetic-statement-id');
        });

        it('filters out non-PDF formats', async () => {
            respond(statementList([
                documentEntry(),
                documentEntry({ id: 'csv', formatTypes: { formatType: { isPDF: false, isCSV: true } } }),
            ]));
            assert.equal((await getStatements(account)).length, 1);
        });

        it('uses generatedDate only when periodEndDate is missing', async () => {
            respond(statementList([documentEntry({ periodEndDate: undefined })]));
            assert.equal((await getStatements(account))[0].statementDate, '2026-01-31');
        });

        it('accepts a genuinely empty statement list', async () => {
            respond(statementList([]));
            assert.deepEqual(await getStatements(account), []);
        });

        it('reports missing statement data rather than returning a success-shaped empty list', async () => {
            respond({ statement: { sysMsgs: { sysMsg: [{ type: 'ERROR' }] } } });
            await assert.rejects(getStatements(account), /Statement list not found/);
        });

        for (const [entry, error] of [
            [null, /Invalid statement entry/],
            [documentEntry({ formatTypes: undefined }), /Statement format metadata/],
            [documentEntry({ acctNum: undefined }), /Account identifier missing/],
            [documentEntry({ acctNum: 1234, isHouseholded: true }), /Invalid account identifier/],
            [documentEntry({ id: '' }), /Statement identifier missing/],
            [documentEntry({ periodEndDate: '2026-01-31' }), /expected Unix seconds/],
            [documentEntry({ periodEndDate: -1 }), /expected Unix seconds/],
            [documentEntry({ periodEndDate: 1.5 }), /expected Unix seconds/],
            [documentEntry({ periodEndDate: 9000000000000 }), /Invalid Fidelity statement date/],
        ]) {
            it(`rejects malformed statement data: ${error.source}`, async () => {
                respond(statementList([entry]));
                await assert.rejects(getStatements(account), error);
            });
        }

        it('reports HTTP errors', async () => {
            respond({}, 500, 'Internal Server Error');
            await assert.rejects(getStatements(account), /Failed to get statements: Fidelity API request failed: 500/);
        });
    });

    describe('downloadStatement - Brokerage', () => {
        const statement = { account, statementId: 'opaque/id+=', statementDate: '2026-01-31' };

        it('posts the unmodified opaque ID and decodes the actual PDF bytes', async () => {
            respond(pdfResponse());
            const blob = await downloadStatement(statement);
            assert.equal(blob.type, 'application/pdf');
            assert.equal(await blob.text(), pdfText);
            assert.equal(blob.size, Buffer.byteLength(pdfText));
            const sent = request();
            assert.equal(sent.url, downloadUrl);
            assert.deepEqual(sent.body, { id: statement.statementId, formatType: 'PDF', docType: 'STMT', acctType: 'Brokerage' });
            assert.equal(sent.headers['fid-originating-app-version'], '1.0');
        });

        for (const [data, error] of [
            [{}, /No PDF content/],
            [pdfResponse({ content: '' }), /No PDF content/],
            [pdfResponse({ contentType: 'text/html' }), /not a PDF/],
            [pdfResponse({ encoding: 'gzip' }), /Unsupported Fidelity statement encoding/],
            [pdfResponse({ content: Buffer.from('<html>Login</html>').toString('base64') }), /not a PDF/],
            [pdfResponse({ content: '@invalid-base64@' }), /Failed to download statement/],
        ]) {
            it(`rejects malformed download payloads: ${error.source}`, async () => {
                respond(data);
                await assert.rejects(downloadStatement(statement), error);
            });
        }

        it('reports HTTP errors', async () => {
            respond({}, 404, 'Not Found');
            await assert.rejects(downloadStatement(statement), /Failed to download statement: Fidelity API request failed: 404 Not Found/);
        });
    });

    describe('credit-card compatibility', () => {
        it('retains the GraphQL statement-list request and mapping', async () => {
            respond({ data: { getStatementsList: { statements: [
                { statementEndDate: '2026-01-18' },
                { statementEndDate: '2025-12-18' },
            ] } } });
            assert.deepEqual(await getStatements(card), [
                { account: card, statementId: '2026-01-18', statementDate: '2026-01-18' },
                { account: card, statementId: '2025-12-18', statementDate: '2025-12-18' },
            ]);
            const sent = request();
            assert.equal(sent.url, cardUrl);
            assert.equal(sent.body.operationName, 'GetStatementsList');
            assert.equal(sent.body.variables.accountId, card.accountId);
            assert.equal(sent.headers['apollographql-client-name'], 'credit-card');
            assert.equal(sent.headers['apollographql-client-version'], '0.0.1');
        });

        it('accepts an empty credit-card statement list', async () => {
            respond({ data: { getStatementsList: { statements: [] } } });
            assert.deepEqual(await getStatements(card), []);
        });

        it('retains the GraphQL download and Base64 decoding', async () => {
            respond({ data: { getStatement: { statement: { pageContent: Buffer.from(pdfText).toString('base64') } } } });
            const statement = { account: card, statementId: '2026-01-18', statementDate: '2026-01-18' };
            const blob = await downloadStatement(statement);
            assert.equal(blob.type, 'application/pdf');
            assert.equal(await blob.text(), pdfText);
            const sent = request();
            assert.equal(sent.url, cardUrl);
            assert.equal(sent.body.operationName, 'GetStatement');
            assert.deepEqual(sent.body.variables, { accountId: card.accountId, statementDate: '2026-01-18' });
            assert.equal(sent.headers['apollographql-client-name'], 'credit-card');
            assert.equal(sent.headers['apollographql-client-version'], '0.0.1');
        });

        it('reports missing credit-card PDF content', async () => {
            respond({ data: { getStatement: { statement: {} } } });
            await assert.rejects(downloadStatement({ account: card }), /No PDF content in credit card statement response/);
        });

        it('reports credit-card list and download HTTP failures', async () => {
            respond({}, 500, 'Internal Server Error');
            await assert.rejects(getStatements(card), /GetStatementsList API request failed: 500/);
            respond({}, 500, 'Internal Server Error');
            await assert.rejects(downloadStatement({ account: card }), /Credit card PDF download failed: 500/);
        });
    });
});
