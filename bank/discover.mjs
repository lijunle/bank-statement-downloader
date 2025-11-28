/**
 * Discover Bank API implementation for retrieving bank statements
 * @see analyze/discover.md
 * 
 * @typedef {import('../extension/extension.type').RequestFetchMessage} RequestFetchMessage
 * @typedef {import('../extension/extension.type').RequestFetchResponse} RequestFetchResponse
 */

/** @type {string} */
export const bankId = 'discover';

/** @type {string} */
export const bankName = 'Discover';

/**
 * Helper to perform fetch via popup when on wrong domain
 * @param {string} url
 * @param {RequestInit} [options]
 * @returns {Promise<Response>}
 */
async function fetchViaPopup(url, options) {
    try {
        // Try to send message to popup/background
        /** @type {RequestFetchMessage} */
        const message = {
            action: 'requestFetch',
            url,
            options: options ? {
                method: options.method,
                headers: /** @type {Record<string, string>} */ (options.headers),
                credentials: options.credentials
            } : undefined
        };

        /** @type {RequestFetchResponse} */
        const response = await chrome.runtime.sendMessage(message);

        if ('error' in response) {
            throw new Error(response.error);
        }

        // At this point, response is the success type
        const { ok, status, statusText, headers, body } = response;

        // Return a Response-like object
        return /** @type {Response} */ (/** @type {unknown} */ ({
            ok,
            status,
            statusText,
            headers: {
                get: (/** @type {string} */ name) => headers[name.toLowerCase()] || null
            },
            text: async () => body,
            json: async () => JSON.parse(body),
            blob: async () => {
                // Parse base64 if needed, or create blob from text
                if (body.startsWith('data:')) {
                    const res = await fetch(body);
                    return res.blob();
                }
                const bytes = new Uint8Array(body.length);
                for (let i = 0; i < body.length; i++) {
                    bytes[i] = body.charCodeAt(i);
                }
                return new Blob([bytes]);
            }
        }));
    } catch (e) {
        // If messaging fails, fall back to regular fetch
        return fetch(url, options);
    }
}

/**
 * Smart fetch that uses popup for cross-domain requests
 * @param {string} url
 * @param {RequestInit} [options]
 * @returns {Promise<Response>}
 */
async function smartFetch(url, options) {
    const hostname = window.location.hostname;

    // Check if we need to use popup for this request
    if (url.includes('card.discover.com') && !hostname.includes('card.discover.com')) {
        return fetchViaPopup(url, options);
    }
    if (url.includes('bank.discover.com') && !hostname.includes('bank.discover.com')) {
        return fetchViaPopup(url, options);
    }

    // Otherwise use regular fetch
    return fetch(url, options);
}

const PORTAL_BASE_URL = 'https://portal.discover.com';
const CARD_BASE_URL = 'https://card.discover.com';
const BANK_BASE_URL = 'https://bank.discover.com';

/**
 * Get the current session ID from cookies
 * @returns {string} - The session ID (customerId cookie value)
 */
export function getSessionId() {
    const cookies = document.cookie;

    // Check for required session cookies
    const hasCustomerId = cookies.includes('customerId=');
    const hasCif = cookies.includes('cif=');
    const hasSecToken = cookies.includes('sectoken=');

    if (!hasCustomerId || !hasCif || !hasSecToken) {
        throw new Error('User is not logged in - missing required session cookies');
    }

    const customerIdMatch = cookies.match(/customerId=([^;]+)/);
    if (!customerIdMatch) {
        throw new Error('Failed to extract customerId from cookies');
    }

    return customerIdMatch[1];
}

/**
 * Get the current user profile
 * Uses portal domain APIs that work from both card and bank domains
 * @param {string} sessionId - The session ID (customerId)
 * @returns {Promise<import('./bank.types').Profile>}
 */
