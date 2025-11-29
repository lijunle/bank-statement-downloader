/**
 * Unit tests for US Bank statement API implementation
 * Tests cover all account types with GraphQL API calls
 * 
 * Note: All mock data is based on actual content from analyze/us_bank.md
 * to ensure tests match real API responses.
 */

import { describe, it, beforeEach, mock } from 'node:test';
import assert from 'node:assert/strict';

// Mock global fetch
const mockFetch = mock.fn();
global.fetch = mockFetch;

// Mock document.cookie for getSessionId
global.document = {
    cookie: 'PIM-SESSION-ID=s5X0cuVD7PgqXIvz; other=value; QuantumMetricSessionID=test',
};

// Mock sessionStorage for getAuthToken
global.sessionStorage = {
    getItem: mock.fn(() => '9cwMHi9B3hrluRwA0E6syHHvCQqc'),
};

// Mock localStorage for getUsername
global.localStorage = {
    getItem: mock.fn((key) => {
        if (key === 'users') {
            return JSON.stringify({
                '0': {
                    user_id: 'uftuVtfs',
                    guid: 'GE75GC5EE56CBFE631952E8BEGB0BD04',
                    device_id: '9e7e2g2f-5911-5dfb-bf24-de9924deggh0',
                    has_logged_in: true,
                },
                length: 1,
            });
        }
        return null;
    }),
};

// Import the module after setting up mocks
const usBankModule = await import('../bank/us_bank.mjs');
const { bankId, getSessionId, getProfile, getAccounts, getStatements, downloadStatement } = usBankModule;

