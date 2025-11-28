/**
 * Questrade Bank API implementation for retrieving bank statements
 * @see analyze/questrade.md
 */

/** @type {string} */
export const bankId = 'questrade';

/** @type {string} */
export const bankName = 'Questrade';

const LOGIN_BASE_URL = 'https://login.questrade.com';
const API_BASE_URL = 'https://api.questrade.com';

/**
 * Get the current session ID (Bearer token)
 * 
 * For Questrade, the Bearer token is obtained through OAuth 2.0 flow.
 * Questrade uses OIDC (OpenID Connect) and stores tokens in sessionStorage with keys like:
 * "oidc.user:https://login.questrade.com/:{client-id}"
 * 
 * @returns {string} The Bearer token (session ID)
 */
export function getSessionId() {
    // Check sessionStorage for OIDC tokens first
    if (typeof sessionStorage !== 'undefined') {
        // Prioritize client ID a1a47248-1840-49c7-b2a2-410dfe48fbd1 which has the broadest API access
        // This client has scopes: brokerage.accounts.all, brokerage.orders.all, brokerage.balances.all, etc.
        const preferredKey = 'oidc.user:https://login.questrade.com/:a1a47248-1840-49c7-b2a2-410dfe48fbd1';
        const preferredValue = sessionStorage.getItem(preferredKey);
        if (preferredValue) {
            try {
                const parsed = JSON.parse(preferredValue);
                if (parsed.access_token && typeof parsed.access_token === 'string') {
                    return parsed.access_token;
                }
            } catch (e) {
                // Fall through to other tokens
            }
        }

        // Look for other OIDC tokens stored by the Questrade portal
        for (let i = 0; i < sessionStorage.length; i++) {
            const key = sessionStorage.key(i);
            if (key && key.startsWith('oidc.user:https://login.questrade.com:')) {
                const value = sessionStorage.getItem(key);
                if (value) {
                    try {
                        const parsed = JSON.parse(value);
                        if (parsed.access_token && typeof parsed.access_token === 'string') {
                            return parsed.access_token;
                        }
                    } catch (e) {
                        continue;
                    }
                }
            }
        }
    }

    // Fallback to common OAuth 2.0 storage keys
    const storageKeys = [
        'access_token',
        'bearer_token',
        'oauth_token',
        'auth_token',
        'questrade_token',
    ];

    // Check sessionStorage
    if (typeof sessionStorage !== 'undefined') {
        for (const key of storageKeys) {
            const value = sessionStorage.getItem(key);
            if (value) {
                return value;
            }
        }
    }

    // Check localStorage
    if (typeof localStorage !== 'undefined') {
        for (const key of storageKeys) {
            const value = localStorage.getItem(key);
            if (value) {
                return value;
            }
        }
    }

    // Check cookies for session identifiers
    if (typeof document !== 'undefined' && document.cookie) {
        const cookies = document.cookie.split(';');
        for (const cookie of cookies) {
            const [name, value] = cookie.trim().split('=');
            if (name === 'idsrv.session.prod' && value) {
                // Use the session cookie as identifier
                // Note: This is not the Bearer token but can serve as session ID
                return value;
            }
        }
    }

    throw new Error(
        'Questrade session not found. Please ensure you are logged in. ' +
        'The Bearer token must be available in sessionStorage, localStorage, or cookies.'
    );
}

/**
 * Find OIDC token with specific scopes
 * @param {string[]} requiredScopes - Array of required scope strings (partial match)
 * @returns {string|null} The access token or null if not found
 */
function findTokenWithScopes(requiredScopes) {
    if (typeof sessionStorage === 'undefined') {
        return null;
    }

    for (let i = 0; i < sessionStorage.length; i++) {
        const key = sessionStorage.key(i);
        // Match both patterns: "oidc.user:https://login.questrade.com:..." and "oidc.user:https://login.questrade.com/:..."
        if (key && (key.startsWith('oidc.user:https://login.questrade.com:') || key.startsWith('oidc.user:https://login.questrade.com/:'))) {
            const value = sessionStorage.getItem(key);
            if (value) {
                try {
                    const parsed = JSON.parse(value);

                    if (parsed.access_token && parsed.scope) {
                        const scopes = parsed.scope.split(' ');
                        const hasAllScopes = requiredScopes.every(required =>
                            scopes.some((/** @type {string} */ scope) => scope.includes(required))
                        );
                        if (hasAllScopes) {
                            return parsed.access_token;
                        }
                    }
                } catch (e) {
                    continue;
                }
            }
        }
    }

    return null;
}

