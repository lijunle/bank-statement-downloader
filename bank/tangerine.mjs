/**
 * Tangerine Bank API implementation for retrieving bank statements
 * @see analyze/tangerine.md
 */

/** @type {string} */
export const bankId = 'tangerine';

/** @type {string} */
export const bankName = 'Tangerine';

const BASE_URL = 'https://secure.tangerine.ca';

/**
 * Makes an authenticated API request with all required headers
 * @param {string} endpoint - API endpoint path
 * @param {RequestInit} [options] - Additional fetch options
 * @returns {Promise<Response>}
 */
async function makeAuthenticatedRequest(endpoint, options = {}) {
    const url = `${BASE_URL}${endpoint}`;

    const headers = {
        'accept': 'application/json, text/plain, */*',
        'accept-language': 'en_CA',
        'x-web-flavour': 'fbe',
        ...options.headers,
    };

    const response = await fetch(url, {
        ...options,
        headers,
        credentials: 'include', // Include cookies
    });

    if (!response.ok) {
        throw new Error(`Tangerine API request failed: ${response.status} ${response.statusText} at ${endpoint}`);
    }

    return response;
}

/**
 * Get the current session ID
 * Uses CTOK cookie which contains the user's Orange Key (client ID)
 * The actual authentication is handled by the HttpOnly TRANSACTION_TOKEN cookie automatically
 * @returns {string}
 * @throws {Error} If the token is not found
 */
export function getSessionId() {
    // Use CTOK cookie which contains format "P|<OrangeKey>"
    const cookie = document.cookie
        .split(';')
        .find((c) => c.trim().startsWith('CTOK='));

    if (cookie) {
        return cookie.split('=')[1].trim();
    }

    throw new Error('No session identifier found. Please log in to Tangerine.');
}

/**
 * Get the current user profile
 * @param {string} sessionId - The session ID (TRANSACTION_TOKEN)
 * @returns {Promise<import('./bank.types').Profile>}
 */
export async function getProfile(sessionId) {
    try {
        const response = await makeAuthenticatedRequest(
            '/web/rest/v1/customers/my?include-servicing-systems=true',
            {
                headers: {
                    'x-dynatrace-service': '/web/rest/v1/customers/my?include-servicing-systems=',
                },
            }
        );

        const data = await response.json();

        if (!data || !data.customer) {
            throw new Error('Invalid response format from customer profile API');
        }

        const customer = data.customer;
        const profileName = `${customer.title || ''} ${customer.first_name} ${customer.last_name}`.trim();

        return {
            sessionId,
            profileId: customer.client_number,
            profileName,
        };
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        throw new Error('Failed to get profile: ' + message);
    }
}

/**
 * Get all accounts for the logged-in user
 * @param {import('./bank.types').Profile} profile - The user profile
 * @returns {Promise<import('./bank.types').Account[]>}
 */
export async function getAccounts(profile) {
    try {
        const response = await makeAuthenticatedRequest('/web/rest/pfm/v1/accounts', {
            headers: {
                'x-dynatrace-service': '/web/rest/pfm/v1/accounts',
            },
        });

        const data = await response.json();

        if (!data || !data.accounts) {
            throw new Error('Invalid response format from accounts API');
        }

        const accounts = [];

        for (const account of data.accounts) {
            // Map Tangerine account types to standard AccountType
            /** @type {import('./bank.types').AccountType} */
            let accountType;
            switch (account.type) {
                case 'CHEQUING':
                    accountType = 'Checking';
                    break;
                case 'SAVINGS':
                case 'RSP_SAVINGS':
                case 'TFSA_SAVINGS':
                case 'RIF_SAVINGS':
                case 'GIC':
                    accountType = 'Savings';
                    break;
                case 'CREDIT_CARD':
                    accountType = 'CreditCard';
                    break;
                case 'LINE_OF_CREDIT':
                case 'MORTGAGE':
                    accountType = 'Loan';
                    break;
                default:
                    accountType = 'Savings'; // Default to Savings for unknown types
            }

            // Extract last 4 digits from display_name
            const displayName = account.display_name || '';
            const accountMask = displayName.slice(-4);

            accounts.push({
                profile,
                accountId: account.number, // Encrypted account ID
                accountName: account.description || account.nickname || displayName,
                accountMask,
                accountType,
            });
        }

        return accounts;
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        throw new Error('Failed to get accounts: ' + message);
    }
}

