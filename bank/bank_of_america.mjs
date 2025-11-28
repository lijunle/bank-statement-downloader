/**
 * Bank of America API implementation for retrieving bank statements
 * @see analyze/bank_of_america.md
 */

/** @type {string} */
export const bankId = 'bank_of_america';

/** @type {string} */
export const bankName = 'Bank of America';

const BASE_URL = 'https://secure.bankofamerica.com';

/**
 * Gets the session ID from cookies
 * @returns {string} Session ID from CSID cookie (SMSESSION is HttpOnly and not accessible)
 */
export function getSessionId() {
    const cookies = document.cookie.split(';');
    for (const cookie of cookies) {
        const [name, value] = cookie.trim().split('=');
        if (name === 'CSID') {
            return value;
        }
    }
    throw new Error('CSID cookie not found - user may not be logged in');
}

/**
 * Makes an authenticated API request with all required headers and cookies
 * @param {string} endpoint - API endpoint path
 * @param {RequestInit & {headers?: HeadersInit}} [options] - Additional fetch options
 * @returns {Promise<Response>}
 */
async function makeAuthenticatedRequest(endpoint, options = {}) {
    const url = `${BASE_URL}${endpoint}`;

    const headers = {
        'accept': options.method === 'POST' ? '*/*' : 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*',
        'accept-language': 'en-US',
        'origin': BASE_URL,
        'sec-fetch-site': 'same-origin',
        ...(/** @type {Record<string, string>} */ (options.headers || {})),
    };

    const response = await fetch(url, {
        ...options,
        headers,
        credentials: 'include', // Include cookies
    });

    if (!response.ok) {
        throw new Error(`API request failed: ${response.status} ${response.statusText}`);
    }

    return response;
}

/**
 * Calls the gatherDocuments API to retrieve document metadata for a specific account/year.
 * @param {string} adx - Account identifier
 * @param {number|string} year - Target year
 * @returns {Promise<any>} The parsed JSON response
 */
async function callGatherDocuments(adx, year) {
    const response = await makeAuthenticatedRequest('/mycommunications/omni/statements/rest/v1/gatherDocuments', {
        method: 'POST',
        headers: {
            'content-type': 'application/json;charset=UTF-8',
            'x-requested-with': 'XMLHttpRequest',
            'sec-fetch-dest': 'empty',
            'sec-fetch-mode': 'cors',
        },
        body: JSON.stringify({
            adx,
            year: year.toString(),
            docCategoryId: 'DISPFLD001',
        }),
    });

    return response.json();
}

/**
 * Refreshes session cookies by calling gatherDocuments before PDF download.
 * @param {string} adx - Account identifier
 * @param {number} year - Target statement year
 */
async function refreshDocuments(adx, year) {
    try {
        const data = await callGatherDocuments(adx, year);
        if (data && data.status !== 'SUCCESS') {
            console.warn('gatherDocuments refresh failed:', data.errorInfo?.[0]?.message || data.status);
        }
    } catch (e) {
        console.warn('Failed to refresh documents:', e);
    }
}

/**
 * Extracts profileEligibilty from accounts overview HTML
 * @param {string} html - HTML content from accounts overview page
 * @returns {string} The 250-character profileEligibilty value
 */
function extractProfileEligibilty(html) {
    const match = html.match(/profile\.eligibility=([A-Z0-9]+)/);
    if (!match) {
        throw new Error('Could not extract profileEligibilty from accounts overview page');
    }
    return match[1];
}

/**
 * Extracts account adx values from accounts overview HTML
 * @param {string} html - HTML content from accounts overview page
 * @returns {Set<string>} Set of unique adx values
 */
function extractAccountAdx(html) {
    const adxSet = new Set();

    // Pattern 1: data-adx attributes
    const dataAdxPattern = /data-adx="([0-9a-f]{64})"/gi;
    let match;
    while ((match = dataAdxPattern.exec(html)) !== null) {
        adxSet.add(match[1]);
    }

    // Pattern 2: Links with adx query parameters
    const linkPattern = /[?&]adx=([0-9a-f]{64})/gi;
    while ((match = linkPattern.exec(html)) !== null) {
        adxSet.add(match[1]);
    }

    // Pattern 3: JavaScript data
    const jsPattern = /"adx"\s*:\s*"([0-9a-f]{64})"/gi;
    while ((match = jsPattern.exec(html)) !== null) {
        adxSet.add(match[1]);
    }

    return adxSet;
}

/**
 * Retrieves all accounts for the logged-in user
 * @param {import('./bank.types').Profile} profile - User profile
 * @returns {Promise<import('./bank.types').Account[]>}
 */
