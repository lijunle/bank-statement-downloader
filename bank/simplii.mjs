/**
 * Simplii Financial API implementation for retrieving bank statements
 * @see analyze/simplii.md
 */

/** @type {string} */
export const bankId = 'simplii';

/** @type {string} */
export const bankName = 'Simplii Financial';

const BASE_URL = 'https://online.simplii.com';

/**
 * Retrieves the current session ID from browser storage
 * @returns {string}
 */
export function getSessionId() {
    // Try sessionStorage first (standard location)
    const sessionToken = sessionStorage.getItem('ebanking:session_token');
    if (sessionToken) {
        try {
            // Token is stored as JSON string
            return JSON.parse(sessionToken);
        } catch (e) {
            return sessionToken;
        }
    }

    // Fallback for Safari: check cookie
    const cookieMatch = document.cookie.match(/ebanking:session_token=([^;]+)/);
    if (cookieMatch) {
        try {
            return JSON.parse(decodeURIComponent(cookieMatch[1]));
        } catch (e) {
            return decodeURIComponent(cookieMatch[1]);
        }
    }

    throw new Error('Simplii session token not found. Please ensure you are logged in.');
}

/**
 * Makes an authenticated API request with all required headers
 * @param {string} endpoint - API endpoint path
 * @param {RequestInit} [options] - Additional fetch options
 * @returns {Promise<Response>}
 */
async function makeAuthenticatedRequest(endpoint, options = {}) {
    const sessionToken = getSessionId();
    const url = `${BASE_URL}${endpoint}`;

    const defaultHeaders = /** @type {Record<string, string>} */ ({
        'accept': 'application/json',
        'accept-language': 'en',
        'brand': 'pcf', // President's Choice Financial
        'x-auth-token': sessionToken,
    });

    const headers = {
        ...defaultHeaders,
        ...options.headers,
    };

    const response = await fetch(url, {
        ...options,
        headers,
        credentials: 'include',
    });

    if (!response.ok) {
        // 422 is expected for missing statements
        if (response.status === 422) {
            return response;
        }
        throw new Error(`Simplii API request failed: ${response.status} ${response.statusText} at ${endpoint}`);
    }

    return response;
}

/**
 * Retrieves the current user profile
 * @param {string} sessionId - The session token
 * @returns {Promise<import('./bank.types').Profile>}
 */
export async function getProfile(sessionId) {
    try {
        const response = await makeAuthenticatedRequest('/ebm-anp/api/v1/profile/json/userProfiles');
        const data = await response.json();

        if (!data || !data.id) {
            throw new Error('No user profile found in response');
        }

        return {
            sessionId: sessionId,
            profileId: data.id,
            profileName: `${data.firstName} ${data.lastName}`.trim(),
        };
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        throw new Error(`Failed to retrieve Simplii profile: ${message}`);
    }
}

/**
 * Maps internal account name codes to user-friendly display names
 */
const ACCOUNT_NAMES = {
    'chequing_personal': 'No Fee Chequing Account',
    'savings_personal': 'Savings Account',
    'usd_savings_personal': 'USD Savings Account',
    'eur_savings_personal': 'EUR Savings Account',
    'gbp_savings_personal': 'GBP Savings Account',
    'inr_savings_personal': 'INR Savings Account',
    'php_savings_personal': 'PHP Savings Account',
    'cnh_savings_personal': 'CNH Savings Account',
    'savings_personal_investment': 'High Interest Savings Account',
    'savings_taxfree_personal_investment': 'Tax-Free Savings Account',
    'savings_rrsp_individual_investment': 'RRSP Savings Account',
};

/**
 * Retrieves all accounts for the logged-in user
 * @param {import('./bank.types').Profile} profile - The user profile
 * @returns {Promise<import('./bank.types').Account[]>}
 */
export async function getAccounts(profile) {
    try {
        const response = await makeAuthenticatedRequest('/ebm-ai/api/v2/json/accounts');
        const data = await response.json();

        if (!data || !data.accounts || !Array.isArray(data.accounts)) {
            throw new Error('Invalid accounts response format');
        }

        return data.accounts.map((/** @type {any} */ account) => {
            // Determine account type from categorization
            let accountType = 'Checking'; // default
            if (account.categorization) {
                const subCategory = account.categorization.subCategory;
                if (subCategory === 'CHEQUING') {
                    accountType = 'Checking';
                } else if (subCategory === 'SAVINGS' || subCategory === 'USD_SAVINGS') {
                    accountType = 'Savings';
                }
            }

            // Get account name - map from internal code to display name
            const internalName = account.displayAttributes?.name || '';
            const accountName = /** @type {string} */ (ACCOUNT_NAMES[/** @type {keyof typeof ACCOUNT_NAMES} */ (internalName)]) ||
                account.nickname ||
                internalName ||
                'Account';

            // Get last 4 digits of account number
            const accountMask = account.number.slice(-4);

            const acct = /** @type {import('./bank.types').Account & {_fullAccountNumber?: string, _openDate?: string}} */ ({
                profile: profile,
                accountId: account.id, // Hashed ID
                accountName: accountName,
                accountMask: accountMask,
                accountType: accountType,
            });

            // Store additional data for statement retrieval
            acct._fullAccountNumber = account.number;
            acct._openDate = account.openDate;

            return acct;
        });
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        throw new Error(`Failed to retrieve Simplii accounts: ${message}`);
    }
}

