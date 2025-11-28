/**
 * Citi Bank API implementation for retrieving bank statements
 * @see analyze/citi.md
 */

/** @type {string} */
export const bankId = 'citi';

/** @type {string} */
export const bankName = 'Citi';

const BASE_URL = 'https://online.citi.com/gcgapi/prod/public/v1';

/**
 * Makes an authenticated API request with all required headers and cookies
 * @param {string} endpoint - API endpoint path (relative to base URL)
 * @param {RequestInit} [options] - Additional fetch options
 * @returns {Promise<Response>}
 */
async function makeAuthenticatedRequest(endpoint, options = {}) {
    const url = endpoint.startsWith('http') ? endpoint : `${BASE_URL}${endpoint}`;

    // Get required header values from cookies
    const cookies = document.cookie.split('; ');
    const cookieMap = /** @type {Record<string, string>} */ ({});
    for (const cookie of cookies) {
        const [name, ...valueParts] = cookie.split('=');
        cookieMap[name] = valueParts.join('=');
    }

    const headers = /** @type {Record<string, string>} */ ({
        'accept': 'application/json',
        'content-type': 'application/json',
        'appversion': cookieMap['appVersion'] || 'CBOL-ANG-2025-11-02',
        'businesscode': cookieMap['businessCode'] || 'GCB',
        'channelid': cookieMap['channelId'] || 'CBOL',
        'client_id': cookieMap['client_id'] || '',
        'countrycode': cookieMap['countryCode'] || 'US',
        'origin': 'https://online.citi.com',
        'referer': 'https://online.citi.com/US/ag/dashboard/credit-card',
        'sec-fetch-dest': 'empty',
        'sec-fetch-mode': 'cors',
        'sec-fetch-site': 'same-origin',
        ...options.headers,
    });

    // Add customersessionid header for certain endpoints
    if (cookieMap['bcsid']) {
        headers['customersessionid'] = cookieMap['bcsid'];
    }

    const response = await fetch(url, {
        ...options,
        headers,
        credentials: 'include', // Include cookies
    });

    if (!response.ok) {
        throw new Error(`Citi API request failed: ${response.status} ${response.statusText} at ${endpoint}`);
    }

    return response;
}

/**
 * Retrieves the current session ID from cookies
 * @returns {string} The bcsid cookie value
 */
export function getSessionId() {
    const cookies = document.cookie.split('; ');
    for (const cookie of cookies) {
        const [name, ...valueParts] = cookie.split('=');
        if (name === 'bcsid') {
            return valueParts.join('=');
        }
    }
    throw new Error('bcsid cookie not found. User may not be logged in to Citi.');
}

/**
 * Retrieves the current profile information
 * @param {string} sessionId - The session ID
 * @returns {Promise<import('./bank.types').Profile>}
 */
export async function getProfile(sessionId) {
    try {
        const response = await makeAuthenticatedRequest('/digital/customers/globalSiteMessages/welcomeMessage', {
            method: 'GET',
        });

        const data = /** @type {any} */ (await response.json());

        if (!data || !data.welcomeData) {
            throw new Error('Invalid response format from welcome message API');
        }

        const firstName = data.welcomeData.firstName || 'User';

        return {
            sessionId,
            profileId: sessionId,
            profileName: firstName,
        };
    } catch (error) {
        const err = /** @type {Error} */ (error);
        throw new Error(`Failed to get profile: ${err.message}`);
    }
}

/**
 * Retrieves all accounts for the logged-in user
 * @param {import('./bank.types').Profile} profile - The user profile
 * @returns {Promise<import('./bank.types').Account[]>}
 */