/**
 * Get all statements for an account
 * Note: Tangerine's API returns statements for ALL accounts in a single call,
 * so we need to filter by account type. We also need to iterate through all available months.
 * @param {import('./bank.types').Account} account - The account
 * @returns {Promise<import('./bank.types').Statement[]>}
 */
export async function getStatements(account) {
    try {
        // First, get the list of available months
        const initialResponse = await makeAuthenticatedRequest(
            '/web/rest/v1/customers/my/documents/statements',
            {
                headers: {
                    'x-dynatrace-customer': account.profile.profileId,
                    'x-dynatrace-service': '/web/rest/v1/customers/my/documents/statements',
                },
            }
        );

        const initialData = await initialResponse.json();

        if (!initialData || !initialData.months) {
            throw new Error('Invalid response format from statements API');
        }

        const allStatements = [];

        // Account type mapping
        /** @type {Record<import('./bank.types').AccountType, string | string[]>} */
        const accountTypeMap = {
            'Checking': 'CHQ',
            'Savings': 'BSTMT',
            'CreditCard': 'VISA',
            'Loan': ['LOC', 'MTG'],
            'Investment': 'BSTMT',
        };

        const mappedType = accountTypeMap[account.accountType];
        const targetTypes = Array.isArray(mappedType) ? mappedType : [mappedType];

        // Limit to last 12 months to avoid too many requests
        const monthsToFetch = initialData.months.slice(0, 12);

        // Iterate through each available month and fetch statements
        for (const monthInfo of monthsToFetch) {
            const month = monthInfo.month; // Format: YYYY-MM

            try {
                const monthResponse = await makeAuthenticatedRequest(
                    `/web/rest/v1/customers/my/documents/statements?need-statement-months=false&start-month=${month}&end-month=${month}`,
                    {
                        headers: {
                            'x-dynatrace-customer': account.profile.profileId,
                            'x-dynatrace-service': `/web/rest/v1/customers/my/documents/statements?need-statement-months=false&start-month=${month}&end-month=${month}`,
                        },
                    }
                );

                const monthData = await monthResponse.json();

                if (monthData && monthData.statements) {
                    // Filter statements by account type
                    for (const statement of monthData.statements) {
                        if (targetTypes.includes(statement.statement_type)) {
                            allStatements.push({
                                account,
                                statementId: statement.statement_id,
                                statementDate: statement.end_date,
                            });
                        }
                    }
                }
            } catch (error) {
                // Continue with other months if one fails
                console.warn(`Failed to fetch statements for ${month}:`, error);
            }
        }

        // Sort by date descending (newest first)
        allStatements.sort((a, b) => b.statementDate.localeCompare(a.statementDate));

        return allStatements;
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        throw new Error('Failed to get statements: ' + message);
    }
}

/**
 * Download a statement PDF
 * @param {import('./bank.types').Statement} statement - The statement to download
 * @returns {Promise<Blob>}
 */
export async function downloadStatement(statement) {
    try {
        // Extract month from statement date (YYYY-MM-DD -> YYYY-MM)
        const month = statement.statementDate.substring(0, 7);

        // Get statement details for the specific month
        const listResponse = await makeAuthenticatedRequest(
            `/web/rest/v1/customers/my/documents/statements?need-statement-months=false&start-month=${month}&end-month=${month}`,
            {
                headers: {
                    'x-dynatrace-customer': statement.account.profile.profileId,
                    'x-dynatrace-service': `/web/rest/v1/customers/my/documents/statements?need-statement-months=false&start-month=${month}&end-month=${month}`,
                },
            }
        );

        const listData = await listResponse.json();
        const statementInfo = listData.statements.find(
            (/** @type {any} */ s) => s.statement_id === statement.statementId
        );

        if (!statementInfo) {
            throw new Error('Statement not found in list');
        }

        const statementType = statementInfo.statement_type;
        const fileName = statementInfo.statement_filename || 'statement.pdf';

        // Download the PDF
        const url = `/web/docs/rest/v1/customers/my/documents/statements/${statement.statementId}?statement-type=${statementType}&file-name=${encodeURIComponent(fileName)}&language=EN`;

        const response = await makeAuthenticatedRequest(url, {
            headers: {
                'accept': 'application/pdf',
            },
        });

        return await response.blob();
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        throw new Error('Failed to download statement: ' + message);
    }
}
