/**
 * Disnat (Desjardins Online Brokerage) API implementation for retrieving bank statements
 * @see analyze/disnat.md
 */

/** @type {string} */
export const bankId = 'disnat';

/** @type {string} */
export const bankName = 'Disnat';

const BASE_URL = 'https://tmw.secure.vmd.ca';

/**
 * Gets the session ID from cookies
 * Note: JSESSIONID is HttpOnly and cannot be accessed via JavaScript directly.
 * This function attempts to read XSRF-TOKEN which is accessible.
 * @returns {string}
 */
export function getSessionId() {
    const cookies = document.cookie.split(';');

    // Try to get XSRF-TOKEN as session identifier (accessible via JavaScript)
    for (const cookie of cookies) {
        const [name, value] = cookie.trim().split('=');
        if (name === 'XSRF-TOKEN') {
            return value;
        }
    }

    throw new Error('Session ID not found. XSRF-TOKEN cookie is missing. Please ensure you are logged in.');
}

/**
 * Makes an authenticated API request with all required headers and cookies
 * @param {string} endpoint - API endpoint path
 * @param {RequestInit} [options] - Additional fetch options
 * @returns {Promise<Response>}
 */
async function makeAuthenticatedRequest(endpoint, options = {}) {
    const url = `${BASE_URL}${endpoint}`;

    const headers = {
        'accept': 'application/json, text/plain, */*',
        'x-requested-with': 'XMLHttpRequest',
        'referer': `${BASE_URL}/s9web/secure/portfolio`,
        'sec-fetch-dest': 'empty',
        'sec-fetch-mode': 'cors',
        'sec-fetch-site': 'same-origin',
        ...options.headers,
    };

    const response = await fetch(url, {
        ...options,
        headers,
        credentials: 'include', // Include cookies (JSESSIONID, XSRF-TOKEN)
    });

    if (!response.ok) {
        throw new Error(`Disnat API request failed: ${response.status} ${response.statusText} at ${endpoint}`);
    }

    return response;
}

/**
 * Retrieves the current user profile
 * @param {string} sessionId - The session ID (XSRF-TOKEN)
 * @returns {Promise<import('./bank.types').Profile>}
 */
export async function getProfile(sessionId) {
    try {
        // Add cache-busting timestamp
        const timestamp = Date.now();
        const response = await makeAuthenticatedRequest(`/s9web/secure/demographics?_=${timestamp}`);
        const data = await response.json();

        if (data.status !== 'OK' || !data.payload?.demographics) {
            throw new Error('Invalid response format from demographics API');
        }

        const demographics = data.payload.demographics;
        const clientCode = demographics.referenceClientDemographicsJson?.clientCode;

        if (!clientCode) {
            throw new Error('Client code not found in demographics response');
        }

        const firstName = demographics.self?.firstName || '';
        const lastName = demographics.self?.lastName || '';
        const profileName = `${firstName} ${lastName}`.trim() || clientCode;

        return {
            sessionId,
            profileId: clientCode,
            profileName,
        };
    } catch (error) {
        const err = /** @type {Error} */ (error);
        throw new Error(`Failed to retrieve user profile: ${err.message}`);
    }
}

/**
 * Maps Disnat account type to standard account type
 * @param {string} accountType - Disnat account type (CASH, MARGIN, RRSP, TFSA, etc.)
 * @returns {import('./bank.types').AccountType}
 */
function mapAccountType(accountType) {
    const normalizedType = accountType?.toUpperCase() || '';

    // Disnat is primarily a brokerage, so most accounts are Investment accounts
    switch (normalizedType) {
        case 'CASH':
        case 'MARGIN':
        case 'RRSP':
        case 'TFSA':
        case 'RESP':
        case 'LIRA':
        case 'LIF':
        case 'RRIF':
            return 'Investment';
        default:
            return 'Investment';
    }
}

/**
 * Retrieves all accounts for the logged-in user
 * @param {import('./bank.types').Profile} profile - The user profile
 * @returns {Promise<import('./bank.types').Account[]>}
 */