export async function getAccounts(profile) {
    try {
        // Fetch accounts overview page to get adx values
        const response = await makeAuthenticatedRequest('/myaccounts/brain/redirect.go?target=accountsoverview', {
            method: 'GET',
            headers: {
                'upgrade-insecure-requests': '1',
            },
        });

        const html = await response.text();
        const adxSet = extractAccountAdx(html);

        if (adxSet.size === 0) {
            throw new Error('No accounts found in accounts overview page');
        }

        const data = await callGatherDocuments(Array.from(adxSet)[0], new Date().getFullYear());

        if (data.status !== 'SUCCESS') {
            const errorMessage = data.errorInfo?.length > 0 ? data.errorInfo[0].message : 'Unknown error';
            throw new Error(`API returned error status: ${errorMessage}`);
        }

        // Transform accountList to Account objects
        const accounts = [];

        if (data.accountList && Array.isArray(data.accountList)) {
            for (const acct of data.accountList) {
                if (!acct.adx) {
                    continue;
                }

                // Extract last 4 digits from account display name
                const displayName = acct.accountDisplayName || '';
                const maskMatch = displayName.match(/(\d{4})$/);
                const accountMask = maskMatch ? maskMatch[1] : acct.adx.slice(-4);

                // Determine account type based on creditCardAccountIndicator and productCode
                let accountType = /** @type {import('./bank.types').AccountType} */ ('Checking');
                if (acct.creditCardAccountIndicator === true) {
                    accountType = 'CreditCard';
                } else if (acct.productCode === 'PER' && acct.groupCode === 'DDA') {
                    accountType = 'Checking';
                } else if (acct.productCode === 'PER' && acct.groupCode === 'SAV') {
                    accountType = 'Savings';
                }

                accounts.push({
                    profile,
                    accountId: acct.adx,
                    accountName: displayName,
                    accountMask,
                    accountType,
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
        const currentYear = new Date().getFullYear();
        const statements = [];
        const years = [currentYear, currentYear - 1, currentYear - 2];

        for (const year of years) {
            const data = /** @type {any} */ (await callGatherDocuments(account.accountId, year));

            if (!data || typeof data !== 'object') {
                throw new Error(`Invalid response format from gatherDocuments API for year ${year}`);
            }

            if (data.status !== 'SUCCESS') {
                const errorMessage = data.errorInfo?.length > 0 ? data.errorInfo[0].message : 'Unknown error';
                throw new Error(`API returned error status for year ${year}: ${errorMessage}`);
            }

            // Extract statements from documentList
            if (data.documentList && Array.isArray(data.documentList)) {
                for (const doc of data.documentList) {
                    // Filter by account if adx is present in the document
                    if (doc.adx && doc.adx !== account.accountId) {
                        continue;
                    }

                    // Only include statements (not other document types)
                    if (doc.docCategoryId !== 'DISPFLD001' && doc.docCategory !== 'Statements') {
                        continue;
                    }

                    if (!doc.docId) {
                        continue;
                    }

                    // Parse statement date
                    let statementDate;
                    if (doc.date) {
                        // ISO 8601 format: "2025-09-18T00:00:00.000+0000"
                        statementDate = new Date(doc.date).toISOString();
                    } else if (doc.dateString) {
                        // Try parsing formatted date: "Sep 18, 2025"
                        statementDate = new Date(doc.dateString).toISOString();
                    } else {
                        statementDate = new Date().toISOString();
                    }

                    // Encode adx and docId together in statementId: "adx|docId"
                    const statementAdx = doc.adx || account.accountId;
                    statements.push({
                        account,
                        statementId: `${statementAdx}|${doc.docId}`,
                        statementDate,
                    });
                }
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
        // Extract adx and docId from statementId (format: "adx|docId")
        const parts = statement.statementId.split('|');
        const adx = parts.length === 2 ? parts[0] : statement.account.accountId;
        const documentId = parts.length === 2 ? parts[1] : statement.statementId;

        // Pre-download refresh: attempt to rotate session cookies and entitlement via gatherDocuments.
        // Use the statement year (fallback to current year if unavailable).
        const stmtYear = new Date(statement.statementDate).getFullYear();
        try {
            await refreshDocuments(adx, stmtYear);
        } catch (e) {
            console.warn('Pre-download gatherDocuments refresh failed, proceeding anyway:', e);
        }

        const params = new URLSearchParams({
            adx,
            documentId,
            adaDocumentFlag: 'N',
            menuFlag: 'download',
            request_locale: 'en-US',
        });
        const downloadUrl = `/mycommunications/omni/statements/rest/v1/docViewDownload?${params}`;

        const response = await fetch(`${BASE_URL}${downloadUrl}`, {
            method: 'GET',
            headers: {
                'accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7',
                'accept-language': 'en-US,en;q=0.9',
                'sec-fetch-dest': 'document',
                'sec-fetch-mode': 'navigate',
                'sec-fetch-site': 'same-origin',
                'sec-fetch-user': '?1',
                'upgrade-insecure-requests': '1',
                'cache-control': 'no-cache',
            },
            credentials: 'include',
        });

        if (!response.ok) {
            throw new Error(`Failed to download PDF: ${response.status} ${response.statusText}`);
        }

        const contentType = response.headers.get('content-type') || '';
        const blob = await response.blob();

        if (blob.size === 0) {
            throw new Error('Downloaded PDF is empty');
        }

        if (blob.size < 100000 && !contentType.includes('pdf')) {
            throw new Error(`Download failed: received ${contentType || blob.type} (${blob.size} bytes) instead of PDF`);
        }

        return blob;
    } catch (error) {
        const err = /** @type {Error} */ (error);
        throw new Error(`Failed to download statement: ${err.message}`);
    }
}

/**
 * Retrieves the current user profile
 * @param {string} sessionId - Session ID
 * @returns {Promise<import('./bank.types').Profile>}
 */
export async function getProfile(sessionId) {
    try {
        const response = await makeAuthenticatedRequest('/myaccounts/brain/redirect.go?target=accountsoverview', {
            method: 'GET',
            headers: {
                'upgrade-insecure-requests': '1',
            },
        });

        const html = await response.text();
        const profileId = extractProfileEligibilty(html);

        let profileName = 'Bank of America User';
        const nameMatch = html.match(/<span[^>]*class="[^"]*name[^"]*"[^>]*>([^<]+)</i) ||
            html.match(/Hello,?\s+([^<]+)</i);
        if (nameMatch) {
            profileName = nameMatch[1].trim();
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


