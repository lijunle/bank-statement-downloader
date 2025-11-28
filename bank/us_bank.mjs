/**
 * US Bank API implementation for retrieving bank statements
 * @see analyze/us_bank.md
 */

/** @type {string} */
export const bankId = 'us_bank';

/** @type {string} */
export const bankName = 'US Bank';

const BASE_URL = 'https://onlinebanking.usbank.com';
const GRAPHQL_URL = `${BASE_URL}/digital/api/customer-management/graphql/v2`;
const DOWNLOAD_URL = `${BASE_URL}/digital/api/customer-management/servicing/files/v1/downloads`;

/**
 * Get the current session ID from cookies
 * @returns {string}
 */
export function getSessionId() {
    const cookies = document.cookie.split(';');
    for (const cookie of cookies) {
        const [name, value] = cookie.trim().split('=');
        if (name === 'PIM-SESSION-ID') {
            return value;
        }
    }
    throw new Error('PIM-SESSION-ID cookie not found. Please ensure you are logged in.');
}

/**
 * Get the username from localStorage
 * @returns {string}
 */
function getUsername() {
    try {
        const usersData = localStorage.getItem('users');
        if (!usersData) {
            throw new Error('Users data not found in localStorage');
        }

        const users = JSON.parse(usersData);
        if (!users['0'] || !users['0'].user_id) {
            throw new Error('User ID not found in localStorage');
        }

        return users['0'].user_id;
    } catch (error) {
        const err = /** @type {Error} */ (error);
        throw new Error(`Failed to retrieve username from localStorage: ${err.message}`);
    }
}

/**
 * Get the authorization token from sessionStorage
 * @returns {string}
 */
function getAuthToken() {
    const token = sessionStorage.getItem('AccessToken');
    if (!token) {
        throw new Error('AccessToken not found in sessionStorage. Please ensure you are logged in.');
    }
    return token;
}

/**
 * Make a GraphQL request to US Bank API
 * @param {string} operationName - GraphQL operation name
 * @param {string} query - GraphQL query string
 * @param {any} variables - GraphQL variables
 * @returns {Promise<any>}
 */
async function makeGraphQLRequest(operationName, query, variables) {
    const authToken = getAuthToken();

    const response = await fetch(GRAPHQL_URL, {
        method: 'POST',
        headers: {
            'accept': '*/*',
            'content-type': 'application/json',
            'application-id': 'WEBCD',
            'service-version': '2',
            'authorization': `Bearer ${authToken}`,
            'origin': BASE_URL,
            'referer': `${BASE_URL}/digital/servicing/shellapp/`,
            'sec-fetch-dest': 'empty',
            'sec-fetch-mode': 'cors',
            'sec-fetch-site': 'same-origin',
        },
        credentials: 'include',
        body: JSON.stringify({
            operationName,
            query,
            variables,
        }),
    });

    if (!response.ok) {
        throw new Error(`US Bank GraphQL request failed: ${response.status} ${response.statusText}`);
    }

    const data = await response.json();

    if (data.errors) {
        throw new Error(`GraphQL errors: ${JSON.stringify(data.errors)}`);
    }

    return data.data;
}

/**
 * Get the current user profile
 * @param {string} sessionId - The session ID
 * @returns {Promise<import('./bank.types').Profile>}
 */
export async function getProfile(sessionId) {
    try {
        const username = getUsername();

        const query = `
			query customer($input: ProfileInput!) {
				customer(input: $input) {
					customer {
						personal {
							customerType {
								type
								typeCode
							}
							hashedLegalParticipantID
							name {
								fullName
								firstName
								lastName
							}
						}
					}
				}
			}
		`;

        const variables = {
            input: {
                identifier: username,
                identifierType: 'UID',
            },
        };

        const data = await makeGraphQLRequest('customer', query, variables);

        if (!data.customer?.customer?.[0]?.personal?.[0]) {
            throw new Error('Invalid profile response structure');
        }

        const personal = data.customer.customer[0].personal[0];
        const profileId = personal.hashedLegalParticipantID || username;
        const profileName = personal.name?.fullName || username;

        return {
            sessionId,
            profileId,
            profileName,
        };
    } catch (error) {
        const err = /** @type {Error} */ (error);
        throw new Error(`Failed to get profile: ${err.message}`);
    }
}

/**
 * Map US Bank account type to standard account type
 * @param {string} accountType - US Bank account type
 * @returns {import('./bank.types').AccountType}
 */
function mapAccountType(accountType) {
    const type = accountType.toLowerCase();
    if (type.includes('credit')) return 'CreditCard';
    if (type.includes('checking')) return 'Checking';
    if (type.includes('savings')) return 'Savings';
    if (type.includes('loan') || type.includes('mortgage')) return 'Loan';
    if (type.includes('investment') || type.includes('brokerage')) return 'Investment';
    return 'Checking'; // Default fallback
}

/**
 * Get all accounts for the user
 * @param {import('./bank.types').Profile} profile - The user profile
 * @returns {Promise<import('./bank.types').Account[]>}
 */
