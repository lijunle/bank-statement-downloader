/**
 * Chase Bank API implementation for retrieving bank statements
 * @see analyze/chase.md
 */

/** @type {string} */
export const bankId = 'chase';

/** @type {string} */
export const bankName = 'Chase';

const BASE_URL = 'https://secure.chase.com';

/**
 * Fetches the app/data/list API which contains both profile and account information
 * This is cached to avoid duplicate API calls
 * @returns {Promise<any>}
 */
async function getAppData() {
    const response = await makeAuthenticatedRequest('/svc/rl/accounts/l4/v1/app/data/list', {
        method: 'POST',
        body: '', // Empty body with Content-Length: 0
    });

    const data = /** @type {any} */ (await response.json());

    if (!data || typeof data !== 'object') {
        throw new Error('Invalid response format from app data API');
    }

    return data;
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
        'accept': options.method === 'POST' ? 'application/json, text/plain, */*' : 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*',
        'content-type': 'application/x-www-form-urlencoded; charset=UTF-8',
        'x-jpmc-channel': 'id=C30',
        'x-jpmc-csrf-token': 'NONE',
        'x-jpmc-client-request-id': crypto.randomUUID(),
        'origin': BASE_URL,
        'referer': `${BASE_URL}/web/auth/dashboard`,
        'sec-fetch-dest': 'empty',
        'sec-fetch-mode': 'cors',
        'sec-fetch-site': 'same-origin',
        ...options.headers,
    };

    const response = await fetch(url, {
        ...options,
        headers,
        credentials: 'include', // Include cookies
    });

    if (!response.ok) {
        throw new Error(`Chase API request failed: ${response.status} ${response.statusText} at ${endpoint}`);
    }

    return response;
}

/**
 * Retrieves all accounts for the logged-in user
 * @param {import('./bank.types').Profile} profile - The user profile
 * @returns {Promise<import('./bank.types').Account[]>}
 */