export async function getProfile(sessionId) {
    try {
        // Call both portal APIs in parallel (one may fail if user doesn't have that account type)
        const [cardResponse, bankResponse] = await Promise.all([
            fetch(`${PORTAL_BASE_URL}/enterprise/navigation-api/v1/customer/info/card?`, {
                credentials: 'include',
                headers: {
                    'Accept': 'application/json',
                }
            }).catch(() => null),
            fetch(`${PORTAL_BASE_URL}/enterprise/navigation-api/v1/customer/info/bank?`, {
                credentials: 'include',
                headers: {
                    'Accept': 'application/json',
                }
            }).catch(() => null)
        ]);

        const cardData = cardResponse && cardResponse.ok ? await cardResponse.json() : { profile: null };
        const bankData = bankResponse && bankResponse.ok ? await bankResponse.json() : { profile: null };

        // Get profile from whichever response has it
        const profileData = cardData.profile || bankData.profile;

        if (!profileData || !profileData.email) {
            throw new Error('Failed to retrieve user profile from portal APIs');
        }

        return {
            sessionId: sessionId,
            profileId: profileData.email, // Use email as profile ID
            profileName: profileData.name || 'Discover User',
        };
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        throw new Error(`Failed to get profile: ${message}`);
    }
}

/**
 * Get all accounts for the user
 * Combines both card and bank accounts from portal APIs
 * @param {import('./bank.types').Profile} profile - The user profile
 * @returns {Promise<import('./bank.types').Account[]>}
 */
export async function getAccounts(profile) {
    try {
        // Call both portal APIs in parallel
        const [cardResponse, bankResponse] = await Promise.all([
            fetch(`${PORTAL_BASE_URL}/enterprise/navigation-api/v1/customer/info/card?`, {
                credentials: 'include',
                headers: {
                    'Accept': 'application/json',
                }
            }).catch(() => null),
            fetch(`${PORTAL_BASE_URL}/enterprise/navigation-api/v1/customer/info/bank?`, {
                credentials: 'include',
                headers: {
                    'Accept': 'application/json',
                }
            }).catch(() => null)
        ]);

        const cardData = cardResponse && cardResponse.ok ? await cardResponse.json() : null;
        const bankData = bankResponse && bankResponse.ok ? await bankResponse.json() : null;

        /** @type {import('./bank.types').Account[]} */
        const accounts = [];
        const seenAccountIds = new Set();

        /**
         * Process a single account and add to accounts array
         * @param {any} acct
         * @param {string} expectedType - 'BANK' or 'CARD'
         */
        const processAccount = (acct, expectedType) => {
            if (!acct || acct.accountType !== expectedType) return;
            if (seenAccountIds.has(acct.accountId)) return; // Skip duplicates

            seenAccountIds.add(acct.accountId);

            if (expectedType === 'BANK') {
                accounts.push({
                    profile,
                    accountId: acct.accountId,
                    accountName: acct.accountDesc || `Account ${acct.lastFourAccountNumber}`,
                    accountMask: acct.lastFourAccountNumber,
                    accountType: mapAccountType(acct.accountSubType),
                });
            } else {
                accounts.push({
                    profile,
                    accountId: acct.accountId,
                    accountName: acct.accountDesc || `Card ${acct.lastFourAccountNumber}`,
                    accountMask: acct.lastFourAccountNumber,
                    accountType: /** @type {import('./bank.types').AccountType} */ ('CreditCard'),
                });
            }
        };

        // Process accounts from card API
        // Note: selectedAccount matches the API name (CARD), accounts array has opposite type (BANK)
        if (cardData) {
            // Process selectedAccount (will be CARD type)
            if (cardData.selectedAccount) {
                processAccount(cardData.selectedAccount, 'CARD');
                processAccount(cardData.selectedAccount, 'BANK'); // Try both types
            }
            // Process accounts array (will be BANK type)
            if (cardData.accounts && Array.isArray(cardData.accounts)) {
                for (const acct of cardData.accounts) {
                    processAccount(acct, 'CARD');
                    processAccount(acct, 'BANK'); // Try both types
                }
            }
        }

        // Process accounts from bank API
        // Note: selectedAccount matches the API name (BANK), accounts array has opposite type (CARD)
        if (bankData) {
            // Process selectedAccount (will be BANK type)
            if (bankData.selectedAccount) {
                processAccount(bankData.selectedAccount, 'CARD');
                processAccount(bankData.selectedAccount, 'BANK'); // Try both types
            }
            // Process accounts array (will be CARD type)
            if (bankData.accounts && Array.isArray(bankData.accounts)) {
                for (const acct of bankData.accounts) {
                    processAccount(acct, 'CARD');
                    processAccount(acct, 'BANK'); // Try both types
                }
            }
        }

        if (accounts.length === 0) {
            throw new Error('No accounts found for user');
        }

        return accounts;
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        throw new Error(`Failed to get accounts: ${message}`);
    }
}