/**
 * Decode JWT token (Base64URL decode without verification)
 * @param {string} token - JWT token
 * @returns {any} Decoded JWT payload or null if invalid
 */
function decodeJWT(token) {
    try {
        const parts = token.split('.');
        if (parts.length !== 3) {
            throw new Error('Invalid JWT format');
        }

        // Decode the payload (second part)
        const payload = parts[1];
        // Replace Base64URL chars with Base64
        const base64 = payload.replace(/-/g, '+').replace(/_/g, '/');
        // Add padding if needed
        const padded = base64 + '='.repeat((4 - base64.length % 4) % 4);

        const decoded = atob(padded);
        return JSON.parse(decoded);
    } catch (e) {
        console.error('Failed to decode JWT:', e);
        return null;
    }
}

/**
 * Get the current user profile
 * @param {string} sessionId - The Bearer token
 * @returns {Promise<import('./bank.types').Profile>}
 */
export async function getProfile(sessionId) {
    // Try to get user info from OIDC token in sessionStorage first
    // This avoids CORS issues with /connect/userinfo endpoint
    if (typeof sessionStorage !== 'undefined') {
        for (let i = 0; i < sessionStorage.length; i++) {
            const key = sessionStorage.key(i);
            if (key && key.startsWith('oidc.user:https://login.questrade.com:')) {
                const value = sessionStorage.getItem(key);
                if (value) {
                    try {
                        const oidcData = JSON.parse(value);

                        // Try to get name from profile object (if cached by OIDC client)
                        if (oidcData.profile) {
                            const profile = oidcData.profile;
                            const firstName = profile.given_name || '';
                            const lastName = profile.family_name || '';
                            const profileName = `${firstName} ${lastName}`.trim() ||
                                profile.preferred_username ||
                                profile.name ||
                                'User';
                            const profileId = profile.sub || '';

                            if (profileName !== 'User') {
                                return {
                                    sessionId,
                                    profileId,
                                    profileName,
                                };
                            }
                        }

                        // Try to decode id_token to extract user claims
                        if (oidcData.id_token && typeof oidcData.id_token === 'string') {
                            const payload = decodeJWT(oidcData.id_token);
                            if (payload) {
                                const firstName = payload.given_name || '';
                                const lastName = payload.family_name || '';
                                const profileName = `${firstName} ${lastName}`.trim() ||
                                    payload.preferred_username ||
                                    payload.name ||
                                    'User';
                                const profileId = payload.sub || '';

                                if (profileName !== 'User') {
                                    return {
                                        sessionId,
                                        profileId,
                                        profileName,
                                    };
                                }
                            }
                        }
                    } catch (e) {
                        console.error('Error parsing OIDC token:', e);
                        continue;
                    }
                }
            }
        }
    }

    // Fallback: Try to call /connect/userinfo API (may have CORS issues from myportal.questrade.com)
    try {
        const response = await fetch(`${LOGIN_BASE_URL}/connect/userinfo`, {
            method: 'GET',
            headers: {
                'Authorization': `Bearer ${sessionId}`,
                'Accept': 'application/json',
            },
            credentials: 'include',
        });

        if (!response.ok) {
            throw new Error(`Failed to get user profile: ${response.status} ${response.statusText}`);
        }

        const data = await response.json();

        if (!data || typeof data !== 'object') {
            throw new Error('Invalid response format from userinfo API');
        }

        // The API may return an array or object depending on context
        const userData = Array.isArray(data) ? data[0] : data;

        const profileId = userData['user-profile-id'] || userData.sub || '';
        const firstName = userData.given_name || '';
        const lastName = userData.family_name || '';
        const profileName = `${firstName} ${lastName}`.trim() || userData.preferred_username || 'User';

        return {
            sessionId,
            profileId,
            profileName,
        };
    } catch (error) {
        console.error('Failed to retrieve Questrade profile via API (CORS may be blocking):', error);

        // Return minimal profile if we couldn't get it from token or API
        return {
            sessionId,
            profileId: '',
            profileName: 'User',
        };
    }
}

/**
 * Get all brokerage accounts for the user
 * @param {import('./bank.types').Profile} profile - The user profile
 * @returns {Promise<import('./bank.types').Account[]>}
 */
