/**
 * Unit tests for First Tech Federal Credit Union bank statement API implementation
 * Tests cover checking, savings, and credit card account functionality
 * 
 * Note: All mock data is based on actual content from analyze/first_tech_fcu.har
 * to ensure tests match real API responses.
 */

import { describe, it, beforeEach, mock } from 'node:test';
import assert from 'node:assert/strict';

// Mock global fetch
const mockFetch = mock.fn();
global.fetch = mockFetch;

// Mock document.cookie for getSessionId
global.document = {
    cookie: 'cdContextId=test-context-id; other=value',
};

// Import the module after setting up mocks
const firstTechModule = await import('../bank/first_tech_fcu.mjs');
const { bankId, getSessionId, getProfile, getAccounts, getStatements, downloadStatement } = firstTechModule;

// Mock data based on actual HAR file responses
const mockDashboardHtml = `
<!DOCTYPE html>
<html>
<head><title>Dashboard</title></head>
<body>
    <header>
        <div class="header__profile-menu iris-list iris-list--navigable">
            <li class="profile-menu__username">
                <span class="profile-menu__text font-subtitle-1">John Doe</span>
            </li>
        </div>
    </header>
    <script src="/cfi/PostAuthContent/script.js?userId=d1331538-h76h-73d0-cc3-dhcce1ge916e"></script>
</body>
</html>
`;

