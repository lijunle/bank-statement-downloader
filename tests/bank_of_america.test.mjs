/**
 * Unit tests for Bank of America API implementation
 * Tests cover checking, savings, and credit card accounts
 * 
 * Note: All mock data is based on actual content from analyze/bank_of_america.har
 * to ensure tests match real API responses.
 */

import { describe, it, beforeEach, mock } from 'node:test';
import assert from 'node:assert/strict';

// Mock global fetch
const mockFetch = mock.fn();
global.fetch = mockFetch;

// Mock document.cookie for getSessionId
global.document = {
    cookie: 'CSID=N3Z1RjU1RjEtMTdhNi01NzQxLTk0YjMtZ2QzZ2M4ODc2MTgzOjI4NzQzNzc4MjI5NzM=; other=value',
};

// Import the module after setting up mocks
const boaModule = await import('../bank/bank_of_america.mjs');
const { bankId, getSessionId, getProfile, getAccounts, getStatements, downloadStatement } = boaModule;

describe('Bank of America API', () => {
    beforeEach(() => {
        // Reset fetch mock between tests for isolation
        mockFetch.mock.resetCalls();
    });

    describe('bankId', () => {
        it('should return the correct bank identifier', () => {
            assert.strictEqual(bankId, 'bank_of_america');
        });
    });

    describe('getSessionId', () => {
        it('should extract CSID cookie from document.cookie', () => {
            const sessionId = getSessionId();
            assert.strictEqual(sessionId, 'N3Z1RjU1RjEtMTdhNi01NzQxLTk0YjMtZ2QzZ2M4ODc2MTgzOjI4NzQzNzc4MjI5NzM');
        });

        it('should throw error when CSID cookie is not found', () => {
            const originalCookie = document.cookie;
            document.cookie = 'other=value';

            assert.throws(() => getSessionId(), /CSID cookie not found/);

            document.cookie = originalCookie;
        });
    });

    describe('getProfile', () => {
        it('should extract profile information from accounts overview page', async () => {
            const mockHtml = `
                <html>
                <head>
                    <script>
                        profile.eligibility=11B111B111111B1B11BB11111111B1D11111BB111B111111BB1BB1111BB11P11B1111B1B1B11111111111111111111B11111111111111111111111111111111111BB11111BBB111111111111B11111B11111111B11B11111111111111111111111111111111111111B1111111111111111111111111111B1DEC2511E11;
                    </script>
                </head>
                <body>
                    <div class="name">Hello, John</div>
                </body>
                </html>
            `;

            mockFetch.mock.mockImplementationOnce(() =>
                Promise.resolve({
                    ok: true,
                    text: () => Promise.resolve(mockHtml),
                })
            );

            const profile = await getProfile('test-session-id');

            assert.deepStrictEqual(profile, {
                sessionId: 'test-session-id',
                profileId: '11B111B111111B1B11BB11111111B1D11111BB111B111111BB1BB1111BB11P11B1111B1B1B11111111111111111111B11111111111111111111111111111111111BB11111BBB111111111111B11111B11111111B11B11111111111111111111111111111111111111B1111111111111111111111111111B1DEC2511E11',
                profileName: 'John',
            });

            const calls = mockFetch.mock.calls;
            assert.strictEqual(calls.length, 1);
            assert.strictEqual(calls[0].arguments[0], 'https://secure.bankofamerica.com/myaccounts/brain/redirect.go?target=accountsoverview');
            assert.strictEqual(calls[0].arguments[1].method, 'GET');
            assert.strictEqual(calls[0].arguments[1].credentials, 'include');
        });

        it('should throw error when profile eligibility is not found', async () => {
            const mockHtml = '<html><body>No profile data</body></html>';

            mockFetch.mock.mockImplementationOnce(() =>
                Promise.resolve({
                    ok: true,
                    text: () => Promise.resolve(mockHtml),
                })
            );

            await assert.rejects(getProfile('test-session-id'), /Could not extract profileEligibilty/);
        });

        it('should handle fetch errors', async () => {
            mockFetch.mock.mockImplementationOnce(() =>
                Promise.resolve({
                    ok: false,
                    status: 401,
                    statusText: 'Unauthorized',
                })
            );

            await assert.rejects(getProfile('test-session-id'), /API request failed: 401 Unauthorized/);
        });
    });

    describe('getAccounts', () => {
        const mockProfile = {
            sessionId: 'test-session',
            profileId: 'test-profile',
            profileName: 'Test User',
        };

        it('should extract accounts from overview page and gatherDocuments API', async () => {
            const mockHtml = `
                <html>
                <body>
                    <div data-adx="8e7f38ed205caa842235fd3e505b4c4e23265302cd1e2e25711ce2777dfa5a61"></div>
                    <a href="?adx=1d9678a144208827504693d66f0bdc11cbfee7157006170e2e4408b16ef58e68"></a>
                </body>
                </html>
            `;

            const mockGatherResponse = {
                status: 'SUCCESS',
                accountList: [
                    {
                        accountDisplayName: 'Checking',
                        productCode: 'PER',
                        groupCode: 'DDA',
                        adx: '8e7f38ed205caa842235fd3e505b4c4e23265302cd1e2e25711ce2777dfa5a61',
                        creditCardAccountIndicator: false,
                    },
                    {
                        accountDisplayName: 'Cash Rewards J1 2741',
                        productCode: 'CCP',
                        groupCode: 'CCA',
                        adx: '1d9678a144208827504693d66f0bdc11cbfee7157006170e2e4408b16ef58e68',
                        creditCardAccountIndicator: true,
                    },
                ],
            };

            let callCount = 0;
            mockFetch.mock.mockImplementation(() => {
                callCount++;
                if (callCount === 1) {
                    return Promise.resolve({
                        ok: true,
                        text: () => Promise.resolve(mockHtml),
                    });
                } else {
                    return Promise.resolve({
                        ok: true,
                        json: () => Promise.resolve(mockGatherResponse),
                    });
                }
            });

            const accounts = await getAccounts(mockProfile);

            assert.strictEqual(accounts.length, 2);
            assert.strictEqual(accounts[0].accountId, '8e7f38ed205caa842235fd3e505b4c4e23265302cd1e2e25711ce2777dfa5a61');
            assert.strictEqual(accounts[0].accountName, 'Checking');
            assert.strictEqual(accounts[0].accountMask, '5a61');
            assert.strictEqual(accounts[0].accountType, 'Checking');
            assert.strictEqual(accounts[0].profile, mockProfile);

            assert.strictEqual(accounts[1].accountType, 'CreditCard');
            assert.strictEqual(accounts[1].accountMask, '2741');
        });

        it('should correctly identify savings accounts', async () => {
            const mockHtml = '<div data-adx="bcd234efa567bcd234efa567bcd234efa567bcd234efa567bcd234efa567bcde"></div>';
            const mockGatherResponse = {
                status: 'SUCCESS',
                accountList: [
                    {
                        accountDisplayName: 'Savings Account',
                        productCode: 'PER',
                        groupCode: 'SAV',
                        adx: 'bcd234efa567bcd234efa567bcd234efa567bcd234efa567bcd234efa567bcde',
                        creditCardAccountIndicator: false,
                    },
                ],
            };

            let callCount = 0;
            mockFetch.mock.mockImplementation(() => {
                callCount++;
                if (callCount === 1) {
                    return Promise.resolve({ ok: true, text: () => Promise.resolve(mockHtml) });
                } else {
                    return Promise.resolve({ ok: true, json: () => Promise.resolve(mockGatherResponse) });
                }
            });

            const accounts = await getAccounts(mockProfile);
            assert.strictEqual(accounts[0].accountType, 'Savings');
        });

        it('should throw error when no accounts found', async () => {
            const mockHtml = '<html><body>No accounts</body></html>';

            mockFetch.mock.mockImplementationOnce(() =>
                Promise.resolve({
                    ok: true,
                    text: () => Promise.resolve(mockHtml),
                })
            );

            await assert.rejects(getAccounts(mockProfile), /No accounts found/);
        });

        it('should throw error when gatherDocuments fails', async () => {
            const mockHtml = '<div data-adx="bcd234efa567bcd234efa567bcd234efa567bcd234efa567bcd234efa567bcde"></div>';
            const mockGatherResponse = {
                status: 'ERROR',
                errorInfo: [{ message: 'Invalid account' }],
            };

            let callCount = 0;
            mockFetch.mock.mockImplementation(() => {
                callCount++;
                if (callCount === 1) {
                    return Promise.resolve({ ok: true, text: () => Promise.resolve(mockHtml) });
                } else {
                    return Promise.resolve({ ok: true, json: () => Promise.resolve(mockGatherResponse) });
                }
            });

            await assert.rejects(getAccounts(mockProfile), /API returned error status: Invalid account/);
        });
    });

    describe('getStatements - Checking Account', () => {
        const mockAccount = {
            profile: { sessionId: 'test', profileId: 'test', profileName: 'Test' },
            accountId: '8e7f38ed205caa842235fd3e505b4c4e23265302cd1e2e25711ce2777dfa5a61',
            accountName: 'Checking',
            accountMask: 'c5a61',
            accountType: 'Checking',
        };

        it('should retrieve checking account statements for multiple years', async () => {
            const mockResponse2025 = {
                status: 'SUCCESS',
                documentList: [
                    {
                        docId: '202521212025213020653733392741020021',
                        docCategoryId: 'DISPFLD001',
                        docCategory: 'Statements',
                        adx: '8e7f38ed205caa842235fd3e505b4c4e23265302cd1e2e25711ce2777dfa5a61',
                        date: '2025-10-28T00:00:00.000+0000',
                    },
                    {
                        docId: '202520102025103020661483393291020021',
                        docCategoryId: 'DISPFLD001',
                        docCategory: 'Statements',
                        adx: '8e7f38ed205caa842235fd3e505b4c4e23265302cd1e2e25711ce2777dfa5a61',
                        date: '2025-09-28T00:00:00.000+0000',
                    },
                ],
            };

            const mockResponse2024 = {
                status: 'SUCCESS',
                documentList: [
                    {
                        docId: '202423212024233020653733392741020021',
                        docCategoryId: 'DISPFLD001',
                        docCategory: 'Statements',
                        adx: '8e7f38ed205caa842235fd3e505b4c4e23265302cd1e2e25711ce2777dfa5a61',
                        date: '2024-12-28T00:00:00.000+0000',
                    },
                ],
            };

            let callCount = 0;
            mockFetch.mock.mockImplementation(() => {
                callCount++;
                if (callCount === 1) {
                    return Promise.resolve({ ok: true, json: () => Promise.resolve(mockResponse2025) });
                } else if (callCount === 2) {
                    return Promise.resolve({ ok: true, json: () => Promise.resolve(mockResponse2024) });
                } else {
                    return Promise.resolve({ ok: true, json: () => Promise.resolve({ status: 'SUCCESS', documentList: [] }) });
                }
            });

            const statements = await getStatements(mockAccount);

            assert.strictEqual(statements.length, 3);

            // Verify statements are sorted by date descending (newest first)
            assert.strictEqual(statements[0].statementId, '8e7f38ed205caa842235fd3e505b4c4e23265302cd1e2e25711ce2777dfa5a61|202521212025213020653733392741020021');
            assert.strictEqual(statements[0].statementDate, new Date('2025-10-28T00:00:00.000+0000').toISOString());
            assert.strictEqual(statements[0].account, mockAccount);

            assert.strictEqual(statements[1].statementId, '8e7f38ed205caa842235fd3e505b4c4e23265302cd1e2e25711ce2777dfa5a61|202520102025103020661483393291020021');
            assert.strictEqual(statements[2].statementId, '8e7f38ed205caa842235fd3e505b4c4e23265302cd1e2e25711ce2777dfa5a61|202423212024233020653733392741020021');

            // Verify sorted in descending order
            assert.ok(new Date(statements[0].statementDate).getTime() > new Date(statements[1].statementDate).getTime());
            assert.ok(new Date(statements[1].statementDate).getTime() > new Date(statements[2].statementDate).getTime());

            // Verify API calls were made for current year and previous 2 years
            assert.strictEqual(mockFetch.mock.calls.length, 3);
        });

        it('should filter out non-statement documents', async () => {
            const mockResponse = {
                status: 'SUCCESS',
                documentList: [
                    {
                        docId: 'stmt-1',
                        docCategoryId: 'DISPFLD001',
                        docCategory: 'Statements',
                        adx: mockAccount.accountId,
                        date: '2025-10-28T00:00:00.000+0000',
                    },
                    {
                        docId: 'notice-1',
                        docCategoryId: 'DISPFLD002',
                        docCategory: 'Notifications',
                        adx: mockAccount.accountId,
                        date: '2025-10-15T00:00:00.000+0000',
                    },
                    {
                        docId: 'tax-1',
                        docCategoryId: 'DISPFLD004',
                        docCategory: 'Tax Statements',
                        adx: mockAccount.accountId,
                        date: '2025-01-01T00:00:00.000+0000',
                    },
                ],
            };

            // getStatements queries 3 years, so mock all 3 calls
            mockFetch.mock.mockImplementation(() =>
                Promise.resolve({ ok: true, json: () => Promise.resolve(mockResponse) })
            );

            const statements = await getStatements(mockAccount);
            // Each year returns 1 statement doc out of 3 total, so 3 years = 3 statements
            assert.strictEqual(statements.length, 3);
            assert.ok(statements[0].statementId.includes('stmt-1'));
        });

        it('should handle empty statement list', async () => {
            mockFetch.mock.mockImplementation(() =>
                Promise.resolve({
                    ok: true,
                    json: () => Promise.resolve({ status: 'SUCCESS', documentList: [] }),
                })
            );

            const statements = await getStatements(mockAccount);
            assert.strictEqual(statements.length, 0);
        });
    });

    describe('getStatements - Credit Card', () => {
        const mockAccount = {
            profile: { sessionId: 'test', profileId: 'test', profileName: 'Test' },
            accountId: '1d9678a144208827504693d66f0bdc11cbfee7157006170e2e4408b16ef58e68',
            accountName: 'Cash Rewards J1 2741',
            accountMask: '2741',
            accountType: 'CreditCard',
        };

        it('should retrieve credit card statements', async () => {
            const mockResponse = {
                status: 'SUCCESS',
                documentList: [
                    {
                        docId: '202520742025102016453036866421020061',
                        docCategoryId: 'DISPFLD001',
                        docCategory: 'Statements',
                        adx: '1d9678a144208827504693d66f0bdc11cbfee7157006170e2e4408b16ef58e68',
                        date: '2025-09-18T00:00:00.000+0000',
                        dateString: 'Sep 18, 2025',
                    },
                    {
                        docId: '202519282025192016531284841821020061',
                        docCategoryId: 'DISPFLD001',
                        docCategory: 'Statements',
                        adx: '1d9678a144208827504693d66f0bdc11cbfee7157006170e2e4408b16ef58e68',
                        date: '2025-08-18T00:00:00.000+0000',
                        dateString: 'Aug 18, 2025',
                    },
                ],
            };

            // getStatements queries 3 years (current + 2 previous)
            mockFetch.mock.mockImplementation(() =>
                Promise.resolve({ ok: true, json: () => Promise.resolve(mockResponse) })
            );

            const statements = await getStatements(mockAccount);

            assert.strictEqual(statements.length, 6);
            assert.strictEqual(statements[0].statementId, '1d9678a144208827504693d66f0bdc11cbfee7157006170e2e4408b16ef58e68|202520742025102016453036866421020061');
            assert.strictEqual(statements[0].statementDate, new Date('2025-09-18T00:00:00.000+0000').toISOString());
        });

        it('should parse dateString when date field is missing', async () => {
            const mockResponse = {
                status: 'SUCCESS',
                documentList: [
                    {
                        docId: 'stmt-1',
                        docCategoryId: 'DISPFLD001',
                        docCategory: 'Statements',
                        adx: mockAccount.accountId,
                        dateString: 'Oct 15, 2025',
                    },
                ],
            };

            // getStatements queries 3 years
            mockFetch.mock.mockImplementation(() =>
                Promise.resolve({ ok: true, json: () => Promise.resolve(mockResponse) })
            );

            const statements = await getStatements(mockAccount);
            assert.strictEqual(statements.length, 3);
            assert.strictEqual(typeof statements[0].statementDate, 'string');
            assert.strictEqual(new Date(statements[0].statementDate).getMonth(), 9); // October (0-indexed)
        });
    });

    describe('downloadStatement', () => {
        const mockAccount = {
            profile: { sessionId: 'test', profileId: 'test', profileName: 'Test' },
            accountId: '8e7f38ed205caa842235fd3e505b4c4e23265302cd1e2e25711ce2777dfa5a61',
            accountName: 'Checking',
            accountMask: 'c5a61',
            accountType: 'Checking',
        };

        const mockStatement = {
            account: mockAccount,
            statementId: '8e7f38ed205caa842235fd3e505b4c4e23265302cd1e2e25711ce2777dfa5a61|202521212025213020653733392741020021',
            statementDate: new Date(2025, 9, 28),
        };

        it('should download statement PDF with pre-download refresh', async () => {
            const pdfData = new Array(250000).fill(0); // Create realistic PDF size
            const mockPdfBlob = new Blob([new Uint8Array(pdfData)], { type: 'application/pdf' });

            let callCount = 0;
            mockFetch.mock.mockImplementation(() => {
                callCount++;
                if (callCount === 1) {
                    // Pre-download gatherDocuments refresh
                    return Promise.resolve({
                        ok: true,
                        json: () => Promise.resolve({ status: 'SUCCESS', documentList: [] }),
                    });
                } else {
                    // PDF download
                    return Promise.resolve({
                        ok: true,
                        blob: () => Promise.resolve(mockPdfBlob),
                        headers: {
                            get: (name) => {
                                if (name === 'content-type') return 'application/pdf';
                                return null;
                            },
                        },
                    });
                }
            });

            const blob = await downloadStatement(mockStatement);

            assert.strictEqual(blob, mockPdfBlob);
            assert.strictEqual(blob.size, 250000);

            // Verify API calls
            const calls = mockFetch.mock.calls;
            assert.strictEqual(calls.length, 2);

            // Verify pre-download refresh
            assert.strictEqual(
                calls[0].arguments[0],
                'https://secure.bankofamerica.com/mycommunications/omni/statements/rest/v1/gatherDocuments'
            );
            const refreshBody = JSON.parse(calls[0].arguments[1].body);
            assert.strictEqual(refreshBody.adx, mockAccount.accountId);
            assert.strictEqual(refreshBody.year, '2025');

            // Verify PDF download
            const downloadUrl = calls[1].arguments[0];
            assert.ok(downloadUrl.startsWith('https://secure.bankofamerica.com/mycommunications/omni/statements/rest/v1/docViewDownload'));
            assert.ok(downloadUrl.includes('adx=8e7f38ed205caa842235fd3e505b4c4e23265302cd1e2e25711ce2777dfa5a61'));
            assert.ok(downloadUrl.includes('documentId=202521212025213020653733392741020021'));
            assert.ok(downloadUrl.includes('adaDocumentFlag=N'));
            assert.ok(downloadUrl.includes('menuFlag=download'));
        });

        it('should proceed with download even if pre-refresh fails', async () => {
            const mockPdfBlob = new Blob([new Uint8Array(200000)], { type: 'application/pdf' });

            let callCount = 0;
            mockFetch.mock.mockImplementation(() => {
                callCount++;
                if (callCount === 1) {
                    // Pre-download refresh fails
                    return Promise.reject(new Error('Network error'));
                } else {
                    // PDF download succeeds
                    return Promise.resolve({
                        ok: true,
                        blob: () => Promise.resolve(mockPdfBlob),
                        headers: {
                            get: (name) => (name === 'content-type' ? 'application/pdf' : null),
                        },
                    });
                }
            });

            const blob = await downloadStatement(mockStatement);
            assert.strictEqual(blob, mockPdfBlob);
        });

        it('should throw error when PDF is too small and not PDF type', async () => {
            const mockSmallBlob = new Blob([new Uint8Array(5000)], { type: 'text/html' });

            let callCount = 0;
            mockFetch.mock.mockImplementation(() => {
                callCount++;
                if (callCount === 1) {
                    return Promise.resolve({ ok: true, json: () => Promise.resolve({ status: 'SUCCESS' }) });
                } else {
                    return Promise.resolve({
                        ok: true,
                        blob: () => Promise.resolve(mockSmallBlob),
                        headers: {
                            get: (name) => (name === 'content-type' ? 'text/html' : null),
                        },
                    });
                }
            });

            await assert.rejects(downloadStatement(mockStatement), /Download failed/);
        });

        it('should throw error when response is not a PDF', async () => {
            const mockHtmlBlob = new Blob([new Uint8Array(50000)], { type: 'text/html' });

            let callCount = 0;
            mockFetch.mock.mockImplementation(() => {
                callCount++;
                if (callCount === 1) {
                    return Promise.resolve({ ok: true, json: () => Promise.resolve({ status: 'SUCCESS' }) });
                } else {
                    return Promise.resolve({
                        ok: true,
                        blob: () => Promise.resolve(mockHtmlBlob),
                        headers: {
                            get: (name) => (name === 'content-type' ? 'text/html' : null),
                        },
                    });
                }
            });

            await assert.rejects(downloadStatement(mockStatement), /Download failed.*text\/html/);
        });

        it('should handle statement with separate adx in statementId', async () => {
            const mockPdfBlob = new Blob([new Uint8Array(200000)], { type: 'application/pdf' });
            const specialStatement = {
                account: mockAccount,
                statementId: 'ejggfsfoubey234|epdje567',
                statementDate: new Date(2025, 5, 15),
            };

            let callCount = 0;
            mockFetch.mock.mockImplementation(() => {
                callCount++;
                if (callCount === 1) {
                    return Promise.resolve({ ok: true, json: () => Promise.resolve({ status: 'SUCCESS' }) });
                } else {
                    return Promise.resolve({
                        ok: true,
                        blob: () => Promise.resolve(mockPdfBlob),
                        headers: {
                            get: (name) => (name === 'content-type' ? 'application/pdf' : null),
                        },
                    });
                }
            });

            await downloadStatement(specialStatement);

            const downloadUrl = mockFetch.mock.calls[1].arguments[0];
            assert.ok(downloadUrl.includes('adx=ejggfsfoubey234'));
            assert.ok(downloadUrl.includes('documentId=epdje567'));
        });
    });

    describe('Error Handling', () => {
        it('should throw error when fetch fails', async () => {
            const mockAccount = {
                profile: { sessionId: 'test', profileId: 'test', profileName: 'Test' },
                accountId: '23456',
                accountName: 'Test Account',
                accountMask: '2345',
                accountType: 'Checking',
            };

            mockFetch.mock.mockImplementation(() =>
                Promise.resolve({
                    ok: false,
                    status: 401,
                    statusText: 'Unauthorized',
                })
            );

            await assert.rejects(getStatements(mockAccount), /API request failed: 401 Unauthorized/);
        });

        it('should handle invalid response format', async () => {
            const mockAccount = {
                profile: { sessionId: 'test', profileId: 'test', profileName: 'Test' },
                accountId: '34567',
                accountName: 'Test Account',
                accountMask: '3456',
                accountType: 'Checking',
            };

            mockFetch.mock.mockImplementation(() =>
                Promise.resolve({
                    ok: true,
                    json: () => Promise.resolve(null),
                })
            );

            await assert.rejects(getStatements(mockAccount), /Invalid response format/);
        });

        it('should handle network errors', async () => {
            const mockAccount = {
                profile: { sessionId: 'test', profileId: 'test', profileName: 'Test' },
                accountId: '45678',
                accountName: 'Test Account',
                accountMask: '4567',
                accountType: 'Checking',
            };

            mockFetch.mock.mockImplementation(() => Promise.reject(new Error('Network error')));

            await assert.rejects(getStatements(mockAccount), /Network error/);
        });
    });
});