/**
 * Retrieves all available statements for an account by querying the past 12 months
 * @param {import('./bank.types').Account} account - The account
 * @returns {Promise<import('./bank.types').Statement[]>}
 */
export async function getStatements(account) {
    try {
        const statements = [];
        const currentDate = new Date();

        // Calculate the earliest date to check (12 months ago or account open date)
        const acct = /** @type {typeof account & {_openDate?: string}} */ (account);
        const openDate = acct._openDate ? new Date(acct._openDate) : null;
        const oneYearAgo = new Date(currentDate);
        oneYearAgo.setMonth(oneYearAgo.getMonth() - 12);

        const startDate = openDate && openDate > oneYearAgo ? openDate : oneYearAgo;

        // Iterate through each month from current back to start date
        const checkDate = new Date(currentDate);

        while (checkDate >= startDate) {
            const month = String(checkDate.getMonth() + 1); // 1-12
            const year = String(checkDate.getFullYear());

            try {
                const statement = await requestStatement(account, month, year);
                if (statement) {
                    statements.push(statement);
                }
            } catch (error) {
                // Ignore 422 errors (statement doesn't exist)
                // Continue checking other months
            }

            // Move to previous month
            checkDate.setMonth(checkDate.getMonth() - 1);
        }

        return statements;
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        throw new Error(`Failed to retrieve Simplii statements: ${message}`);
    }
}

/**
 * Requests a statement for a specific month and year
 * @param {import('./bank.types').Account} account - The account
 * @param {string} month - Month as string (1-12)
 * @param {string} year - Year as string
 * @returns {Promise<import('./bank.types').Statement | null>}
 */
async function requestStatement(account, month, year) {
    const requestBody = {
        eStatement: {
            month: month,
            year: year,
            fileUri: null,
            accountId: account.accountId,
        },
    };

    const response = await makeAuthenticatedRequest('/ebm-ai/api/v1/json/eStatements', {
        method: 'POST',
        headers: {
            'accept': 'application/vnd.api+json',
            'content-type': 'application/vnd.api+json',
        },
        body: JSON.stringify(requestBody),
    });

    // 422 means statement doesn't exist for this period
    if (response.status === 422) {
        return null;
    }

    if (!response.ok) {
        throw new Error(`Failed to request statement for ${year}-${month}: ${response.status}`);
    }

    const data = await response.json();

    if (!data || !data.eStatements || data.eStatements.length === 0) {
        return null;
    }

    const eStatement = data.eStatements[0];

    // Create statement date (first day of the statement month)
    const statementDate = new Date(parseInt(year), parseInt(month) - 1, 1);

    return {
        account: account,
        statementId: eStatement.fileUri, // UUID for downloading
        statementDate: statementDate.toISOString(),
    };
}

/**
 * Downloads a statement PDF
 * @param {import('./bank.types').Statement} statement - The statement to download
 * @returns {Promise<Blob>}
 */
export async function downloadStatement(statement) {
    try {
        const sessionToken = getSessionId();
        const statementId = statement.statementId;

        // The request body contains the token in form format
        const requestBody = `X-Auth-Token=${sessionToken}`;

        const response = await makeAuthenticatedRequest(
            `/ebm-ai/api/v1/json/eStatements/file/${statementId}?eb-target-site=ebkpcc`,
            {
                method: 'POST',
                headers: {
                    'accept': 'application/json',
                    'content-type': 'application/vnd.api+json',
                },
                body: requestBody,
            }
        );

        if (!response.ok) {
            throw new Error(`Failed to download statement: ${response.status} ${response.statusText}`);
        }

        const blob = await response.blob();

        if (blob.size === 0) {
            throw new Error('Downloaded statement is empty');
        }

        return blob;
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        throw new Error(`Failed to download Simplii statement: ${message}`);
    }
}
