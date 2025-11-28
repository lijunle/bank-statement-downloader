/**
 * @typedef {import('./bank.types.ts').Profile} Profile
 * @typedef {import('./bank.types.ts').Account} Account
 * @typedef {import('./bank.types.ts').Statement} Statement
 */

/** @type {string} */
export const bankId = 'mbna_ca';

/** @type {string} */
export const bankName = 'MBNA Canada';

/**
 * Base URL for MBNA Canada API
 */
const BASE_URL = 'https://service.mbna.ca/waw/mbna';

/**
 * Get session ID from cookies or storage
 * Note: JSESSIONID and AUTHSTATE are HttpOnly and cannot be accessed via document.cookie.
 * This function returns the value of com.td.last_login cookie as the session identifier.
 * @returns {string} Session identifier from com.td.last_login cookie value
 */
export function getSessionId() {
    const cookies = document.cookie.split('; ');

    for (const cookie of cookies) {
        const [name, value] = cookie.split('=');
        if (name === 'com.td.last_login' && value) {
            return value;
        }
    }

    throw new Error('Session cookie not found. Please log in first.');
}

/**
 * Get the current user profile information
 * @param {string} sessionId - The session ID placeholder (actual cookie sent automatically)
 * @returns {Promise<Profile>} User profile information
 */
export async function getProfile(sessionId) {
    const response = await fetch(`${BASE_URL}/customer-profile`, {
        method: 'GET',
        headers: {
            Accept: 'application/json, text/plain, */*',
        },
        credentials: 'include',
    });

    if (!response.ok) {
        throw new Error(
            `Failed to get profile: ${response.status} ${response.statusText}`
        );
    }

    const data = await response.json();

    return {
        sessionId: sessionId,
        profileId: `${data.customerName.firstname}_${data.customerName.lastname}`,
        profileName: `${data.customerName.firstname} ${data.customerName.lastname}`,
    };
}

/**
 * Get all accounts for the current user
 * @param {Profile} profile - User profile information
 * @returns {Promise<Account[]>} List of accounts
 */
export async function getAccounts(profile) {
    const response = await fetch(`${BASE_URL}/accounts/summary`, {
        method: 'GET',
        headers: {
            Accept: 'application/json, text/plain, */*',
        },
        credentials: 'include',
    });

    if (!response.ok) {
        throw new Error(
            `Failed to get accounts: ${response.status} ${response.statusText}`
        );
    }

    const data = await response.json();

    return data.map(
        /** @param {any} account */
        (account) => ({
            profile: profile,
            accountId: account.accountId,
            accountName: account.cardName,
            accountMask: account.endingIn,
            accountType: /** @type {import('./bank.types.ts').AccountType} */ (
                'CreditCard'
            ),
        })
    );
}

/**
 * Get all statements for an account
 * @param {Account} account - The account to get statements for
 * @returns {Promise<Statement[]>} List of statements
 */
export async function getStatements(account) {
    const currentYear = new Date().getFullYear();
    const statements = [];

    // Try to get statements for the current year and previous years
    // MBNA provides up to 7 years of statements
    for (let year = currentYear; year >= currentYear - 6; year--) {
        try {
            const response = await fetch(
                `${BASE_URL}/accounts/${account.accountId}/statement-history/${year}`,
                {
                    method: 'GET',
                    headers: {
                        Accept: 'application/json, text/plain, */*',
                    },
                    credentials: 'include',
                }
            );

            if (!response.ok) {
                // If we get a 404 or error, this year might not have statements
                // Continue to the next year instead of throwing
                continue;
            }

            const data = await response.json();

            if (data.StatementItem && Array.isArray(data.StatementItem)) {
                for (const item of data.StatementItem) {
                    statements.push({
                        account: account,
                        statementId: item.closingDateFmted,
                        statementDate: item.closingDateFmted,
                    });
                }
            }
        } catch (error) {
            // If there's an error for this year, continue to the next year
            continue;
        }
    }

    return statements;
}

/**
 * Download a statement PDF file
 * @param {Statement} statement - The statement to download
 * @returns {Promise<Blob>} The statement PDF file as a Blob
 */
export async function downloadStatement(statement) {
    const url = `${BASE_URL}/accounts/${statement.account.accountId}/statement-history/open-save/selected-date/${statement.statementDate}?format=PDF&contentDisposition=attachment&folder=&insertDocId=`;

    const response = await fetch(url, {
        method: 'GET',
        headers: {
            Accept: 'application/pdf, */*',
        },
        credentials: 'include',
    });

    if (!response.ok) {
        throw new Error(
            `Failed to download statement: ${response.status} ${response.statusText}`
        );
    }

    return await response.blob();
}