export async function getAccounts(profile) {
    try {
        const username = getUsername();

        const query = `
			query accounts($accountInput: AccountInput!) {
				accounts(accountInput: $accountInput) {
					accountToken
					productCode
					subProductCode
					accountNumber
					displayName
					nickname
					accountType
					ownershipType
					relationshipCode
				}
			}
		`;

        const variables = {
            accountInput: {
                filters: {
                    filterKey: 'STATEMENTSACCESSIBLE',
                    filterValue: '',
                    filterType: 'SINGLE',
                },
                identifierType: 'UID',
                identifier: username,
            },
        };

        const data = await makeGraphQLRequest('accounts', query, variables);

        if (!data.accounts || !Array.isArray(data.accounts)) {
            throw new Error('Invalid accounts response structure');
        }

        return data.accounts.map((/** @type {any} */ account) => ({
            profile,
            accountId: account.accountToken,
            accountName: account.nickname || account.displayName || `Account ${account.accountNumber}`,
            accountMask: account.accountNumber,
            accountType: mapAccountType(account.accountType),
        }));
    } catch (error) {
        const err = /** @type {Error} */ (error);
        throw new Error(`Failed to get accounts: ${err.message}`);
    }
}

/**
 * Parse date from MM/DD/YYYY format to ISO 8601
 * @param {string} dateStr - Date in MM/DD/YYYY format
 * @returns {string} - ISO 8601 date string
 */
function parseStatementDate(dateStr) {
    const [month, day, year] = dateStr.split('/');
    return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
}

/**
 * Format date to MM/DD/YYYY format
 * @param {Date} date - Date object
 * @returns {string} - Formatted date string
 */
function formatDate(date) {
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    const year = date.getFullYear();
    return `${month}/${day}/${year}`;
}

/**
 * Get all statements for an account
 * @param {import('./bank.types').Account} account - The account to get statements for
 * @returns {Promise<import('./bank.types').Statement[]>}
 */
export async function getStatements(account) {
    try {
        // Get statements for the current year
        const now = new Date();
        const startOfYear = new Date(now.getFullYear(), 0, 1);
        const endOfYear = new Date(now.getFullYear(), 11, 31);

        const fromDate = formatDate(startOfYear);
        const toDate = formatDate(endOfYear);

        const query = `
			query getStatementList($statementListRequest: StatementListRequest!) {
				Statements(statementListRequest: $statementListRequest) {
					orderCopyFee
					list {
						documentType
						identifier
						statementDate
						statementName
						frequency
					}
				}
			}
		`;

        const variables = {
            statementListRequest: {
                accountToken: account.accountId,
                fromDate,
                toDate,
            },
        };

        const data = await makeGraphQLRequest('getStatementList', query, variables);

        if (!data.Statements?.list || !Array.isArray(data.Statements.list)) {
            throw new Error('Invalid statements response structure');
        }

        return data.Statements.list.map((/** @type {any} */ statement) => ({
            account,
            statementId: statement.identifier,
            statementDate: parseStatementDate(statement.statementDate),
        }));
    } catch (error) {
        const err = /** @type {Error} */ (error);
        throw new Error(`Failed to get statements for account ${account.accountName}: ${err.message}`);
    }
}

/**
 * Download a statement PDF
 * @param {import('./bank.types').Statement} statement - The statement to download
 * @returns {Promise<Blob>}
 */
export async function downloadStatement(statement) {
    try {
        // Parse the ISO date back to MM/DD/YYYY format
        // Parse as UTC to avoid timezone issues
        const [year, month, day] = statement.statementDate.split('-');
        const formattedDate = `${month}/${day}/${year}`;
        const requestBody = {
            requestType: {
                serviceType: 'STATEMENTS',
                serviceSubType: 'DOWNLOAD',
            },
            data: {
                statementList: {
                    accountToken: statement.account.accountId,
                    documentType: 'STATEMENT',
                    dates: [formattedDate],
                    identifiers: [statement.statementId],
                },
            },
        };

        const authToken = getAuthToken();

        const response = await fetch(DOWNLOAD_URL, {
            method: 'POST',
            headers: {
                'accept': 'application/json, text/plain, */*',
                'content-type': 'application/json',
                'application-id': 'WEBCD',
                'service-version': '2',
                'authorization': `Bearer ${authToken}`,
                'origin': BASE_URL,
                'referer': `${BASE_URL}/digital/servicing/shellapp/`,
                'sec-fetch-dest': 'empty',
                'sec-fetch-mode': 'cors',
                'sec-fetch-site': 'same-origin',
            },
            credentials: 'include',
            body: JSON.stringify(requestBody),
        });

        if (!response.ok) {
            throw new Error(`Failed to download statement: ${response.status} ${response.statusText}`);
        }

        const contentType = response.headers.get('content-type');
        if (!contentType?.includes('application/pdf')) {
            throw new Error(`Expected PDF but received ${contentType}`);
        }

        return await response.blob();
    } catch (error) {
        const err = /** @type {Error} */ (error);
        throw new Error(`Failed to download statement for ${statement.account.accountName} dated ${statement.statementDate}: ${err.message}`);
    }
}