const mockDocumentsData = {
    Accounts: [
        {
            ID: 3203579,
            AccountIdentifier: 'fg9i5gd7-09ic-757i-e5h6-39845i7d06dd',
            AccountNumber: '3669805642',
            DisplayAccountNumber: '\*5642',
            DisplayName: 'Dividend Rewards Checking',
            ThemeColorIndex: '1',
            AccountHolder: null,
            SubscriptionSetting: null,
        },
        {
            ID: 3203577,
            AccountIdentifier: '7fci93i4-6dc4-79eh-cde9-1if3466eic49',
            AccountNumber: '3669805624',
            DisplayAccountNumber: '\*5624',
            DisplayName: 'Membership Savings J',
            ThemeColorIndex: '5',
            AccountHolder: null,
            SubscriptionSetting: null,
        },
        {
            ID: 4654346,
            AccountIdentifier: 'd4687c89-fd13-7454-e6cf-0igg1feg9797',
            AccountNumber: '3675469489',
            DisplayAccountNumber: '\*9489',
            DisplayName: 'Membership Savings E',
            ThemeColorIndex: '4',
            AccountHolder: null,
            SubscriptionSetting: null,
        },
        {
            ID: 4654347,
            AccountIdentifier: 'e5798d90-ge24-8565-d7fg-1jhh2gfh0808',
            AccountNumber: '***********\*4977',
            DisplayAccountNumber: '\*4977',
            DisplayName: 'Platinum Mastercard',
            ThemeColorIndex: '2',
            AccountHolder: null,
            SubscriptionSetting: null,
        },
    ],
    DocumentListings: [
        {
            Account: '1558794523',
            AccountId: null,
            AccountDisplayName: 'Membership Savings J',
            DisplayAccountNumber: '\*5624',
            DocumentDate: '2025/10/31',
            DocumentDateString: null,
            Name: 'Member Combined Statement',
            ThemeColorIndex: 5,
            Type: 'Monthly/Quarterly',
            DocumentTypeId: 25,
            Url: 'eDocs/GetDocument?providerId=818&documentKey=7B757E56...',
            Unread: null,
            ProviderId: 818,
            Key: '9D979G7800640H94E97056097880786D00917985516E00968D6G968781B29989708931G6765C905E887970E3607G7B805F8869691RMdusvmHcO94vwh4MD6MD4VIO0495VGE6ZCFR8Z8E47K6UAUVFMFOV9ZT4SN448XNP7WPgTF4QGDpPN0P048LC89072QZAL59',
            IsSingleUseUrl: true,
        },
        {
            Account: '3669805624',
            AccountId: null,
            AccountDisplayName: 'Membership Savings J',
            DisplayAccountNumber: '\*5624',
            DocumentDate: '2025/09/30',
            DocumentDateString: null,
            Name: 'Member Combined Statement',
            ThemeColorIndex: 5,
            Type: 'Monthly/Quarterly',
            DocumentTypeId: 25,
            Url: 'eDocs/GetDocument?providerId=818&documentKey=7B757E56...',
            Unread: null,
            ProviderId: 818,
            Key: '0E080H8911751I05F08167108991897E11028096627F11079E7H079892C30090819042H7876D016F998081F4718H8C916G9980802SNgvtwuId84uwh5NE7NE5WJP1506WGF7AEDSI9I9F58L7VBVWGNGPW0AV5TO559YOQ8XQhUG5RHEqQO1Q159MD90183RABN60',
            IsSingleUseUrl: true,
        },
        {
            Account: '3669805642',
            AccountId: null,
            AccountDisplayName: 'Dividend Rewards Checking',
            DisplayAccountNumber: '\*5642',
            DocumentDate: '2025/10/31',
            DocumentDateString: null,
            Name: 'Member Combined Statement',
            ThemeColorIndex: 1,
            Type: 'STMT',
            DocumentTypeId: 1,
            Url: 'eDocs/GetDocument?providerId=818&documentKey=6A646F45...',
            Unread: null,
            ProviderId: 818,
            Key: '1F191I0022862J16G19278219102908F22139207738G22190F8I190003D41201930153I8987E127G109192G5829I9D027H0091913TOhwuxvJe95vxi6OF8OF6XKQ2617XHG8BFETJ0J0G69M8WCWXHOHQX1BW6UP660ZPR9YRiVH6SIFrRP2R260OE01294SBCO71',
            IsSingleUseUrl: true,
        },
        {
            Account: '***********\*4977',
            AccountId: null,
            AccountDisplayName: 'Platinum Mastercard',
            DisplayAccountNumber: '\*4977',
            DocumentDate: '2025/11/02',
            DocumentDateString: null,
            Name: 'Credit Card Statement',
            ThemeColorIndex: 2,
            Type: 'Credit Cards',
            DocumentTypeId: 2,
            Url: 'eDocs/GetDocument?providerId=818&documentKey=7B757E56...',
            Unread: null,
            ProviderId: 818,
            Key: '2G202J1133973K27H20389320213019G33240318849H33301G9J301114E52312041264J9098F238H220303H6940J0E138I1102024UPixyxwKf06wyi7PG9PG7YLR3728YIH9CGFUK1K1H70N9XDXYIPIRYBX7VQ771AQS0ZSjWI7TJGsSQ3S371PF12405TCEP82',
            IsSingleUseUrl: true,
        },
        {
            Account: '3669805642',
            AccountId: null,
            AccountDisplayName: 'Dividend Rewards Checking',
            DisplayAccountNumber: '\*5642',
            DocumentDate: '2023/05/01',
            DocumentDateString: null,
            Name: 'NSF Notice',
            ThemeColorIndex: 1,
            Type: 'NSF',
            DocumentTypeId: 28,
            Url: 'eDocs/GetDocument?providerId=818&documentKey=6A646F45...',
            Unread: null,
            ProviderId: 818,
            Key: '3H313K2244084L38I31500431324130H44351429960I44412H0K412225F63423152375K0109G349I331414I7051K1F249J2213135VRmduyfmHc17vzj8QH0QH8ZMS4839ZJI0DHGVL2L2I81O0YEZJQJSZCZX8WR882BRT1ATkXJ8UKHtSR4T482QG23516UDGQ93',
            IsSingleUseUrl: true,
        },
        {
            Account: '3669805642',
            AccountId: null,
            AccountDisplayName: 'Dividend Rewards Checking',
            DisplayAccountNumber: '\*5642',
            DocumentDate: '2023/01/03',
            DocumentDateString: null,
            Name: '1099I',
            ThemeColorIndex: 1,
            Type: '1099',
            DocumentTypeId: 32,
            Url: 'eDocs/GetDocument?providerId=818&documentKey=7B757E56...',
            Unread: null,
            ProviderId: 818,
            Key: '4I424L3355195M49J42611542435241I55462540071J55523I1L523336G74534263486L1210H460J442525J8162L2G360K3324246WSnevzgnId28wak9RI1RI9ANT5950AKJ1EIHWM3M3J92P1ZFAKRKUDADA9XS993CSU2BUlYK9VLIuTS5U593RH34627VEHR04',
            IsSingleUseUrl: true,
        },
    ],
};