export async function getAccounts(profile) {
    try {
        const data = await getAppData();

        // Extract accounts from the response
        const accounts = [];

        // The response structure may vary, so we check multiple possible locations
        if (data.accountTiles) {
            // Direct accountTiles array
            for (const tile of data.accountTiles) {
                if (tile.accountId) {
                    accounts.push({
                        profile,
                        accountId: String(tile.accountId),
                        accountName: tile.nickname || tile.displayName || tile.mask || `Account ${tile.accountId}`,
                        accountMask: tile.mask || tile.accountId.slice(-4),
                        accountType: mapAccountType(tile),
                    });
                }
            }
        } else if (data.accounts) {
            // Direct accounts array
            for (const acct of data.accounts) {
                if (acct.accountId) {
                    accounts.push({
                        profile,
                        accountId: String(acct.accountId),
                        accountName: acct.nickname || acct.displayName || acct.mask || `Account ${acct.accountId}`,
                        accountMask: acct.mask || acct.accountId.slice(-4),
                        accountType: mapAccountType(acct),
                    });
                }
            }
        } else if (data.cache) {
            // Check cache for dashboard tiles
            const dashboardData = data.cache.find(/** @param {any} item */(item) =>
                item.url && item.url.includes('dashboard')
            );

            if (dashboardData?.response?.accountTiles) {
                for (const tile of dashboardData.response.accountTiles) {
                    if (tile.accountId) {
                        accounts.push({
                            profile,
                            accountId: String(tile.accountId),
                            accountName: tile.nickname || tile.displayName || tile.mask || `Account ${tile.accountId}`,
                            accountMask: tile.mask || tile.accountId.slice(-4),
                            accountType: mapAccountType(tile),
                        });
                    }
                }
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
        // Step 1: Get document references for the account
        // The body needs to include the account ID and date filter
        const docRefParams = new URLSearchParams({
            'accountFilter': account.accountId,
            'dateFilter.idalDateFilterType': 'CURRENT_YEAR',
        });

        const docRefResponse = await makeAuthenticatedRequest('/svc/rr/documents/secure/idal/v2/docref/list', {
            method: 'POST',
            body: docRefParams.toString(),
        });

        const docRefData = /** @type {any} */ (await docRefResponse.json());

        if (!docRefData || typeof docRefData !== 'object') {
            throw new Error('Invalid response format from document reference API');
        }

        // Transform document references to statements
        const statements = [];

        // Check various possible response structures
        const docRefs = docRefData.idaldocRefs || docRefData.documentRefs || docRefData.documents || [];

        for (const docRef of docRefs) {
            // Filter by account if accountId is present in the document
            const docAccountId = docRef.accountId || docRef.accountNumber;
            if (docAccountId && String(docAccountId) !== account.accountId) {
                continue;
            }

            // Only include statements (not other document types)
            const docType = docRef.idaldocType || docRef.documentType || docRef.type;
            if (docType !== 'STMT' && docType !== 'STATEMENT') {
                continue;
            }

            // Parse date - could be in various formats
            let statementDate;
            const dateStr = docRef.documentDate || docRef.statementDate || docRef.date;

            if (dateStr) {
                if (typeof dateStr === 'string' && dateStr.length === 8) {
                    // YYYYMMDD format
                    const year = parseInt(dateStr.substring(0, 4), 10);
                    const month = parseInt(dateStr.substring(4, 6), 10) - 1; // JS months are 0-indexed
                    const day = parseInt(dateStr.substring(6, 8), 10);
                    statementDate = new Date(year, month, day).toISOString();
                } else {
                    // Try parsing as ISO date or other format
                    statementDate = new Date(dateStr).toISOString();
                }
            } else {
                statementDate = new Date().toISOString();
            }

            const statementId = docRef.documentId || docRef.docKey || docRef.id;
            if (statementId) {
                statements.push({
                    account,
                    statementId: String(statementId),
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
        // Step 1: Get CSRF token
        const csrfResponse = await makeAuthenticatedRequest('/svc/rl/accounts/secure/v1/csrf/token/list', {
            method: 'POST',
            body: '',
        });

        const csrfData = /** @type {any} */ (await csrfResponse.json());
        const csrfToken = csrfData.csrfToken;

        if (!csrfToken) {
            throw new Error('No CSRF token returned from CSRF token API');
        }

        // Step 2: Get the document key for download
        // The request body needs account ID, date filter, and document ID
        const docKeyParams = new URLSearchParams({
            'accountFilter': statement.account.accountId,
            'dateFilter.idalDateFilterType': 'CURRENT_YEAR',
            'documentId': statement.statementId,
        });

        const docKeyResponse = await makeAuthenticatedRequest('/svc/rr/documents/secure/idal/v2/dockey/list', {
            method: 'POST',
            body: docKeyParams.toString(),
        });

        const docKeyData = /** @type {any} */ (await docKeyResponse.json());

        if (!docKeyData || typeof docKeyData !== 'object') {
            throw new Error('Invalid response format from document key API');
        }

        // Extract document key
        const docKey = docKeyData.docKey || docKeyData.documentKey;
        const sor = docKeyData.docSOR || docKeyData.sor || 'STAR_MS';

        if (!docKey) {
            throw new Error(`No document key returned for statement ${statement.statementId}`);
        }

        // Step 3: Build download URL
        const downloadPath = '/svc/rr/documents/secure/idal/v5/pdfdoc/star/list';
        const params = new URLSearchParams({
            docKey,
            sor,
            adaVersion: 'false',
            download: 'true',
            csrftoken: csrfToken,
        });

        const downloadUrl = `${BASE_URL}${downloadPath}?${params.toString()}`;

        // Step 4: Download the PDF
        const downloadResponse = await fetch(downloadUrl, {
            method: 'GET',
            headers: {
                'accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
                'referer': `${BASE_URL}/web/auth/dashboard`,
                'sec-fetch-dest': 'document',
                'sec-fetch-mode': 'navigate',
                'sec-fetch-site': 'same-origin',
                'sec-fetch-user': '?1',
            },
            credentials: 'include',
        });

        if (!downloadResponse.ok) {
            throw new Error(`Failed to download PDF: ${downloadResponse.status} ${downloadResponse.statusText}`);
        }

        // Return as Blob for browser compatibility
        const blob = await downloadResponse.blob();

        if (blob.size === 0) {
            throw new Error('Downloaded PDF is empty');
        }

        return blob;
    } catch (error) {
        const err = /** @type {Error} */ (error);
        throw new Error(`Failed to download statement ${statement.statementId}: ${err.message}`);
    }
}

/**
 * Retrieves the current session ID from cookies
 * @returns {string} The v1st cookie value
 */
export function getSessionId() {
    const cookies = document.cookie.split('; ');
    for (const cookie of cookies) {
        const [name, ...valueParts] = cookie.split('=');
        if (name === 'v1st') {
            return valueParts.join('='); // Rejoin in case the value contains '='
        }
    }
    throw new Error('v1st cookie not found. User may not be logged in to Chase.');
}

/**
 * Retrieves the current profile information
 * @param {string} sessionId - The session ID
 * @returns {Promise<import('./bank.types').Profile>}
 */
export async function getProfile(sessionId) {
    try {
        const data = await getAppData();

        // Extract profile information from the response
        let profileId = sessionId;
        let profileName = sessionId;

        // Check for greeting name in the direct response
        if (data.greetingName) {
            // Convert greeting name to title case (e.g., "JUNLE" -> "Junle")
            profileName = data.greetingName.charAt(0).toUpperCase() +
                data.greetingName.slice(1).toLowerCase();
        }

        // Check for profile ID
        if (data.profileId) {
            profileId = String(data.profileId);
        } else if (data.personId) {
            profileId = String(data.personId);
        }

        // Also check cache array if present
        if (data.cache && Array.isArray(data.cache)) {
            for (const item of data.cache) {
                if (item.response) {
                    if (item.response.greetingName && !data.greetingName) {
                        profileName = item.response.greetingName.charAt(0).toUpperCase() +
                            item.response.greetingName.slice(1).toLowerCase();
                    }
                    if (item.response.profileId && !data.profileId) {
                        profileId = String(item.response.profileId);
                    } else if (item.response.personId && !data.personId) {
                        profileId = String(item.response.personId);
                    }
                }
            }
        }

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
 * Maps Chase product type/code to standard AccountType
 * @param {any} tile - Account tile from API response
 * @returns {import('./bank.types').AccountType}
 */
function mapAccountType(tile) {
    // Check productGroupCode first (Chase-specific field)
    const productGroupCode = tile.tileDetail?.productGroupCode || tile.productGroupCode;
    if (productGroupCode === 2) {
        // Product group 2 is credit cards
        return 'CreditCard';
    }
    if (productGroupCode === 3) {
        // Product group 3 is loans (mortgages, auto loans, etc.)
        return 'Loan';
    }

    // Check accountTileType and accountTileDetailType
    const tileType = tile.accountTileType || '';
    const detailType = tile.accountTileDetailType || tile.tileDetail?.detailType || '';

    if (tileType === 'CARD' || detailType === 'BAC') {
        return 'CreditCard';
    }
    if (detailType === 'HMORTGAGE' || detailType === 'ALA') {
        return 'Loan';
    }

    // Check for product code or type indicators
    const productCode = tile.tileDetail?.productCode || tile.productCode || tile.type || tile.accountType || '';
    const productName = (tile.productName || tile.nickname || '').toLowerCase();

    // Check common patterns
    if (productCode.includes('CHK') || productCode.includes('DDA') || productName.includes('checking')) {
        return 'Checking';
    }
    if (productCode.includes('SAV') || productName.includes('saving')) {
        return 'Savings';
    }
    if (productCode.includes('CC') || productCode.includes('CREDIT') || productName.includes('credit')) {
        return 'CreditCard';
    }
    if (productCode.includes('MORT') || productCode.includes('MTG') || productCode.includes('LOAN') ||
        productName.includes('mortgage') || productName.includes('loan')) {
        return 'Loan';
    }

    // Default based on context - if it has card-related fields, assume credit card
    if (tile.cardType || tile.rewardsTypeId || tile.cardArtGuid) {
        return 'CreditCard';
    }

    // Default to Checking for bank accounts if type cannot be determined
    return 'Checking';
}