export async function getAccounts(profile) {
    try {
        const response = await makeAuthenticatedRequest('/v2/digital/accounts/statementsAndLetters/eligibleAccounts/retrieve', {
            method: 'POST',
            body: JSON.stringify({
                transactionCode: '1079_statements',
            }),
        });

        const data = /** @type {any} */ (await response.json());

        if (!data || !data.eligibleAccounts) {
            throw new Error('Invalid response format from eligible accounts API');
        }

        /** @type {import('./bank.types').Account[]} */
        const accounts = [];

        // Process card accounts
        if (data.eligibleAccounts.cardAccounts && Array.isArray(data.eligibleAccounts.cardAccounts)) {
            for (const cardAccount of data.eligibleAccounts.cardAccounts) {
                // Extract last 4 digits from the account nickname
                // Format: "Citi Strata℠ Card - 9359"
                const match = cardAccount.accountNickname?.match(/(\d{4,5})$/);
                const accountMask = match ? match[1] : cardAccount.accountId.slice(-4);

                accounts.push({
                    profile,
                    accountId: cardAccount.accountId,
                    accountName: cardAccount.accountNickname || cardAccount.productDesc || `Card ${accountMask}`,
                    accountMask,
                    accountType: /** @type {import('./bank.types').AccountType} */ ('CreditCard'),
                });
            }
        }

        // Process bank accounts
        if (data.eligibleAccounts.bankAccounts && Array.isArray(data.eligibleAccounts.bankAccounts)) {
            for (const bankAccount of data.eligibleAccounts.bankAccounts) {
                const match = bankAccount.accountNickname?.match(/(\d{4})$/);
                const accountMask = match ? match[1] : bankAccount.accountId.slice(-4);

                // Determine account type from nickname or other fields
                const nickname = (bankAccount.accountNickname || '').toLowerCase();
                /** @type {import('./bank.types').AccountType} */
                const accountType = nickname.includes('saving') ? 'Savings' : 'Checking';

                accounts.push({
                    profile,
                    accountId: bankAccount.accountId,
                    accountName: bankAccount.accountNickname || `Account ${accountMask}`,
                    accountMask,
                    accountType,
                });
            }
        }

        // Process loan accounts
        if (data.eligibleAccounts.loanAccounts && Array.isArray(data.eligibleAccounts.loanAccounts)) {
            for (const loanAccount of data.eligibleAccounts.loanAccounts) {
                const match = loanAccount.accountNickname?.match(/(\d{4})$/);
                const accountMask = match ? match[1] : loanAccount.accountId.slice(-4);

                accounts.push({
                    profile,
                    accountId: loanAccount.accountId,
                    accountName: loanAccount.accountNickname || `Loan ${accountMask}`,
                    accountMask,
                    accountType: /** @type {import('./bank.types').AccountType} */ ('Loan'),
                });
            }
        }

        return accounts;
    } catch (error) {
        const err = /** @type {Error} */ (error);
        throw new Error(`Failed to get accounts: ${err.message}`);
    }
}

/**
 * Retrieves all statements for a specific account
 * @param {import('./bank.types').Account} account - The account to get statements for
 * @returns {Promise<import('./bank.types').Statement[]>}
 */
export async function getStatements(account) {
    try {
        const response = await makeAuthenticatedRequest('/v2/digital/card/accounts/statements/accountsAndStatements/retrieve', {
            method: 'POST',
            body: JSON.stringify({
                accountId: account.accountId,
            }),
        });

        const data = /** @type {any} */ (await response.json());

        if (!data || !data.statementsByYear) {
            throw new Error('Invalid response format from statements list API');
        }

        const statements = [];

        // Process statements grouped by year
        for (const yearGroup of data.statementsByYear) {
            if (!yearGroup.statementsByMonth || !Array.isArray(yearGroup.statementsByMonth)) {
                continue;
            }

            for (const statement of yearGroup.statementsByMonth) {
                // Parse statement date from MM/DD/YYYY format
                const dateStr = statement.statementDate; // e.g., "07/17/2025"
                const [month, day, year] = dateStr.split('/').map((/** @type {string} */ n) => parseInt(n, 10));
                const statementDate = new Date(year, month - 1, day).toISOString(); // JS months are 0-indexed

                statements.push({
                    account,
                    statementId: statement.statementDate, // Use date as ID
                    statementDate,
                });
            }
        }

        // Sort statements by date descending (newest first)
        statements.sort((a, b) => new Date(b.statementDate).getTime() - new Date(a.statementDate).getTime());

        return statements;
    } catch (error) {
        const err = /** @type {Error} */ (error);
        throw new Error(`Failed to get statements for account ${account.accountId}: ${err.message}`);
    }
}

/**
 * Downloads a statement PDF file
 * @param {import('./bank.types').Statement} statement - The statement to download
 * @returns {Promise<Blob>}
 */
export async function downloadStatement(statement) {
    try {
        // The statementId is the statement date in MM/DD/YYYY format
        const statementDate = statement.statementId;

        const response = await makeAuthenticatedRequest('/v2/digital/card/accounts/statements/recent/retrieve', {
            method: 'POST',
            body: JSON.stringify({
                accountId: statement.account.accountId,
                statementDate: statementDate,
                requestType: 'RECENT STATEMENTS',
            }),
        });

        // The response is directly a PDF binary
        const blob = await response.blob();

        if (blob.size === 0) {
            throw new Error('Downloaded PDF is empty');
        }

        // Verify it's a PDF by checking the content type
        if (!blob.type.includes('pdf')) {
            throw new Error(`Unexpected content type: ${blob.type}. Expected PDF.`);
        }

        return blob;
    } catch (error) {
        const err = /** @type {Error} */ (error);
        throw new Error(`Failed to download statement ${statement.statementId}: ${err.message}`);
    }
}
