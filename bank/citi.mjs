/**
 * Citi Bank API implementation for retrieving bank statements
 * @see analyze/citi.md
 */

/** @type {string} */
export const bankId = 'citi';

/** @type {string} */
export const bankName = 'Citi';

const BASE_URL = 'https://online.citi.com/gcgapi/prod/public/v1';

/** @param {any} value */
function isObject(value) {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/** @param {unknown} value @returns {string} */
function statementDateIso(value) {
    if (typeof value !== 'string' || !/^\d{2}\/\d{2}\/\d{4}$/.test(value)) {
        throw new Error('Invalid statement date from Citi');
    }
    const [month, day, year] = value.split('/');
    const calendar = `${year}-${month}-${day}`;
    const date = new Date(`${calendar}T00:00:00.000Z`);
    if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== calendar) {
        throw new Error('Invalid statement date from Citi');
    }
    return date.toISOString();
}

/** @param {any} account @returns {string} */
function accountMask(account) {
    if (!isObject(account) || typeof account.accountId !== 'string' || !account.accountId.trim() ||
        typeof account.accountNickname !== 'string') {
        throw new Error('Invalid Citi account data');
    }
    const match = account.accountNickname.match(/\b(\d{4,5})\s*$/);
    if (!match) throw new Error('Invalid Citi account mask');
    return match[1];
}

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

        if (!isObject(data) || !isObject(data.welcomeData) ||
            (data.welcomeData.firstName !== undefined && typeof data.welcomeData.firstName !== 'string')) {
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

        if (!isObject(data) || !isObject(data.eligibleAccounts)) {
            throw new Error('Invalid response format from eligible accounts API');
        }
        if (data.bankHostSystemDownFlag === true || data.cardsHostSystemDownFlag === true ||
            data.isCardsHostSystemDownFlag === true) {
            throw new Error('Citi account service is temporarily unavailable');
        }
        const groups = ['cardAccounts', 'bankAccounts', 'loanAccounts'];
        if (!groups.some(group => Array.isArray(data.eligibleAccounts[group])) ||
            groups.some(group => data.eligibleAccounts[group] !== undefined && !Array.isArray(data.eligibleAccounts[group]))) {
            throw new Error('Invalid Citi account groups');
        }

        /** @type {import('./bank.types').Account[]} */
        const accounts = [];

        // Process card accounts
        if (data.eligibleAccounts.cardAccounts && Array.isArray(data.eligibleAccounts.cardAccounts)) {
            for (const cardAccount of data.eligibleAccounts.cardAccounts) {
                const mask = accountMask(cardAccount);

                accounts.push({
                    profile,
                    accountId: cardAccount.accountId,
                    accountName: cardAccount.accountNickname,
                    accountMask: mask,
                    accountType: /** @type {import('./bank.types').AccountType} */ ('CreditCard'),
                });
            }
        }

        // Process bank accounts
        if (data.eligibleAccounts.bankAccounts && Array.isArray(data.eligibleAccounts.bankAccounts)) {
            for (const bankAccount of data.eligibleAccounts.bankAccounts) {
                const mask = accountMask(bankAccount);

                // Determine account type from nickname or other fields
                const nickname = (bankAccount.accountNickname || '').toLowerCase();
                /** @type {import('./bank.types').AccountType} */
                const accountType = nickname.includes('saving') ? 'Savings' : 'Checking';

                accounts.push({
                    profile,
                    accountId: bankAccount.accountId,
                    accountName: bankAccount.accountNickname,
                    accountMask: mask,
                    accountType,
                });
            }
        }

        // Process loan accounts
        if (data.eligibleAccounts.loanAccounts && Array.isArray(data.eligibleAccounts.loanAccounts)) {
            for (const loanAccount of data.eligibleAccounts.loanAccounts) {
                const mask = accountMask(loanAccount);

                accounts.push({
                    profile,
                    accountId: loanAccount.accountId,
                    accountName: loanAccount.accountNickname,
                    accountMask: mask,
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

        if (!isObject(data) || !Array.isArray(data.statementsByYear)) {
            throw new Error('Invalid response format from statements list API');
        }

        const statements = [];

        // Process statements grouped by year
        for (const yearGroup of data.statementsByYear) {
            if (!isObject(yearGroup) || !Array.isArray(yearGroup.statementsByMonth)) {
                throw new Error('Invalid Citi statement year group');
            }

            for (const statement of yearGroup.statementsByMonth) {
                if (!isObject(statement)) throw new Error('Invalid Citi statement entry');
                const statementDate = statementDateIso(statement.statementDate);

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
        statementDateIso(statementDate);

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
        if (blob.type.split(';')[0].trim().toLowerCase() !== 'application/pdf') {
            throw new Error(`Unexpected content type: ${blob.type}. Expected PDF.`);
        }
        if (await blob.slice(0, 5).text() !== '%PDF-') {
            throw new Error('Citi did not return a PDF statement');
        }

        return blob;
    } catch (error) {
        const err = /** @type {Error} */ (error);
        throw new Error(`Failed to download statement ${statement.statementId}: ${err.message}`);
    }
}