/**
 * Map Discover account subtype to standard account type
 * @param {string} [subType] - The account subtype code (e.g., "002" for checking)
 * @returns {import('./bank.types').AccountType}
 */
function mapAccountType(subType) {
    // Map based on common Discover account subtypes
    if (subType === '002' || subType === 'checking') {
        return /** @type {import('./bank.types').AccountType} */ ('Checking');
    }
    if (subType === '003' || subType === 'savings') {
        return /** @type {import('./bank.types').AccountType} */ ('Savings');
    }
    // Default to Checking for unknown bank account types
    return /** @type {import('./bank.types').AccountType} */ ('Checking');
}

/**
 * Determine if account is a credit card or bank account
 * @param {import('./bank.types').Account} account
 * @returns {'card' | 'bank'}
 */
function getAccountDomain(account) {
    return account.accountType === 'CreditCard' ? 'card' : 'bank';
}

/**
 * Get statements for a credit card account
 * @param {import('./bank.types').Account} account
 * @returns {Promise<import('./bank.types').Statement[]>}
 */
async function getCardStatements(account) {
    try {
        // First, get the last statement date to use as the stmtDate parameter
        const recentResponse = await smartFetch(
            `${CARD_BASE_URL}/cardissuer/statements/transactions/v1/recent?source=achome&transOnly=Y&selAcct=${account.accountId}`,
            {
                credentials: 'include',
                headers: {
                    'Accept': 'application/json',
                }
            }
        );

        if (!recentResponse.ok) {
            throw new Error(`API request failed: ${recentResponse.status} ${recentResponse.statusText}`);
        }

        // Strip security prefix ")]}', " before parsing JSON
        const recentText = await recentResponse.text();
        const cleanedRecentText = recentText.replace(/^\)\]\}',\s*/, '');
        const recentData = JSON.parse(cleanedRecentText);

        if (!recentData.summaryData || !recentData.summaryData.lastStmtDate) {
            // No statements available
            return [];
        }

        // Parse the statement date (format: MM/DD/YYYY) to get stmtDate parameter
        const dateMatch = recentData.summaryData.lastStmtDate.match(/(\d{2})\/(\d{2})\/(\d{4})/);
        if (!dateMatch) {
            throw new Error(`Invalid statement date format: ${recentData.summaryData.lastStmtDate}`);
        }

        const [, month, day, year] = dateMatch;
        const stmtDate = `${year}${month}${day}`; // YYYYMMDD format

        // Get the full list of statements
        const stmtResponse = await smartFetch(
            `${CARD_BASE_URL}/cardmembersvcs/statements/app/v2/stmt?stmtDate=${stmtDate}`,
            {
                credentials: 'include',
                headers: {
                    'Accept': 'application/json',
                }
            }
        );

        if (!stmtResponse.ok) {
            throw new Error(`Statement list API request failed: ${stmtResponse.status} ${stmtResponse.statusText}`);
        }

        // Strip security prefix ")]}', " before parsing JSON
        const stmtText = await stmtResponse.text();
        const cleanedText = stmtText.replace(/^\)\]\}',\s*/, '');
        const outerData = JSON.parse(cleanedText);

        // The actual data is in jsonResponse field as a string that needs to be parsed again
        const stmtData = JSON.parse(outerData.jsonResponse);

        if (!stmtData.statements || !Array.isArray(stmtData.statements)) {
            // No statements available
            return [];
        }

        // Parse each statement and extract the date from pdfUri
        const statements = [];
        for (const stmt of stmtData.statements) {
            if (!stmt.pdfAvailable || !stmt.pdfUri) {
                continue;
            }

            // Extract date from pdfUri: /cardmembersvcs/statements/app/stmtPDF?view=true&date=20251020
            const dateParam = stmt.pdfUri.match(/date=(\d{8})/);
            if (!dateParam) {
                continue;
            }

            const statementId = dateParam[1]; // YYYYMMDD format
            const year = statementId.substring(0, 4);
            const month = statementId.substring(4, 6);
            const day = statementId.substring(6, 8);
            const statementDate = new Date(`${year}-${month}-${day}`).toISOString();

            statements.push({
                account,
                statementId,
                statementDate,
            });
        }

        return statements;
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        throw new Error(message);
    }
}