describe('US Bank API', () => {
    beforeEach(() => {
        // Reset fetch mock between tests for isolation
        mockFetch.mock.resetCalls();
        global.sessionStorage.getItem.mock.resetCalls();
        global.localStorage.getItem.mock.resetCalls();
    });

    describe('bankId', () => {
        it('should return the correct bank identifier', () => {
            assert.strictEqual(bankId, 'us_bank');
        });
    });

    describe('getSessionId', () => {
        it('should extract PIM-SESSION-ID cookie from document.cookie', () => {
            const sessionId = getSessionId();
            assert.strictEqual(sessionId, 's5X0cuVD7PgqXIvz');
        });

        it('should throw error when PIM-SESSION-ID cookie is not found', () => {
            const originalCookie = document.cookie;
            document.cookie = 'other=value; QuantumMetricSessionID=test';

            assert.throws(() => getSessionId(), /PIM-SESSION-ID cookie not found/);

            document.cookie = originalCookie;
        });
    });

    describe('getProfile', () => {
        it('should retrieve profile information from GraphQL customer query', async () => {
            const mockResponse = {
                data: {
                    customer: {
                        customer: [
                            {
                                personal: [
                                    {
                                        customerType: {
                                            type: 'R',
                                            typeCode: 'R',
                                            isFCLOCCustomer: false,
                                        },
                                        hashedLegalParticipantID: '73E44G75D9EE220E8GB4B8B28349G843EEG96DD75EEDDDD1373344935D39660E4',
                                        acquisitionCode: null,
                                        preference: {
                                            language: {
                                                preferenceCode: '',
                                            },
                                        },
                                        dateOfBirth: null,
                                        birthdayIndicator: false,
                                        name: {
                                            fullName: 'John Doe',
                                            firstName: 'John',
                                            lastName: 'Doe',
                                        },
                                        relationship: {
                                            acquisitionCode: null,
                                            recordOpenDate: '2021-07-19 00:00:00',
                                        },
                                    },
                                ],
                                extendedProfile: {
                                    alliancePartners: [],
                                    profileType: {
                                        isEAAEligible: false,
                                        hasMGPAccess: false,
                                        isWealthCustomer: false,
                                        allianceUserType: 'NON_ALLIANCE',
                                    },
                                    wealthProfile: {
                                        isWealthCustomer: false,
                                        isWealthPlusCustomer: false,
                                        isRetailWealthCustomer: false,
                                    },
                                    restrictedRole: false,
                                    collaborator: 'USB',
                                },
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

            const profile = await getProfile('test-session-id');

            assert.deepStrictEqual(profile, {
                sessionId: 'test-session-id',
                profileId: '73E44G75D9EE220E8GB4B8B28349G843EEG96DD75EEDDDD1373344935D39660E4',
                profileName: 'John Doe',
            });

            // Verify API call
            const calls = mockFetch.mock.calls;
            assert.strictEqual(calls.length, 1);
            assert.strictEqual(
                calls[0].arguments[0],
                'https://onlinebanking.usbank.com/digital/api/customer-management/graphql/v2'
            );
            assert.strictEqual(calls[0].arguments[1].method, 'POST');
            assert.strictEqual(calls[0].arguments[1].headers['application-id'], 'WEBCD');
            assert.strictEqual(calls[0].arguments[1].headers['authorization'], 'Bearer 9cwMHi9B3hrluRwA0E6syHHvCQqc');

            const body = JSON.parse(calls[0].arguments[1].body);
            assert.strictEqual(body.operationName, 'customer');
            assert.strictEqual(body.variables.input.identifier, 'uftuVtfs');
            assert.strictEqual(body.variables.input.identifierType, 'UID');
        });

        it('should use username from localStorage as identifier', async () => {
            const mockResponse = {
                data: {
                    customer: {
                        customer: [
                            {
                                personal: [
                                    {
                                        hashedLegalParticipantID: 'TEST123',
                                        name: { fullName: 'Test User' },
                                    },
                                ],
                            },
                        ],
                    },
                },
            };

            mockFetch.mock.mockImplementationOnce(() =>
                Promise.resolve({ ok: true, json: () => Promise.resolve(mockResponse) })
            );

            await getProfile('session-123');

            const body = JSON.parse(mockFetch.mock.calls[0].arguments[1].body);
            assert.strictEqual(body.variables.input.identifier, 'uftuVtfs');
        });

        it('should throw error when localStorage users data is missing', async () => {
            const originalGetItem = global.localStorage.getItem;
            global.localStorage.getItem = mock.fn(() => null);

            await assert.rejects(getProfile('test-session'), /Failed to get profile.*Users data not found/);

            global.localStorage.getItem = originalGetItem;
        });

        it('should throw error when API returns invalid structure', async () => {
            mockFetch.mock.mockImplementationOnce(() =>
                Promise.resolve({ ok: true, json: () => Promise.resolve({ data: {} }) })
            );

            await assert.rejects(getProfile('test-session'), /Failed to get profile.*Invalid profile response/);
        });

        it('should throw error when AccessToken is missing', async () => {
            const originalGetItem = global.sessionStorage.getItem;
            global.sessionStorage.getItem = mock.fn(() => null);

            await assert.rejects(getProfile('test-session'), /AccessToken not found in sessionStorage/);

            global.sessionStorage.getItem = originalGetItem;
        });
    });

    describe('getAccounts', () => {
        const mockProfile = {
            sessionId: 'test-session',
            profileId: 'test-profile-id',
            profileName: 'Test User',
        };

        it('should retrieve all accounts with statement access', async () => {
            const mockResponse = {
                data: {
                    accounts: [
                        {
                            accountToken: '$vYsesMtpTY9yvbtKiDDwVGJUKOM1fq7FECVbFKBBIEmXLeIGD0N2gbNC9N5uxkxO',
                            productCode: 'CCD',
                            subProductCode: 'D7',
                            accountNumber: '7606',
                            adminToken: null,
                            displayName: 'Altitude Reserve J - 7606',
                            nickname: 'Altitude Reserve J',
                            accountType: 'Credit Card',
                            ownershipType: 'OWNED_INTERNAL',
                            relationshipCode: 'IND',
                        },
                        {
                            accountToken: '$fKguAGTDKtEjMn3uSqxRCH55lLQO8hMOJhJYNZ1wIO9p0EcJFpRGlHiPTmF77',
                            productCode: 'CCD',
                            subProductCode: 'D7',
                            accountNumber: '7340',
                            adminToken: null,
                            displayName: 'Cash Plus J - 7340',
                            nickname: 'Cash Plus J',
                            accountType: 'Credit Card',
                            ownershipType: 'OWNED_INTERNAL',
                            relationshipCode: 'IND',
                        },
                        {
                            accountToken: '$OtD7w9lgiJX1SqaUGwKpva9OuwejhnJ4TiEAnFZwXvq22pefgU4GcUVUE5Ihw3Et',
                            productCode: 'CCD',
                            subProductCode: 'D7',
                            accountNumber: '1075',
                            adminToken: null,
                            displayName: 'Altitude Connect J - 1075',
                            nickname: 'Altitude Connect J',
                            accountType: 'Credit Card',
                            ownershipType: 'OWNED_INTERNAL',
                            relationshipCode: 'IND',
                        },
                    ],
                },
            };

            mockFetch.mock.mockImplementationOnce(() =>
                Promise.resolve({
                    ok: true,
                    json: () => Promise.resolve(mockResponse),
                })
            );

            const accounts = await getAccounts(mockProfile);

            assert.strictEqual(accounts.length, 3);
            assert.strictEqual(accounts[0].accountId, '$vYsesMtpTY9yvbtKiDDwVGJUKOM1fq7FECVbFKBBIEmXLeIGD0N2gbNC9N5uxkxO');
            assert.strictEqual(accounts[0].accountName, 'Altitude Reserve J');
            assert.strictEqual(accounts[0].accountMask, '7606');
            assert.strictEqual(accounts[0].accountType, 'CreditCard');
            assert.strictEqual(accounts[0].profile, mockProfile);

            // Verify API call
            const calls = mockFetch.mock.calls;
            assert.strictEqual(calls.length, 1);
            assert.strictEqual(
                calls[0].arguments[0],
                'https://onlinebanking.usbank.com/digital/api/customer-management/graphql/v2'
            );

            const body = JSON.parse(calls[0].arguments[1].body);
            assert.strictEqual(body.operationName, 'accounts');
            assert.strictEqual(body.variables.accountInput.filters.filterKey, 'STATEMENTSACCESSIBLE');
            assert.strictEqual(body.variables.accountInput.identifierType, 'UID');
            assert.strictEqual(body.variables.accountInput.identifier, 'uftuVtfs');
        });

        it('should map different account types correctly', async () => {
            const mockResponse = {
                data: {
                    accounts: [
                        { accountToken: 'cc1', accountNumber: '1234', nickname: 'CC', accountType: 'Credit Card' },
                        { accountToken: 'chk1', accountNumber: '5678', nickname: 'CHK', accountType: 'Checking Account' },
                        { accountToken: 'sav1', accountNumber: '9000', nickname: 'SAV', accountType: 'Savings Account' },
                        { accountToken: 'ln1', accountNumber: '3456', nickname: 'LN', accountType: 'Loan' },
                    ],
                },
            };

            mockFetch.mock.mockImplementationOnce(() =>
                Promise.resolve({ ok: true, json: () => Promise.resolve(mockResponse) })
            );

            const accounts = await getAccounts(mockProfile);

            assert.strictEqual(accounts.length, 4);
            assert.strictEqual(accounts[0].accountType, 'CreditCard');
            assert.strictEqual(accounts[1].accountType, 'Checking');
            assert.strictEqual(accounts[2].accountType, 'Savings');
            assert.strictEqual(accounts[3].accountType, 'Loan');
        });

        it('should handle accounts without nickname', async () => {
            const mockResponse = {
                data: {
                    accounts: [
                        {
                            accountToken: 'token1',
                            accountNumber: '1234',
                            displayName: 'Primary Checking - 1234',
                            accountType: 'Checking',
                        },
                    ],
                },
            };

            mockFetch.mock.mockImplementationOnce(() =>
                Promise.resolve({ ok: true, json: () => Promise.resolve(mockResponse) })
            );

            const accounts = await getAccounts(mockProfile);

            assert.strictEqual(accounts[0].accountName, 'Primary Checking - 1234');
        });

        it('should throw error when API request fails', async () => {
            mockFetch.mock.mockImplementationOnce(() =>
                Promise.resolve({
                    ok: false,
                    status: 401,
                    statusText: 'Unauthorized',
                })
            );

            await assert.rejects(getAccounts(mockProfile), /US Bank GraphQL request failed: 401 Unauthorized/);
        });

        it('should throw error when GraphQL returns errors', async () => {
            mockFetch.mock.mockImplementationOnce(() =>
                Promise.resolve({
                    ok: true,
                    json: () => Promise.resolve({ errors: [{ message: 'Invalid token' }] }),
                })
            );

            await assert.rejects(getAccounts(mockProfile), /GraphQL errors/);
        });
    });

    describe('getStatements', () => {
        const mockAccount = {
            profile: {
                sessionId: 'test-session',
                profileId: 'test-profile-id',
                profileName: 'Test User',
            },
            accountId: '$vYsesMtpTY9yvbtKiDDwVGJUKOM1fq7FECVbFKBBIEmXLeIGD0N2gbNC9N5uxkxO',
            accountName: 'Altitude Reserve J',
            accountMask: '7606',
            accountType: 'CreditCard',
        };

        it('should retrieve all statements for an account', async () => {
            const mockResponse = {
                data: {
                    Statements: {
                        orderCopyFee: '$0',
                        list: [
                            {
                                documentType: null,
                                identifier: 'tunu-jefouJgJfs-2',
                                statementDate: '11/04/2025',
                                statementName: null,
                                frequency: null,
                            },
                            {
                                documentType: null,
                                identifier: 'tunu-jefouJgJfs-3',
                                statementDate: '10/03/2025',
                                statementName: null,
                                frequency: null,
                            },
                            {
                                documentType: null,
                                identifier: 'tunu-jefouJgJfs-4',
                                statementDate: '09/04/2025',
                                statementName: null,
                                frequency: null,
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

            const statements = await getStatements(mockAccount);

            assert.strictEqual(statements.length, 3);
            assert.strictEqual(statements[0].statementId, 'tunu-jefouJgJfs-2');
            assert.strictEqual(statements[0].statementDate, '2025-11-04');
            assert.strictEqual(statements[0].account, mockAccount);
            assert.strictEqual(statements[1].statementDate, '2025-10-03');
            assert.strictEqual(statements[2].statementDate, '2025-09-04');

            // Verify API call
            const calls = mockFetch.mock.calls;
            assert.strictEqual(calls.length, 1);
            assert.strictEqual(
                calls[0].arguments[0],
                'https://onlinebanking.usbank.com/digital/api/customer-management/graphql/v2'
            );

            const body = JSON.parse(calls[0].arguments[1].body);
            assert.strictEqual(body.operationName, 'getStatementList');
            assert.strictEqual(
                body.variables.statementListRequest.accountToken,
                '$vYsesMtpTY9yvbtKiDDwVGJUKOM1fq7FECVbFKBBIEmXLeIGD0N2gbNC9N5uxkxO'
            );
            assert.match(body.variables.statementListRequest.fromDate, /^01\/01\/\d{4}$/);
            assert.match(body.variables.statementListRequest.toDate, /^12\/31\/\d{4}$/);
        });

        it('should handle empty statement list', async () => {
            const mockResponse = {
                data: {
                    Statements: {
                        orderCopyFee: '$0',
                        list: [],
                    },
                },
            };

            mockFetch.mock.mockImplementationOnce(() =>
                Promise.resolve({ ok: true, json: () => Promise.resolve(mockResponse) })
            );

            const statements = await getStatements(mockAccount);

            assert.strictEqual(statements.length, 0);
        });

        it('should parse date correctly from MM/DD/YYYY to ISO format', async () => {
            const mockResponse = {
                data: {
                    Statements: {
                        list: [
                            { identifier: 'tuNU2', statementDate: '01/15/2025' },
                            { identifier: 'tuNU3', statementDate: '12/31/2024' },
                        ],
                    },
                },
            };

            mockFetch.mock.mockImplementationOnce(() =>
                Promise.resolve({ ok: true, json: () => Promise.resolve(mockResponse) })
            );

            const statements = await getStatements(mockAccount);

            assert.strictEqual(statements[0].statementDate, '2025-01-15');
            assert.strictEqual(statements[1].statementDate, '2024-12-31');
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
                getStatements(mockAccount),
                /Failed to get statements for account.*US Bank GraphQL request failed: 500/
            );
        });

        it('should throw error when response structure is invalid', async () => {
            mockFetch.mock.mockImplementationOnce(() =>
                Promise.resolve({ ok: true, json: () => Promise.resolve({ data: {} }) })
            );

            await assert.rejects(getStatements(mockAccount), /Invalid statements response structure/);
        });
    });

    describe('downloadStatement', () => {
        const mockStatement = {
            account: {
                profile: {
                    sessionId: 'test-session',
                    profileId: 'test-profile-id',
                    profileName: 'Test User',
                },
                accountId: '$vYsesMtpTY9yvbtKiDDwVGJUKOM1fq7FECVbFKBBIEmXLeIGD0N2gbNC9N5uxkxO',
                accountName: 'Altitude Reserve J',
                accountMask: '7606',
                accountType: 'CreditCard',
            },
            statementId: 'eEf5hNSfN0v5v6j7xQTx8D9PuvbxFgEiC0IakeCTtFth3ZzDLH2Eth4QvwECZjBS2',
            statementDate: '2025-11-04',
        };

        it('should download statement PDF', async () => {
            const mockPdfBlob = new Blob(['PDF content'], { type: 'application/pdf' });
            Object.defineProperty(mockPdfBlob, 'size', { value: 189392 });

            mockFetch.mock.mockImplementationOnce(() =>
                Promise.resolve({
                    ok: true,
                    headers: new Map([['content-type', 'application/pdf']]),
                    blob: () => Promise.resolve(mockPdfBlob),
                })
            );

            const blob = await downloadStatement(mockStatement);

            assert.strictEqual(blob, mockPdfBlob);
            assert.strictEqual(blob.size, 189392);

            // Verify API call
            const calls = mockFetch.mock.calls;
            assert.strictEqual(calls.length, 1);
            assert.strictEqual(
                calls[0].arguments[0],
                'https://onlinebanking.usbank.com/digital/api/customer-management/servicing/files/v1/downloads'
            );
            assert.strictEqual(calls[0].arguments[1].method, 'POST');
            assert.strictEqual(calls[0].arguments[1].headers['authorization'], 'Bearer 9cwMHi9B3hrluRwA0E6syHHvCQqc');
            assert.strictEqual(calls[0].arguments[1].headers['application-id'], 'WEBCD');
            assert.strictEqual(calls[0].arguments[1].headers['service-version'], '2');

            const body = JSON.parse(calls[0].arguments[1].body);
            assert.strictEqual(body.requestType.serviceType, 'STATEMENTS');
            assert.strictEqual(body.requestType.serviceSubType, 'DOWNLOAD');
            assert.strictEqual(body.data.statementList.documentType, 'STATEMENT');
            assert.deepStrictEqual(body.data.statementList.dates, ['11/04/2025']);
            assert.deepStrictEqual(body.data.statementList.identifiers, [mockStatement.statementId]);
        });

        it('should convert ISO date to MM/DD/YYYY format for API request', async () => {
            const mockPdfBlob = new Blob(['PDF'], { type: 'application/pdf' });
            mockFetch.mock.mockImplementationOnce(() =>
                Promise.resolve({
                    ok: true,
                    headers: new Map([['content-type', 'application/pdf']]),
                    blob: () => Promise.resolve(mockPdfBlob),
                })
            );

            const testStatement = {
                ...mockStatement,
                statementDate: '2025-10-03',
            };

            await downloadStatement(testStatement);

            const body = JSON.parse(mockFetch.mock.calls[0].arguments[1].body);
            assert.deepStrictEqual(body.data.statementList.dates, ['10/03/2025']);
        });

        it('should throw error when download request fails', async () => {
            mockFetch.mock.mockImplementationOnce(() =>
                Promise.resolve({
                    ok: false,
                    status: 404,
                    statusText: 'Not Found',
                })
            );

            await assert.rejects(
                downloadStatement(mockStatement),
                /Failed to download statement.*404 Not Found/
            );
        });

        it('should throw error when content type is not PDF', async () => {
            mockFetch.mock.mockImplementationOnce(() =>
                Promise.resolve({
                    ok: true,
                    headers: new Map([['content-type', 'text/html']]),
                    blob: () => Promise.resolve(new Blob(['<html>'])),
                })
            );

            await assert.rejects(
                downloadStatement(mockStatement),
                /Expected PDF but received text\/html/
            );
        });

        it('should throw error when AccessToken is missing', async () => {
            const originalGetItem = global.sessionStorage.getItem;
            global.sessionStorage.getItem = mock.fn(() => null);

            await assert.rejects(downloadStatement(mockStatement), /AccessToken not found in sessionStorage/);

            global.sessionStorage.getItem = originalGetItem;
        });
    });

    describe('Error Handling', () => {
        it('should handle network errors gracefully', async () => {
            const mockAccount = {
                profile: { sessionId: 'test', profileId: 'test', profileName: 'Test' },
                accountId: 'test-account',
                accountName: 'Test Account',
                accountMask: '1234',
                accountType: 'CreditCard',
            };

            mockFetch.mock.mockImplementationOnce(() => Promise.reject(new Error('Network error')));

            await assert.rejects(getStatements(mockAccount), /Network error/);
        });

        it('should provide clear error messages for missing credentials', async () => {
            const originalCookie = document.cookie;
            document.cookie = 'other=value';

            assert.throws(() => getSessionId(), /PIM-SESSION-ID cookie not found.*Please ensure you are logged in/);

            document.cookie = originalCookie;
        });
    });
});