export async function getAccounts(profile) {
    try {
        // Construct groupId from profileId (clientCode) + "DC" suffix
        const groupId = `${profile.profileId}DC`;

        const response = await makeAuthenticatedRequest(`/s9web/secure/web-api/v2/portfolio/group/${groupId}`);
        const data = await response.json();

        if (!data.clients) {
            throw new Error('Invalid response format from portfolio API');
        }

        const accounts = [];

        // Iterate through clients (usually just one)
        for (const client of data.clients) {
            if (!client.accounts) continue;

            // Iterate through accounts
            for (const account of client.accounts) {
                if (!account.accountId) continue;

                // Get account number from balances (use first balance entry)
                const accountNumber = account.balances?.[0]?.accountNumber || account.accountId;

                // Create account mask (last 4 digits)
                const accountMask = accountNumber.slice(-4);

                // Get account name - use currency and type for description
                const currency = account.primaryCurrency || '';
                const type = account.accountType || '';
                const accountName = `${type} ${currency}`.trim() || accountNumber;

                accounts.push({
                    profile,
                    accountId: account.accountId,
                    accountName,
                    accountMask,
                    accountType: mapAccountType(account.accountType),
                });
            }
        }

        if (accounts.length === 0) {
            throw new Error('No accounts found in portfolio response');
        }

        return accounts;
    } catch (error) {
        const err = /** @type {Error} */ (error);
        throw new Error(`Failed to retrieve accounts: ${err.message}`);
    }
}

/**
 * Retrieves all statements for the given account
 * @param {import('./bank.types').Account} account - The account
 * @returns {Promise<import('./bank.types').Statement[]>}
 */
export async function getStatements(account) {
    try {
        const clientCode = account.profile.profileId;

        // Calculate date range: 1 year back from today
        const toDate = new Date();
        const fromDate = new Date();
        fromDate.setFullYear(toDate.getFullYear() - 1);

        // Format dates as YYYY-MM-DD
        const toDateStr = toDate.toISOString().split('T')[0];
        const fromDateStr = fromDate.toISOString().split('T')[0];

        // Build query string with document types
        const params = new URLSearchParams();
        params.append('clientCodes', clientCode);
        params.append('fromDate', fromDateStr);
        params.append('toDate', toDateStr);
        params.append('documentTypes', 'ETATCOMPTE'); // Account Statement

        const response = await makeAuthenticatedRequest(
            `/s9web/secure/web-api/v2/documents/info/clients?${params.toString()}`
        );
        const data = await response.json();

        if (!Array.isArray(data)) {
            throw new Error('Invalid response format from documents API');
        }

        const statements = [];

        // Filter for account statements (ETATCOMPTE)
        for (const doc of data) {
            if (doc.type !== 'ETATCOMPTE') continue;

            // Parse statement date (YYYY-MM-DD format)
            const parsedDate = new Date(doc.date);

            if (isNaN(parsedDate.getTime())) {
                console.warn(`Invalid statement date: ${doc.date}`);
                continue;
            }

            const statementDate = parsedDate.toISOString();

            // Validate token exists
            if (!doc.token) {
                console.warn(`Document ${doc.id} missing token field`, doc);
                continue;
            }

            // Use token as statementId since it's required for download
            // The token is ephemeral and unique per request
            const stmt = {
                account,
                statementId: doc.token,
                statementDate,
            };

            statements.push(stmt);
        }

        return statements;
    } catch (error) {
        const err = /** @type {Error} */ (error);
        throw new Error(`Failed to retrieve statements: ${err.message}`);
    }
}

/**
 * Downloads a statement PDF
 * @param {import('./bank.types').Statement} statement - The statement to download
 * @returns {Promise<Blob>}
 */
export async function downloadStatement(statement) {
    try {
        // The statementId is actually the download token
        const token = statement.statementId;

        if (!token) {
            throw new Error('Download token not found. Please refresh the statement list.');
        }

        const response = await makeAuthenticatedRequest(
            `/s9web/secure/web-api/v2/documents?token=${token}`,
            {
                headers: {
                    'accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
                },
            }
        );

        // Check if response is actually a PDF
        const contentType = response.headers.get('content-type');
        if (!contentType?.includes('application/pdf')) {
            throw new Error(`Expected PDF but received ${contentType}`);
        }

        const blob = await response.blob();

        if (blob.size === 0) {
            throw new Error('Downloaded statement is empty');
        }

        return blob;
    } catch (error) {
        const err = /** @type {Error} */ (error);
        throw new Error(`Failed to download statement: ${err.message}`);
    }
}