export async function getAccounts(profile) {
    try {
        const response = await fetch(`${API_BASE_URL}/v3/brokerage-accounts`, {
            method: 'GET',
            headers: {
                'Authorization': `Bearer ${profile.sessionId}`,
                'Accept': 'application/json',
            },
            credentials: 'include',
        });

        if (!response.ok) {
            throw new Error(`Failed to get accounts: ${response.status} ${response.statusText}`);
        }

        const data = await response.json();

        if (!data || typeof data !== 'object' || !Array.isArray(data.accounts)) {
            throw new Error('Invalid response format from brokerage accounts API');
        }

        const accounts = [];

        for (const acct of data.accounts) {
            if (!acct.key || !acct.number) {
                continue; // Skip invalid accounts
            }

            accounts.push({
                profile,
                accountId: acct.key, // UUID
                accountName: acct.nickname || acct.name || `Account ${acct.number}`,
                accountMask: acct.number.slice(-4), // Last 4 digits
                accountType: /** @type {import('./bank.types').AccountType} */ ('Investment'), // All Questrade accounts are investment accounts
            });
        }

        if (accounts.length === 0) {
            throw new Error('No accounts found for this profile');
        }

        return accounts;
    } catch (error) {
        throw new Error(`Failed to retrieve Questrade accounts: ${error instanceof Error ? error.message : String(error)}`);
    }
}

/**
 * Get statements for a specific account
 * @param {import('./bank.types').Account} account - The account
 * @returns {Promise<import('./bank.types').Statement[]>}
 */
export async function getStatements(account) {
    try {
        const statements = [];

        // Try to find a token with enterprise.document-centre-statement.read scope
        // The main portal token may not have this scope
        let token = findTokenWithScopes(['enterprise.document-centre-statement.read']);
        if (!token) {
            // Fallback to the account's session token
            token = account.profile.sessionId;
        }

        // Fetch all available statements
        // Note: The API returns statements based on session context, not account parameter
        const response = await fetch(
            `${API_BASE_URL}/v2/document-centre/statement?take=100&businessLine=Brokerage`,
            {
                method: 'GET',
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'Accept': 'application/json',
                },
                credentials: 'include',
            }
        );

        if (!response.ok) {
            throw new Error(`Failed to get statements: ${response.status} ${response.statusText}`);
        }

        const data = await response.json();

        if (!data || !Array.isArray(data)) {
            throw new Error('Invalid response format from statement API - expected array');
        }

        // The API returns an array of account objects, each with a documents array
        for (const accountData of data) {
            // Check if the returned account matches the requested account
            if (accountData.accountUuid && accountData.accountUuid !== account.accountId) {
                console.warn(
                    `Statement API returned different account: expected ${account.accountId}, got ${accountData.accountUuid}. ` +
                    `Skipping this account.`
                );
                continue; // Skip this account
            }

            if (Array.isArray(accountData.documents)) {
                for (const doc of accountData.documents) {
                    if (!doc.id || !doc.date) {
                        continue; // Skip invalid documents
                    }

                    // Normalize date format from "2025-08-01 00:00:00Z" to "2025-08-01T00:00:00Z"
                    const normalizedDate = doc.date.replace(' ', 'T');

                    statements.push({
                        account,
                        statementId: doc.id,
                        statementDate: normalizedDate,
                    });
                }
            }
        }

        if (statements.length === 0) {
            console.warn(
                `No statements found for account ${account.accountId}. ` +
                `This may be due to session state not being set to this account.`
            );
        }

        return statements;
    } catch (error) {
        throw new Error(`Failed to retrieve Questrade statements: ${error instanceof Error ? error.message : String(error)}`);
    }
}

/**
 * Download a statement PDF
 * @param {import('./bank.types').Statement} statement - The statement to download
 * @returns {Promise<Blob>}
 */
export async function downloadStatement(statement) {
    try {
        // Try to find a token with enterprise.document-centre-statement.read scope
        let token = findTokenWithScopes(['enterprise.document-centre-statement.read']);
        if (!token) {
            // Fallback to the account's session token
            token = statement.account.profile.sessionId;
        }

        const response = await fetch(
            `${API_BASE_URL}/v2/document-centre/statement/${statement.statementId}/file`,
            {
                method: 'GET',
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'Accept': 'application/pdf',
                },
                credentials: 'include',
            }
        );

        if (!response.ok) {
            throw new Error(`Failed to download statement: ${response.status} ${response.statusText}`);
        }

        const blob = await response.blob();

        if (blob.size === 0) {
            throw new Error('Downloaded statement file is empty');
        }

        // Verify it's a PDF
        if (blob.type && !blob.type.includes('pdf')) {
            console.warn(`Expected PDF but got content type: ${blob.type}`);
        }

        return blob;
    } catch (error) {
        throw new Error(`Failed to download Questrade statement: ${error instanceof Error ? error.message : String(error)}`);
    }
}
