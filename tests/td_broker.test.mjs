/**
 * Unit tests for TD Direct Investing (WebBroker) bank statement API implementation
 * Tests cover cookie-based session management and investment account functionality
 *
 * Note: All mock data is based on actual responses from analyze/td_broker_1764055743651.har
 * and browser validation results to ensure tests match real API behavior.
 */

import { describe, it, beforeEach, mock } from 'node:test';
import assert from 'node:assert/strict';

// Mock global fetch
const mockFetch = mock.fn();
global.fetch = mockFetch;

// Mock document.cookie
let mockCookies = '';
Object.defineProperty(global, 'document', {
    value: {
        get cookie() {
            return mockCookies;
        },
        set cookie(value) {
            mockCookies = value;
        },
    },
    writable: true,
});

// Import the module after setting up mocks
const tdBrokerModule = await import('../bank/td_broker.mjs');
const {
    bankId,
    bankName,
    getSessionId,
    getProfile,
    getAccounts,
    getStatements,
    downloadStatement,
} = tdBrokerModule;

describe('TD Direct Investing (WebBroker) API', () => {
    beforeEach(() => {
        mockFetch.mock.resetCalls();
        mockCookies = '';
    });

    describe('bankId', () => {
        it('should return the correct bank identifier', () => {
            assert.strictEqual(bankId, 'td_broker');
        });
    });

    describe('bankName', () => {
        it('should return the correct bank name', () => {
            assert.strictEqual(bankName, 'TD Direct Investing (WebBroker)');
        });
    });

    describe('getSessionId', () => {
        it('should extract XSRF-TOKEN cookie from document.cookie', () => {
            mockCookies =
                'XSRF-TOKEN=b37b6a1a-a25c-5dca-9799-ff4g0g22e666; com.td.last_login=1875166863447';

            const sessionId = getSessionId();
            assert.strictEqual(sessionId, 'b37b6a1a-a25c-5dca-9799-ff4g0g22e666');
        });

        it('should fall back to com.td.last_login when XSRF-TOKEN is not found', () => {
            mockCookies = 'com.td.last_login=1875166863447; other_cookie=value';

            const sessionId = getSessionId();
            assert.strictEqual(sessionId, '1875166863447');
        });

        it('should prefer XSRF-TOKEN over com.td.last_login', () => {
            mockCookies =
                'com.td.last_login=1875166863447; XSRF-TOKEN=b37b6a1a-a25c-5dca-9799-ff4g0g22e666';

            const sessionId = getSessionId();
            assert.strictEqual(sessionId, 'b37b6a1a-a25c-5dca-9799-ff4g0g22e666');
        });

        it('should throw error when no session cookies are found', () => {
            mockCookies = 'other_cookie=value; another_cookie=data';

            assert.throws(
                () => getSessionId(),
                /TD WebBroker session not found/
            );
        });

        it('should throw error when cookies are empty', () => {
            mockCookies = '';

            assert.throws(
                () => getSessionId(),
                /TD WebBroker session not found/
            );
        });
    });

    describe('getProfile', () => {
        it('should extract profile information from wrapped response format', async () => {
            const mockApiResponse = {
                version: 'v1.0',
                correlationId: '1e6e0a53-bf2d-37d5-4g97-30403c55b286',
                authorizationToken: 'SOC||1875166863447||2254f485-1g60-5282-b388-cc7d0dg630fc',
                systemTimestamp: '2025-11-25T02:30:23-0500',
                payload: {
                    connectId: 'J185L5R6',
                    subscriptions: ['STATEMENT', 'CONFIRMATION', 'TAX'],
                    status: 'REGISTERED',
                    email: 'JOHN.DOE@EXAMPLE.COM',
                    taxFreeze: false,
                },
                status: 'SUCCESS',
            };

            mockFetch.mock.mockImplementationOnce(() =>
                Promise.resolve({
                    ok: true,
                    json: () => Promise.resolve(mockApiResponse),
                })
            );

            const profile = await getProfile('test-session-id');

            assert.deepStrictEqual(profile, {
                sessionId: 'test-session-id',
                profileId: 'J185L5R6',
                profileName: 'JOHN.DOE@EXAMPLE.COM',
            });

            const calls = mockFetch.mock.calls;
            assert.strictEqual(calls.length, 1);
            assert.strictEqual(
                calls[0].arguments[0],
                'https://webbroker.td.com/waw/brk/wb/services/rest/v1/eservices/profile?AJAXREQUEST=1'
            );
            assert.strictEqual(calls[0].arguments[1].method, 'GET');
            assert.strictEqual(calls[0].arguments[1].credentials, 'include');
        });

        it('should extract profile information from direct response format', async () => {
            // Direct format observed during browser validation
            const mockApiResponse = {
                connectId: 'J185L5R6',
                subscriptions: ['STATEMENT', 'CONFIRMATION', 'TAX'],
                status: 'REGISTERED',
                email: 'JOHN.DOE@EXAMPLE.COM',
                taxFreeze: false,
            };

            mockFetch.mock.mockImplementationOnce(() =>
                Promise.resolve({
                    ok: true,
                    json: () => Promise.resolve(mockApiResponse),
                })
            );

            const profile = await getProfile('test-session-id');

            assert.deepStrictEqual(profile, {
                sessionId: 'test-session-id',
                profileId: 'J185L5R6',
                profileName: 'JOHN.DOE@EXAMPLE.COM',
            });
        });

        it('should use connectId as profileName when email is not provided', async () => {
            const mockApiResponse = {
                connectId: 'J185L5R6',
                status: 'REGISTERED',
            };

            mockFetch.mock.mockImplementationOnce(() =>
                Promise.resolve({
                    ok: true,
                    json: () => Promise.resolve(mockApiResponse),
                })
            );

            const profile = await getProfile('test-session-id');

            assert.strictEqual(profile.profileName, 'J185L5R6');
        });

        it('should throw error when connectId is missing', async () => {
            const mockApiResponse = {
                email: 'user@email.com',
                status: 'REGISTERED',
            };

            mockFetch.mock.mockImplementationOnce(() =>
                Promise.resolve({
                    ok: true,
                    json: () => Promise.resolve(mockApiResponse),
                })
            );

            await assert.rejects(
                () => getProfile('test-session-id'),
                /Profile API returned no valid data/
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
                () => getProfile('test-session-id'),
                /Failed to get profile: 401 Unauthorized/
            );
        });

        it('should throw error on network failure', async () => {
            mockFetch.mock.mockImplementationOnce(() =>
                Promise.reject(new Error('Network error'))
            );

            await assert.rejects(
                () => getProfile('test-session-id'),
                /Network error/
            );
        });
    });

    describe('getAccounts', () => {
        const mockProfile = {
            sessionId: 'test-session-id',
            profileId: 'J185L5R6',
            profileName: 'JOHN.DOE@EXAMPLE.COM',
        };

        it('should extract accounts from wrapped response format', async () => {
            const mockApiResponse = {
                version: 'v1.0',
                payload: [
                    {
                        favorite: true,
                        groupNumber: '80XCK0',
                        groupId: 'DEY-RIBe_TlQMPKhpg_gXOqXNeKnm8f0V2OYXe2xTSR',
                        businessLine: 'TD Direct Investing',
                        divisionType: 'RAPID_MARKET_ACCESS',
                        tradingPlatform: 'WEBBROKER',
                        accountPlatform: 'DIRECT_INVESTMENT',
                    },
                ],
                status: 'SUCCESS',
            };

            mockFetch.mock.mockImplementationOnce(() =>
                Promise.resolve({
                    ok: true,
                    json: () => Promise.resolve(mockApiResponse),
                })
            );

            const accounts = await getAccounts(mockProfile);

            assert.strictEqual(accounts.length, 1);
            assert.deepStrictEqual(accounts[0], {
                profile: mockProfile,
                accountId: 'DEY-RIBe_TlQMPKhpg_gXOqXNeKnm8f0V2OYXe2xTSR',
                accountName: 'TD Direct Investing',
                accountMask: '80XCK0',
                accountType: 'Investment',
            });

            const calls = mockFetch.mock.calls;
            assert.strictEqual(calls.length, 1);
            assert.strictEqual(
                calls[0].arguments[0],
                'https://webbroker.td.com/waw/brk/wb/services/rest/v2/accountsV2/account-groups?filter=ESERVICES_STATEMENTS_FILTER&AJAXREQUEST=1'
            );
        });

        it('should extract accounts from direct array format', async () => {
            // Direct array format observed during browser validation
            const mockApiResponse = [
                {
                    favorite: true,
                    groupNumber: '80XCK0',
                    groupId: 'DEY-RIBe_TlQMPKhpg_gXOqXNeKnm8f0V2OYXe2xTSR',
                    businessLine: 'TD Direct Investing',
                    divisionType: 'RAPID_MARKET_ACCESS',
                    tradingPlatform: 'WEBBROKER',
                    accountPlatform: 'DIRECT_INVESTMENT',
                },
            ];

            mockFetch.mock.mockImplementationOnce(() =>
                Promise.resolve({
                    ok: true,
                    json: () => Promise.resolve(mockApiResponse),
                })
            );

            const accounts = await getAccounts(mockProfile);

            assert.strictEqual(accounts.length, 1);
            assert.strictEqual(accounts[0].accountId, 'DEY-RIBe_TlQMPKhpg_gXOqXNeKnm8f0V2OYXe2xTSR');
            assert.strictEqual(accounts[0].accountName, 'TD Direct Investing');
            assert.strictEqual(accounts[0].accountMask, '80XCK0');
        });

        it('should handle multiple account groups', async () => {
            const mockApiResponse = [
                {
                    groupNumber: '80XCK0',
                    groupId: 'hspvq-je-2',
                    businessLine: 'TD Direct Investing',
                },
                {
                    groupNumber: '23BCD4',
                    groupId: 'hspvq-je-3',
                    businessLine: 'TD Waterhouse',
                },
            ];

            mockFetch.mock.mockImplementationOnce(() =>
                Promise.resolve({
                    ok: true,
                    json: () => Promise.resolve(mockApiResponse),
                })
            );

            const accounts = await getAccounts(mockProfile);

            assert.strictEqual(accounts.length, 2);
            assert.strictEqual(accounts[0].accountMask, '80XCK0');
            assert.strictEqual(accounts[1].accountMask, '23BCD4');
            assert.strictEqual(accounts[1].accountName, 'TD Waterhouse');
        });

        it('should return empty array when no accounts found', async () => {
            const mockApiResponse = {
                payload: [],
                status: 'SUCCESS',
            };

            mockFetch.mock.mockImplementationOnce(() =>
                Promise.resolve({
                    ok: true,
                    json: () => Promise.resolve(mockApiResponse),
                })
            );

            const accounts = await getAccounts(mockProfile);

            assert.strictEqual(accounts.length, 0);
        });

        it('should throw error when API returns invalid data format', async () => {
            const mockApiResponse = {
                payload: 'invalid',
                status: 'SUCCESS',
            };

            mockFetch.mock.mockImplementationOnce(() =>
                Promise.resolve({
                    ok: true,
                    json: () => Promise.resolve(mockApiResponse),
                })
            );

            await assert.rejects(
                () => getAccounts(mockProfile),
                /Accounts API returned invalid data format/
            );
        });

        it('should throw error when API request fails', async () => {
            mockFetch.mock.mockImplementationOnce(() =>
                Promise.resolve({
                    ok: false,
                    status: 500,
                    statusText: 'Internal Server Error',
                })
            );

            await assert.rejects(
                () => getAccounts(mockProfile),
                /Failed to get accounts: 500 Internal Server Error/
            );
        });
    });

    describe('getStatements', () => {
        const mockProfile = {
            sessionId: 'test-session-id',
            profileId: 'J185L5R6',
            profileName: 'JOHN.DOE@EXAMPLE.COM',
        };

        const mockAccount = {
            profile: mockProfile,
            accountId: 'DEY-RIBe_TlQMPKhpg_gXOqXNeKnm8f0V2OYXe2xTSR',
            accountName: 'TD Direct Investing',
            accountMask: '80XCK0',
            accountType: /** @type {const} */ ('Investment'),
        };

        it('should retrieve statements from wrapped response format', async () => {
            const mockApiResponse = {
                version: 'v1.0',
                payload: {
                    documents: [
                        {
                            documentType: 'STATEMENT',
                            id: 'GB70F821BFB87C59DB7532DCG3261EE6F0F9E431G19636G5',
                            seq: 'taN2sSr1ndBxg1I-RYOKIOu56HIw74jyLFkoakRBTcV',
                            fileType: 'PDF',
                            runDate: '2025-11-05T18:58:00-0500',
                            states: {
                                PERFORMANCE_AND_FEES: false,
                                REVISED: false,
                                DORMANT: false,
                            },
                            descriptionCode: 'DIRECT_TRADE_CAD',
                            stmtDate: '2025-10-01T00:00:00-0400',
                            mimeType: 'application/pdf',
                            docType: 'STATEMENT',
                            groupNumber: '80XCK0',
                            rrCode: 'RM01',
                        },
                    ],
                },
                status: 'SUCCESS',
            };

            mockFetch.mock.mockImplementationOnce(() =>
                Promise.resolve({
                    ok: true,
                    json: () => Promise.resolve(mockApiResponse),
                })
            );

            const statements = await getStatements(mockAccount);

            assert.strictEqual(statements.length, 1);
            assert.strictEqual(statements[0].statementDate, '2025-10-01T00:00:00-0400');
            assert.strictEqual(statements[0].account, mockAccount);

            // Verify statementId contains necessary info for download
            const docInfo = JSON.parse(statements[0].statementId);
            assert.strictEqual(docInfo.id, 'GB70F821BFB87C59DB7532DCG3261EE6F0F9E431G19636G5');
            assert.strictEqual(docInfo.seq, 'taN2sSr1ndBxg1I-RYOKIOu56HIw74jyLFkoakRBTcV');
            assert.strictEqual(docInfo.descriptionCode, 'DIRECT_TRADE_CAD');

            const calls = mockFetch.mock.calls;
            assert.strictEqual(calls.length, 1);
            assert.ok(calls[0].arguments[0].includes('/v1/eservices/statements/'));
            assert.ok(calls[0].arguments[0].includes('DEY-RIBe_TlQMPKhpg_gXOqXNeKnm8f0V2OYXe2xTSR'));
        });

        it('should retrieve statements from direct response format', async () => {
            // Direct format observed during browser validation
            const mockApiResponse = {
                documents: [
                    {
                        documentType: 'STATEMENT',
                        id: 'GB70F821BFB87C59DB7532DCG3261EE6F0F9E431G19636G5',
                        seq: 'taN2sSr1ndBxg1I-RYOKIOu56HIw74jyLFkoakRBTcV',
                        fileType: 'PDF',
                        runDate: '2025-11-05T18:58:00-0500',
                        states: {
                            PERFORMANCE_AND_FEES: false,
                            REVISED: false,
                            DORMANT: false,
                        },
                        descriptionCode: 'DIRECT_TRADE_CAD',
                        stmtDate: '2025-09-01T00:00:00-0400',
                        mimeType: 'application/pdf',
                        docType: 'STATEMENT',
                        groupNumber: '80XCK0',
                        rrCode: 'RM01',
                    },
                ],
            };

            mockFetch.mock.mockImplementationOnce(() =>
                Promise.resolve({
                    ok: true,
                    json: () => Promise.resolve(mockApiResponse),
                })
            );

            const statements = await getStatements(mockAccount);

            assert.strictEqual(statements.length, 1);
            assert.strictEqual(statements[0].statementDate, '2025-09-01T00:00:00-0400');
        });

        it('should handle multiple statements', async () => {
            const mockApiResponse = {
                documents: [
                    {
                        documentType: 'STATEMENT',
                        id: 'epd-je-2',
                        seq: 'tfr-2',
                        fileType: 'PDF',
                        runDate: '2025-11-05T18:58:00-0500',
                        states: { PERFORMANCE_AND_FEES: false, REVISED: false, DORMANT: false },
                        descriptionCode: 'DIRECT_TRADE_CAD',
                        stmtDate: '2025-10-01T00:00:00-0400',
                        mimeType: 'application/pdf',
                        docType: 'STATEMENT',
                        groupNumber: '80XCK0',
                        rrCode: 'RM01',
                    },
                    {
                        documentType: 'STATEMENT',
                        id: 'epd-je-3',
                        seq: 'tfr-3',
                        fileType: 'PDF',
                        runDate: '2025-10-05T18:58:00-0500',
                        states: { PERFORMANCE_AND_FEES: false, REVISED: false, DORMANT: false },
                        descriptionCode: 'DIRECT_TRADE_CAD',
                        stmtDate: '2025-09-01T00:00:00-0400',
                        mimeType: 'application/pdf',
                        docType: 'STATEMENT',
                        groupNumber: '80XCK0',
                        rrCode: 'RM01',
                    },
                ],
            };

            mockFetch.mock.mockImplementationOnce(() =>
                Promise.resolve({
                    ok: true,
                    json: () => Promise.resolve(mockApiResponse),
                })
            );

            const statements = await getStatements(mockAccount);

            assert.strictEqual(statements.length, 2);
            assert.strictEqual(statements[0].statementDate, '2025-10-01T00:00:00-0400');
            assert.strictEqual(statements[1].statementDate, '2025-09-01T00:00:00-0400');
        });

        it('should handle USD account statements', async () => {
            const mockApiResponse = {
                documents: [
                    {
                        documentType: 'STATEMENT',
                        id: 'vte-epd-je',
                        seq: 'vte-tfr',
                        fileType: 'PDF',
                        runDate: '2025-11-05T18:58:00-0500',
                        states: { PERFORMANCE_AND_FEES: false, REVISED: false, DORMANT: false },
                        descriptionCode: 'DIRECT_TRADE_USD',
                        stmtDate: '2025-10-01T00:00:00-0400',
                        mimeType: 'application/pdf',
                        docType: 'STATEMENT',
                        groupNumber: '80XCK0',
                        rrCode: 'RM01',
                    },
                ],
            };

            mockFetch.mock.mockImplementationOnce(() =>
                Promise.resolve({
                    ok: true,
                    json: () => Promise.resolve(mockApiResponse),
                })
            );

            const statements = await getStatements(mockAccount);

            assert.strictEqual(statements.length, 1);
            const docInfo = JSON.parse(statements[0].statementId);
            assert.strictEqual(docInfo.descriptionCode, 'DIRECT_TRADE_USD');
        });

        it('should return empty array when no statements found', async () => {
            const mockApiResponse = {
                documents: [],
            };

            mockFetch.mock.mockImplementationOnce(() =>
                Promise.resolve({
                    ok: true,
                    json: () => Promise.resolve(mockApiResponse),
                })
            );

            const statements = await getStatements(mockAccount);

            assert.strictEqual(statements.length, 0);
        });

        it('should handle empty payload in wrapped response', async () => {
            const mockApiResponse = {
                payload: {},
                status: 'SUCCESS',
            };

            mockFetch.mock.mockImplementationOnce(() =>
                Promise.resolve({
                    ok: true,
                    json: () => Promise.resolve(mockApiResponse),
                })
            );

            const statements = await getStatements(mockAccount);

            assert.strictEqual(statements.length, 0);
        });

        it('should throw error when API request fails', async () => {
            mockFetch.mock.mockImplementationOnce(() =>
                Promise.resolve({
                    ok: false,
                    status: 404,
                    statusText: 'Not Found',
                })
            );

            await assert.rejects(
                () => getStatements(mockAccount),
                /Failed to get statements: 404 Not Found/
            );
        });

        it('should include date range in request URL', async () => {
            const mockApiResponse = { documents: [] };

            mockFetch.mock.mockImplementationOnce(() =>
                Promise.resolve({
                    ok: true,
                    json: () => Promise.resolve(mockApiResponse),
                })
            );

            await getStatements(mockAccount);

            const calls = mockFetch.mock.calls;
            const url = calls[0].arguments[0];
            assert.ok(url.includes('fromDate='));
            assert.ok(url.includes('toDate='));
            assert.ok(url.includes('AJAXREQUEST=1'));
        });
    });

    describe('downloadStatement', () => {
        const mockProfile = {
            sessionId: 'test-session-id',
            profileId: 'J185L5R6',
            profileName: 'JOHN.DOE@EXAMPLE.COM',
        };

        const mockAccount = {
            profile: mockProfile,
            accountId: 'DEY-RIBe_TlQMPKhpg_gXOqXNeKnm8f0V2OYXe2xTSR',
            accountName: 'TD Direct Investing',
            accountMask: '80XCK0',
            accountType: /** @type {const} */ ('Investment'),
        };

        const mockDocInfo = {
            documentType: 'STATEMENT',
            id: 'GB70F821BFB87C59DB7532DCG3261EE6F0F9E431G19636G5',
            seq: 'taN2sSr1ndBxg1I-RYOKIOu56HIw74jyLFkoakRBTcV',
            fileType: 'PDF',
            runDate: '2025-11-05T18:58:00-0500',
            states: {
                PERFORMANCE_AND_FEES: false,
                REVISED: false,
                DORMANT: false,
            },
            descriptionCode: 'DIRECT_TRADE_CAD',
            stmtDate: '2025-10-01T00:00:00-0400',
            mimeType: 'application/pdf',
            docType: 'STATEMENT',
            groupNumber: '80XCK0',
            rrCode: 'RM01',
        };

        const mockStatement = {
            account: mockAccount,
            statementId: JSON.stringify(mockDocInfo),
            statementDate: '2025-10-01T00:00:00-0400',
        };

        it('should download statement PDF successfully', async () => {
            const mockPdfBlob = new Blob(['%PDF-1.4 mock pdf content'], {
                type: 'application/pdf',
            });

            mockFetch.mock.mockImplementationOnce(() =>
                Promise.resolve({
                    ok: true,
                    headers: new Headers({ 'Content-Type': 'application/pdf' }),
                    blob: () => Promise.resolve(mockPdfBlob),
                })
            );

            const blob = await downloadStatement(mockStatement);

            assert.strictEqual(blob.type, 'application/pdf');
            assert.ok(blob.size > 0);

            const calls = mockFetch.mock.calls;
            assert.strictEqual(calls.length, 1);
            assert.strictEqual(
                calls[0].arguments[0],
                'https://webbroker.td.com/waw/brk/wb/services/rest/v1/export'
            );
            assert.strictEqual(calls[0].arguments[1].method, 'POST');
            assert.strictEqual(
                calls[0].arguments[1].headers['Content-Type'],
                'application/x-www-form-urlencoded'
            );
        });

        it('should include correct export parameters in request body', async () => {
            const mockPdfBlob = new Blob(['%PDF-1.4'], { type: 'application/pdf' });

            mockFetch.mock.mockImplementationOnce(() =>
                Promise.resolve({
                    ok: true,
                    headers: new Headers({ 'Content-Type': 'application/pdf' }),
                    blob: () => Promise.resolve(mockPdfBlob),
                })
            );

            await downloadStatement(mockStatement);

            const calls = mockFetch.mock.calls;
            const body = calls[0].arguments[1].body;

            // Parse URL-encoded body
            const params = new URLSearchParams(body);
            const exportRequest = JSON.parse(params.get('exportRequest'));
            const exportParams = JSON.parse(params.get('exportParams'));

            assert.strictEqual(exportRequest.type, 'ESERVICES');
            assert.strictEqual(exportRequest.fileFormat, 'PDF');

            assert.strictEqual(exportParams.documentList.length, 1);
            assert.strictEqual(
                exportParams.documentList[0].id,
                'GB70F821BFB87C59DB7532DCG3261EE6F0F9E431G19636G5'
            );
            assert.strictEqual(exportParams.documentList[0].groupNumber, '80XCK0');
        });

        it('should convert date to UTC format for export API', async () => {
            const mockPdfBlob = new Blob(['%PDF-1.4'], { type: 'application/pdf' });

            mockFetch.mock.mockImplementationOnce(() =>
                Promise.resolve({
                    ok: true,
                    headers: new Headers({ 'Content-Type': 'application/pdf' }),
                    blob: () => Promise.resolve(mockPdfBlob),
                })
            );

            await downloadStatement(mockStatement);

            const calls = mockFetch.mock.calls;
            const body = calls[0].arguments[1].body;
            const params = new URLSearchParams(body);
            const exportParams = JSON.parse(params.get('exportParams'));

            // Dates should be in ISO UTC format
            assert.ok(exportParams.documentList[0].stmtDate.endsWith('Z'));
            assert.ok(exportParams.documentList[0].runDate.endsWith('Z'));
        });

        it('should include description from description code', async () => {
            const mockPdfBlob = new Blob(['%PDF-1.4'], { type: 'application/pdf' });

            mockFetch.mock.mockImplementationOnce(() =>
                Promise.resolve({
                    ok: true,
                    headers: new Headers({ 'Content-Type': 'application/pdf' }),
                    blob: () => Promise.resolve(mockPdfBlob),
                })
            );

            await downloadStatement(mockStatement);

            const calls = mockFetch.mock.calls;
            const body = calls[0].arguments[1].body;
            const params = new URLSearchParams(body);
            const exportParams = JSON.parse(params.get('exportParams'));

            assert.strictEqual(
                exportParams.documentList[0].description,
                'Direct Trading - Canadian Dollar'
            );
        });

        it('should handle USD description code', async () => {
            const usdDocInfo = { ...mockDocInfo, descriptionCode: 'DIRECT_TRADE_USD' };
            const usdStatement = {
                ...mockStatement,
                statementId: JSON.stringify(usdDocInfo),
            };

            const mockPdfBlob = new Blob(['%PDF-1.4'], { type: 'application/pdf' });

            mockFetch.mock.mockImplementationOnce(() =>
                Promise.resolve({
                    ok: true,
                    headers: new Headers({ 'Content-Type': 'application/pdf' }),
                    blob: () => Promise.resolve(mockPdfBlob),
                })
            );

            await downloadStatement(usdStatement);

            const calls = mockFetch.mock.calls;
            const body = calls[0].arguments[1].body;
            const params = new URLSearchParams(body);
            const exportParams = JSON.parse(params.get('exportParams'));

            assert.strictEqual(
                exportParams.documentList[0].description,
                'Direct Trading - US Dollar'
            );
        });

        it('should handle TFSA description code', async () => {
            const tfsaDocInfo = { ...mockDocInfo, descriptionCode: 'TFSA' };
            const tfsaStatement = {
                ...mockStatement,
                statementId: JSON.stringify(tfsaDocInfo),
            };

            const mockPdfBlob = new Blob(['%PDF-1.4'], { type: 'application/pdf' });

            mockFetch.mock.mockImplementationOnce(() =>
                Promise.resolve({
                    ok: true,
                    headers: new Headers({ 'Content-Type': 'application/pdf' }),
                    blob: () => Promise.resolve(mockPdfBlob),
                })
            );

            await downloadStatement(tfsaStatement);

            const calls = mockFetch.mock.calls;
            const body = calls[0].arguments[1].body;
            const params = new URLSearchParams(body);
            const exportParams = JSON.parse(params.get('exportParams'));

            assert.strictEqual(
                exportParams.documentList[0].description,
                'Tax-Free Savings Account'
            );
        });

        it('should use description code as fallback for unknown codes', async () => {
            const unknownDocInfo = { ...mockDocInfo, descriptionCode: 'UNKNOWN_CODE' };
            const unknownStatement = {
                ...mockStatement,
                statementId: JSON.stringify(unknownDocInfo),
            };

            const mockPdfBlob = new Blob(['%PDF-1.4'], { type: 'application/pdf' });

            mockFetch.mock.mockImplementationOnce(() =>
                Promise.resolve({
                    ok: true,
                    headers: new Headers({ 'Content-Type': 'application/pdf' }),
                    blob: () => Promise.resolve(mockPdfBlob),
                })
            );

            await downloadStatement(unknownStatement);

            const calls = mockFetch.mock.calls;
            const body = calls[0].arguments[1].body;
            const params = new URLSearchParams(body);
            const exportParams = JSON.parse(params.get('exportParams'));

            assert.strictEqual(exportParams.documentList[0].description, 'UNKNOWN_CODE');
        });

        it('should throw error when statementId is invalid JSON', async () => {
            const invalidStatement = {
                account: mockAccount,
                statementId: 'not-valid-json',
                statementDate: '2025-10-01T00:00:00-0400',
            };

            await assert.rejects(
                () => downloadStatement(invalidStatement),
                /Invalid statement ID format/
            );
        });

        it('should throw error when download request fails', async () => {
            mockFetch.mock.mockImplementationOnce(() =>
                Promise.resolve({
                    ok: false,
                    status: 500,
                    statusText: 'Internal Server Error',
                })
            );

            await assert.rejects(
                () => downloadStatement(mockStatement),
                /Failed to download statement: 500 Internal Server Error/
            );
        });

        it('should throw error when content type is not PDF', async () => {
            mockFetch.mock.mockImplementationOnce(() =>
                Promise.resolve({
                    ok: true,
                    headers: new Headers({ 'Content-Type': 'text/html' }),
                    blob: () => Promise.resolve(new Blob(['<html></html>'])),
                })
            );

            await assert.rejects(
                () => downloadStatement(mockStatement),
                /Unexpected content type: text\/html/
            );
        });

        it('should throw error when content type is missing', async () => {
            mockFetch.mock.mockImplementationOnce(() =>
                Promise.resolve({
                    ok: true,
                    headers: new Headers({}),
                    blob: () => Promise.resolve(new Blob(['data'])),
                })
            );

            await assert.rejects(
                () => downloadStatement(mockStatement),
                /Unexpected content type/
            );
        });
    });

    describe('Error Handling', () => {
        it('should handle network errors gracefully', async () => {
            mockFetch.mock.mockImplementationOnce(() =>
                Promise.reject(new Error('Network error'))
            );

            await assert.rejects(
                () => getProfile('test-session-id'),
                /Network error/
            );
        });

        it('should handle JSON parsing errors', async () => {
            mockFetch.mock.mockImplementationOnce(() =>
                Promise.resolve({
                    ok: true,
                    json: () => Promise.reject(new Error('Invalid JSON')),
                })
            );

            await assert.rejects(
                () => getProfile('test-session-id'),
                /Invalid JSON/
            );
        });
    });
});