/**
 * Get statements for a bank account
 * @param {import('./bank.types').Account} account
 * @returns {Promise<import('./bank.types').Statement[]>}
 */
async function getBankStatements(account) {
    try {
        const response = await fetch(
            `${BANK_BASE_URL}/bank/deposits/servicing/documents/v1/accounts/${account.accountId}/statements`,
            {
                credentials: 'include',
                headers: {
                    'Accept': 'application/json',
                }
            }
        );

        if (!response.ok) {
            throw new Error(`API request failed: ${response.status} ${response.statusText}`);
        }

        const data = await response.json();

        if (!Array.isArray(data)) {
            throw new Error('Invalid response format: expected array of statements');
        }

        const statements = [];
        for (const stmt of data) {
            if (stmt.id && stmt.statementDate) {
                // Use the pre-encoded URL from links as the statement ID
                const downloadUrl = stmt.links?.find((/** @type {any} */ l) => l.rel === 'binary')?.href;
                statements.push({
                    account,
                    statementId: downloadUrl || stmt.id, // Use download URL if available, fallback to ID
                    statementDate: new Date(stmt.statementDate).toISOString(),
                });
            }
        }

        return statements;
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        throw new Error(message);
    }
}

/**
 * Get statements for an account
 * Routes to appropriate API based on account type
 * @param {import('./bank.types').Account} account - The account
 * @returns {Promise<import('./bank.types').Statement[]>}
 */
export async function getStatements(account) {
    const domain = getAccountDomain(account);

    if (domain === 'card') {
        return getCardStatements(account);
    } else {
        return getBankStatements(account);
    }
}

/**
 * Download a credit card statement PDF
 * @param {import('./bank.types').Statement} statement
 * @returns {Promise<Blob>}
 */
async function downloadCardStatement(statement) {
    try {
        // Set the dfsedskey cookie to specify which account
        document.cookie = `dfsedskey=${statement.account.accountId}; path=/; domain=.discover.com`;

        // Statement ID is already in YYYYMMDD format
        const response = await smartFetch(
            `${CARD_BASE_URL}/cardmembersvcs/statements/app/stmtPDF?view=true&date=${statement.statementId}`,
            {
                credentials: 'include',
                headers: {
                    'Accept': 'application/pdf, */*',
                }
            }
        );

        if (!response.ok) {
            throw new Error(`PDF download failed: ${response.status} ${response.statusText}`);
        }

        if (!response.headers.get('content-type')?.includes('pdf')) {
            throw new Error('Response is not a PDF file');
        }

        return await response.blob();
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        throw new Error(message);
    }
}

/**
 * Download a bank account statement PDF
 * @param {import('./bank.types').Statement} statement
 * @returns {Promise<Blob>}
 */
async function downloadBankStatement(statement) {
    try {
        // If statement ID is a full URL, use it directly
        let url;
        if (statement.statementId.startsWith('http://') || statement.statementId.startsWith('https://')) {
            url = statement.statementId;
        } else {
            // Fallback: construct URL with encoded statement ID
            const encodedStatementId = encodeURIComponent(statement.statementId);
            url = `${BANK_BASE_URL}/bank/deposits/servicing/documents/v1/accounts/${statement.account.accountId}/statements/${encodedStatementId}`;
        }

        const response = await fetch(url, {
            credentials: 'include',
            headers: {
                'Accept': 'application/pdf',
                'Referer': `${BANK_BASE_URL}/web/deposits/documents/statements`,
            }
        });

        if (!response.ok) {
            throw new Error(`PDF download failed: ${response.status} ${response.statusText}`);
        }

        if (!response.headers.get('content-type')?.includes('pdf')) {
            throw new Error('Response is not a PDF file');
        }

        return await response.blob();
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        throw new Error(`Failed to download bank statement: ${message}`);
    }
}

/**
 * Download a statement PDF
 * Routes to appropriate API based on account type
 * @param {import('./bank.types').Statement} statement - The statement to download
 * @returns {Promise<Blob>}
 */
export async function downloadStatement(statement) {
    const domain = getAccountDomain(statement.account);

    if (domain === 'card') {
        return downloadCardStatement(statement);
    } else {
        return downloadBankStatement(statement);
    }
}