describe('First Tech Federal Credit Union API', () => {
    beforeEach(() => {
        // Reset fetch mock between tests for isolation
        mockFetch.mock.resetCalls();
    });

    describe('bankId', () => {
        it('should return the correct bank identifier', () => {
            assert.strictEqual(bankId, 'first_tech_fcu');
        });
    });

    describe('getSessionId', () => {
        it('should extract cdContextId cookie from document.cookie', () => {
            const sessionId = getSessionId();
            assert.strictEqual(sessionId, 'test-context-id');
        });

        it('should return empty string when cdContextId cookie is not found', () => {
            const originalCookie = document.cookie;
            document.cookie = 'other=value';

            const sessionId = getSessionId();
            assert.strictEqual(sessionId, '');

            document.cookie = originalCookie;
        });
    });

    describe('getProfile', () => {
        it('should extract profile information from dashboard HTML and fetch documents data', async () => {
            let callCount = 0;

            // Mock both responses in sequence
            mockFetch.mock.mockImplementation((url) => {
                callCount++;

                // First call: dashboard HTML
                if (callCount === 1) {
                    return Promise.resolve({
                        ok: true,
                        text: () => Promise.resolve(mockDashboardHtml),
                    });
                }

                // Second call: documents API
                if (callCount === 2) {
                    return Promise.resolve({
                        ok: true,
                        json: () => Promise.resolve(mockDocumentsData),
                    });
                }

                throw new Error(`Unexpected fetch call: ${url}`);
            });

            const profile = await getProfile('test-session-id');

            // Profile should contain serialized documents data
            assert.strictEqual(profile.sessionId, 'test-session-id');
            assert.strictEqual(profile.profileName, 'John Doe');

            // profileId should be serialized JSON of documents data
            const parsedProfileId = JSON.parse(profile.profileId);
            assert.strictEqual(parsedProfileId.Accounts.length, 4);
            assert.strictEqual(parsedProfileId.DocumentListings.length, 6);

            const calls = mockFetch.mock.calls;
            assert.strictEqual(calls.length, 2);

            // First call should be to dashboard
            assert.strictEqual(calls[0].arguments[0], 'https://banking.firsttechfed.com/DashboardV2');

            // Second call should be to GeteDocs
            assert.strictEqual(calls[1].arguments[0], 'https://banking.firsttechfed.com/eDocs/GeteDocs?accountIdentifier=undefined');
            assert.strictEqual(calls[1].arguments[1].headers['x-requested-with'], 'XMLHttpRequest');
        });

        it('should throw error when dashboard fetch fails', async () => {
            mockFetch.mock.mockImplementationOnce(() =>
                Promise.resolve({
                    ok: false,
                    status: 401,
                    statusText: 'Unauthorized',
                })
            );

            await assert.rejects(
                () => getProfile('test-session-id'),
                /Failed to get profile: Failed to fetch dashboard: 401 Unauthorized/
            );
        });

        it('should throw error when profile name is not found', async () => {
            const badHtml = '<html><body>No profile name here</body></html>';

            mockFetch.mock.mockImplementationOnce(() =>
                Promise.resolve({
                    ok: true,
                    text: () => Promise.resolve(badHtml),
                })
            );

            await assert.rejects(
                () => getProfile('test-session-id'),
                /Failed to get profile: Failed to extract profile name from dashboard HTML/
            );
        });

        it('should throw error when documents fetch fails', async () => {
            let callCount = 0;

            mockFetch.mock.mockImplementation(() => {
                callCount++;

                // First call: dashboard HTML succeeds
                if (callCount === 1) {
                    return Promise.resolve({
                        ok: true,
                        text: () => Promise.resolve(mockDashboardHtml),
                    });
                }

                // Second call: documents API fails
                if (callCount === 2) {
                    return Promise.resolve({
                        ok: false,
                        status: 500,
                        statusText: 'Internal Server Error',
                    });
                }
            });

            await assert.rejects(
                () => getProfile('test-session-id'),
                /Failed to get profile: Failed to fetch documents: 500 Internal Server Error/
            );
        });

        it('should throw error when documents response is invalid', async () => {
            let callCount = 0;

            mockFetch.mock.mockImplementation(() => {
                callCount++;

                // First call: dashboard HTML succeeds
                if (callCount === 1) {
                    return Promise.resolve({
                        ok: true,
                        text: () => Promise.resolve(mockDashboardHtml),
                    });
                }

                // Second call: documents API returns invalid data
                if (callCount === 2) {
                    return Promise.resolve({
                        ok: true,
                        json: () => Promise.resolve({ InvalidKey: [] }),
                    });
                }
            });

            await assert.rejects(
                () => getProfile('test-session-id'),
                /Failed to get profile: Invalid response format: missing Accounts array/
            );
        });
    });

    describe('getAccounts', () => {
        it('should deserialize accounts from profile.profileId', async () => {
            const profile = {
                sessionId: 'test-session-id',
                profileId: JSON.stringify(mockDocumentsData),
                profileName: 'John Doe',
            };

            const accounts = await getAccounts(profile);

            assert.strictEqual(accounts.length, 4);

            // Check checking account
            assert.strictEqual(accounts[0].accountId, '3669805642');
            assert.strictEqual(accounts[0].accountName, 'Dividend Rewards Checking');
            assert.strictEqual(accounts[0].accountMask, '\*5642');
            assert.strictEqual(accounts[0].accountType, 'Checking');
            assert.deepStrictEqual(accounts[0].profile, profile);

            // Check savings account
            assert.strictEqual(accounts[1].accountId, '3669805624');
            assert.strictEqual(accounts[1].accountName, 'Membership Savings J');
            assert.strictEqual(accounts[1].accountMask, '\*5624');
            assert.strictEqual(accounts[1].accountType, 'Savings');

            // Check credit card account
            assert.strictEqual(accounts[3].accountId, '***********\*4977');
            assert.strictEqual(accounts[3].accountName, 'Platinum Mastercard');
            assert.strictEqual(accounts[3].accountMask, '\*4977');
            assert.strictEqual(accounts[3].accountType, 'CreditCard');

            // No API calls should be made
            assert.strictEqual(mockFetch.mock.calls.length, 0);
        });

        it('should throw error when profileId is invalid JSON', async () => {
            const profile = {
                sessionId: 'test-session-id',
                profileId: 'invalid-json',
                profileName: 'John Doe',
            };

            await assert.rejects(
                () => getAccounts(profile),
                /Failed to get accounts/
            );
        });

        it('should throw error when profileId does not contain Accounts array', async () => {
            const profile = {
                sessionId: 'test-session-id',
                profileId: JSON.stringify({ InvalidKey: [] }),
                profileName: 'John Doe',
            };

            await assert.rejects(
                () => getAccounts(profile),
                /Failed to get accounts: Invalid profile data: missing Accounts array/
            );
        });
    });

    describe('getStatements', () => {
        it('should filter statements for a checking account', async () => {
            const profile = {
                sessionId: 'test-session-id',
                profileId: JSON.stringify(mockDocumentsData),
                profileName: 'John Doe',
            };

            const account = {
                profile,
                accountId: '3669805642',
                accountName: 'Dividend Rewards Checking',
                accountMask: '\*5642',
                accountType: 'Checking',
            };

            const statements = await getStatements(account);

            // Should only include actual statements (STMT type), not NSF or 1099
            assert.strictEqual(statements.length, 1);
            assert.strictEqual(statements[0].statementDate, '2025-10-31');
            assert.ok(statements[0].statementId.includes('818'));
            assert.ok(statements[0].statementId.includes('20251031'));
            assert.deepStrictEqual(statements[0].account, account);

            // No API calls should be made
            assert.strictEqual(mockFetch.mock.calls.length, 0);
        });

        it('should filter statements for a savings account', async () => {
            const profile = {
                sessionId: 'test-session-id',
                profileId: JSON.stringify(mockDocumentsData),
                profileName: 'John Doe',
            };

            const account = {
                profile,
                accountId: '3669805624',
                accountName: 'Membership Savings J',
                accountMask: '\*5624',
                accountType: 'Savings',
            };

            const statements = await getStatements(account);

            assert.strictEqual(statements.length, 2);
            assert.strictEqual(statements[0].statementDate, '2025-10-31');
            assert.strictEqual(statements[1].statementDate, '2025-09-30');
        });

        it('should filter statements for a credit card account with masked account number', async () => {
            const profile = {
                sessionId: 'test-session-id',
                profileId: JSON.stringify(mockDocumentsData),
                profileName: 'John Doe',
            };

            const account = {
                profile,
                accountId: '***********\*4977',
                accountName: 'Platinum Mastercard',
                accountMask: '\*4977',
                accountType: 'CreditCard',
            };

            const statements = await getStatements(account);

            // Should match by last 4 digits
            assert.strictEqual(statements.length, 1);
            assert.strictEqual(statements[0].statementDate, '2025-11-02');
            assert.ok(statements[0].statementId.includes('818'));
        });

        it('should return empty array when no statements match account', async () => {
            const profile = {
                sessionId: 'test-session-id',
                profileId: JSON.stringify(mockDocumentsData),
                profileName: 'John Doe',
            };

            const account = {
                profile,
                accountId: '9999999999',
                accountName: 'Non-existent Account',
                accountMask: '*9999',
                accountType: 'Checking',
            };

            const statements = await getStatements(account);

            assert.strictEqual(statements.length, 0);
        });

        it('should throw error when profileId is invalid', async () => {
            const profile = {
                sessionId: 'test-session-id',
                profileId: 'invalid-json',
                profileName: 'John Doe',
            };

            const account = {
                profile,
                accountId: '3669805642',
                accountName: 'Dividend Rewards Checking',
                accountMask: '\*5642',
                accountType: 'Checking',
            };

            await assert.rejects(
                () => getStatements(account),
                /Failed to get statements/
            );
        });

        it('should throw error when profileId does not contain DocumentListings array', async () => {
            const profile = {
                sessionId: 'test-session-id',
                profileId: JSON.stringify({ Accounts: [] }),
                profileName: 'John Doe',
            };

            const account = {
                profile,
                accountId: '3669805642',
                accountName: 'Dividend Rewards Checking',
                accountMask: '\*5642',
                accountType: 'Checking',
            };

            await assert.rejects(
                () => getStatements(account),
                /Failed to get statements: Invalid profile data: missing DocumentListings array/
            );
        });
    });

    describe('downloadStatement', () => {
        it('should download statement PDF with correct parameters', async () => {
            const mockPdfBlob = new Blob(['PDF content'], { type: 'application/pdf' });

            mockFetch.mock.mockImplementationOnce(() =>
                Promise.resolve({
                    ok: true,
                    headers: {
                        get: (name) => (name === 'content-type' ? 'application/pdf' : null),
                    },
                    blob: () => Promise.resolve(mockPdfBlob),
                })
            );

            const profile = {
                sessionId: 'test-session-id',
                profileId: JSON.stringify(mockDocumentsData),
                profileName: 'John Doe',
            };

            const account = {
                profile,
                accountId: '1558794541',
                accountName: 'Dividend Rewards Checking',
                accountMask: '\*4541',
                accountType: 'Checking',
            };

            const statement = {
                account,
                statementId: '818_8C868G6700529H83D86945986870786C_20251031',
                statementDate: '2025-10-31',
            };

            const blob = await downloadStatement(statement);

            assert.strictEqual(blob.type, 'application/pdf');
            assert.strictEqual(blob.size, mockPdfBlob.size);

            const calls = mockFetch.mock.calls;
            assert.strictEqual(calls.length, 1);

            const url = calls[0].arguments[0];
            assert.ok(url.includes('/eDocs/GetDocument'));
            assert.ok(url.includes('providerId=818'));
            assert.ok(url.includes('documentKey=8C868G6700529H83D86945986870786C'));

            const options = calls[0].arguments[1];
            assert.strictEqual(options.method, 'GET');
            assert.strictEqual(options.credentials, 'include');
            assert.strictEqual(options.headers.accept, 'application/pdf,*/*');
        });

        it('should throw error when statement ID format is invalid', async () => {
            const profile = {
                sessionId: 'test-session-id',
                profileId: JSON.stringify(mockDocumentsData),
                profileName: 'John Doe',
            };

            const account = {
                profile,
                accountId: '3669805642',
                accountName: 'Dividend Rewards Checking',
                accountMask: '\*5642',
                accountType: 'Checking',
            };

            const statement = {
                account,
                statementId: 'invalid',
                statementDate: '2025-10-31',
            };

            await assert.rejects(
                () => downloadStatement(statement),
                /Failed to download statement: Invalid statement ID format/
            );
        });

        it('should throw error when download fails', async () => {
            mockFetch.mock.mockImplementationOnce(() =>
                Promise.resolve({
                    ok: false,
                    status: 404,
                    statusText: 'Not Found',
                })
            );

            const profile = {
                sessionId: 'test-session-id',
                profileId: JSON.stringify(mockDocumentsData),
                profileName: 'John Doe',
            };

            const account = {
                profile,
                accountId: '1558794541',
                accountName: 'Dividend Rewards Checking',
                accountMask: '\*4541',
                accountType: 'Checking',
            };

            const statement = {
                account,
                statementId: '818_8C868G6700529H83D86945986870786C_20251031',
                statementDate: '2025-10-31',
            };

            await assert.rejects(
                () => downloadStatement(statement),
                /Failed to download statement: Failed to download statement: 404 Not Found/
            );
        });

        it('should throw error when content type is not PDF', async () => {
            mockFetch.mock.mockImplementationOnce(() =>
                Promise.resolve({
                    ok: true,
                    headers: {
                        get: (name) => (name === 'content-type' ? 'text/html' : null),
                    },
                    blob: () => Promise.resolve(new Blob(['<html>error</html>'])),
                })
            );

            const profile = {
                sessionId: 'test-session-id',
                profileId: JSON.stringify(mockDocumentsData),
                profileName: 'John Doe',
            };

            const account = {
                profile,
                accountId: '3669805642',
                accountName: 'Dividend Rewards Checking',
                accountMask: '\*5642',
                accountType: 'Checking',
            };

            const statement = {
                account,
                statementId: '818_9D979F6811640G72C86056097881897C_20251031',
                statementDate: '2025-10-31',
            };

            await assert.rejects(
                () => downloadStatement(statement),
                /Failed to download statement: Unexpected content type: text\/html\. Expected application\/pdf/
            );
        });

        it('should throw error when PDF is empty', async () => {
            mockFetch.mock.mockImplementationOnce(() =>
                Promise.resolve({
                    ok: true,
                    headers: {
                        get: (name) => (name === 'content-type' ? 'application/pdf' : null),
                    },
                    blob: () => Promise.resolve(new Blob([], { type: 'application/pdf' })),
                })
            );

            const profile = {
                sessionId: 'test-session-id',
                profileId: JSON.stringify(mockDocumentsData),
                profileName: 'John Doe',
            };

            const account = {
                profile,
                accountId: '3669805642',
                accountName: 'Dividend Rewards Checking',
                accountMask: '\*5642',
                accountType: 'Checking',
            };

            const statement = {
                account,
                statementId: '818_9D979F6811640G72C86056097881897C_20251031',
                statementDate: '2025-10-31',
            };

            await assert.rejects(
                () => downloadStatement(statement),
                /Failed to download statement: Downloaded PDF is empty/
            );
        });
    });
});
