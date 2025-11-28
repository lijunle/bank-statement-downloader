/**
 * @file SoFi Bank API implementation
 * @see analyze/sofi.md
 */

/**
 * @typedef {import('./bank.types').Profile} Profile
 * @typedef {import('./bank.types').Account} Account
 * @typedef {import('./bank.types').Statement} Statement
 */

/** @type {string} */
export const bankId = 'sofi';

/** @type {string} */
export const bankName = 'SoFi';

/**
 * Get the current session ID from cookies
 * @returns {string} The session ID if logged in
 */
export function getSessionId() {
    // Try multiple possible session identifiers
    const sofiToken = getCookie('SOFI');
    const csrfToken = getCookie('SOFI_R_CSRF_TOKEN');
    const sessionId = getCookie('ab.storage.sessionId.55c370dd-bb3f-475c-8a54-50403ffea8cc');

    // The SOFI cookie might not be accessible due to HttpOnly or domain restrictions
    // We'll use CSRF token as a fallback identifier, but actual auth happens via HttpOnly cookies
    const identifier = sofiToken || csrfToken || sessionId || 'session';

    console.log('[SoFi] Session identifier:', identifier === 'session' ? 'Using default (HttpOnly cookies)' : `Found (${identifier.length} chars)`);

    // Return an identifier - the actual authentication happens via HttpOnly cookies
    // that are automatically sent with fetch requests using credentials: 'include'
    return identifier;
}

/**
 * Retrieve the current user profile information
 * @param {string} sessionId - The session ID (not used directly, relies on cookies)
 * @returns {Promise<Profile>} User profile information
 */
export async function getProfile(sessionId) {
    if (!sessionId) {
        throw new Error('Session ID is required');
    }

    try {
        const response = await fetch('https://www.sofi.com/banking-service/api/public/v2/customer', {
            method: 'GET',
            credentials: 'include',
            headers: {
                'Accept': 'application/json',
            },
        });

        if (!response.ok) {
            throw new Error(`Failed to retrieve profile: HTTP ${response.status}`);
        }

        const data = await response.json();

        return {
            sessionId: sessionId,
            profileId: data.sofiId,
            profileName: `${data.firstName} ${data.lastName}`,
        };
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        throw new Error(`Failed to retrieve profile: ${message}`);
    }
}

/**
 * Retrieve all accounts for the user
 * @param {Profile} profile - User profile information
 * @returns {Promise<Account[]>} List of accounts
 */
export async function getAccounts(profile) {
    try {
        const response = await fetch('https://www.sofi.com/money/api/public/v2/accounts', {
            method: 'GET',
            credentials: 'include',
            headers: {
                'Accept': 'application/json',
            },
        });

        if (!response.ok) {
            throw new Error(`Failed to retrieve accounts: HTTP ${response.status}`);
        }

        const data = await response.json();

        if (!data.accounts || !Array.isArray(data.accounts)) {
            throw new Error('Invalid response format: accounts array not found');
        }

        return data.accounts.map((/** @type {any} */ account) => ({
            profile: profile,
            accountId: account.id,
            accountName: account.nickname || `${account.type} - ${account.number.slice(-4)}`,
            accountMask: account.number.slice(-4),
            accountType: account.type === 'CHECKING' ? 'Checking' :
                account.type === 'SAVING' ? 'Savings' : 'Checking',
        }));
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        throw new Error(`Failed to retrieve accounts: ${message}`);
    }
}

/**
 * Retrieve all statements for an account
 * @param {Account} account - Account information
 * @returns {Promise<Statement[]>} List of statements
 */
export async function getStatements(account) {
    try {
        const response = await fetch('https://www.sofi.com/banking-service/api/public/v2/statements', {
            method: 'GET',
            credentials: 'include',
            headers: {
                'Accept': 'application/json',
            },
        });

        if (!response.ok) {
            throw new Error(`Failed to retrieve statements: HTTP ${response.status}`);
        }

        const data = await response.json();

        if (!Array.isArray(data)) {
            throw new Error('Invalid response format: expected array of statements');
        }

        // SoFi provides combined statements that include all accounts
        // We return all statements for any account since they're combined
        return data.map((/** @type {any} */ statement) => ({
            account: account,
            statementId: statement.documentId,
            statementDate: statement.statementDate,
        }));
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        throw new Error(`Failed to retrieve statements: ${message}`);
    }
}

/**
 * Download a statement file
 * @param {Statement} statement - Statement information
 * @returns {Promise<Blob>} Statement file as a Blob
 */
export async function downloadStatement(statement) {
    if (!statement.statementId) {
        throw new Error('Statement ID is required');
    }

    try {
        const response = await fetch(
            `https://www.sofi.com/banking-service/api/public/v2/statements/${statement.statementId}`,
            {
                method: 'GET',
                credentials: 'include',
                headers: {
                    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
                    'Referer': 'https://www.sofi.com/my/money/account/more/statements-documents',
                },
            }
        );

        if (!response.ok) {
            throw new Error(`Failed to download statement: HTTP ${response.status}`);
        }

        const contentType = response.headers.get('content-type');
        if (!contentType || !contentType.includes('application/pdf')) {
            throw new Error(`Unexpected content type: ${contentType}`);
        }

        return await response.blob();
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        throw new Error(`Failed to download statement: ${message}`);
    }
}

/**
 * Get a cookie value by name
 * @param {string} name - Cookie name
 * @returns {string | null} Cookie value or null if not found
 */
function getCookie(name) {
    const cookies = document.cookie.split(';');
    for (const cookie of cookies) {
        const [cookieName, cookieValue] = cookie.trim().split('=');
        if (cookieName === name) {
            return decodeURIComponent(cookieValue);
        }
    }
    return null;
}
