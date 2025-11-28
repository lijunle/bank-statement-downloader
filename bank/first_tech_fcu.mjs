/**
 * First Tech Federal Credit Union API implementation for retrieving bank statements
 * @see analyze/first_tech_fcu.md
 */

/** @type {string} */
export const bankId = 'first_tech_fcu';

/** @type {string} */
export const bankName = 'First Tech Federal Credit Union';

const BASE_URL = 'https://banking.firsttechfed.com';

/**
 * Gets the current session ID from cookies
 * @returns {string}
 */
export function getSessionId() {
    // First Tech FCU uses httpOnly cookies for authentication (not accessible to JS)
    // Use cdContextId as a session identifier since it's available and session-specific
    const cookies = document.cookie.split(';');
    for (const cookie of cookies) {
        const [name, value] = cookie.trim().split('=');
        if (name === 'cdContextId') {
            return value;
        }
    }
    return '';
}

/**
 * Retrieves user profile information by parsing the dashboard HTML and fetching documents
 * @param {string} sessionId - Session ID (not used, kept for interface compatibility)
 * @returns {Promise<import('./bank.types').Profile>}
 */
export async function getProfile(sessionId) {
    try {
        const response = await fetch(`${BASE_URL}/DashboardV2`, {
            method: 'GET',
            credentials: 'include',
            headers: {
                'accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
            },
        });

        if (!response.ok) {
            throw new Error(`Failed to fetch dashboard: ${response.status} ${response.statusText}`);
        }

        const html = await response.text();

        // Extract user name from profile menu
        const nameMatch = html.match(/<span class="profile-menu__text[^"]*">([^<]+)<\/span>/);
        const profileName = nameMatch ? nameMatch[1].trim() : '';

        if (!profileName) {
            throw new Error('Failed to extract profile name from dashboard HTML');
        }

        // Fetch documents data
        const documentsResponse = await fetch(`${BASE_URL}/eDocs/GeteDocs?accountIdentifier=undefined`, {
            method: 'GET',
            credentials: 'include',
            headers: {
                'accept': '*/*',
                'x-requested-with': 'XMLHttpRequest',
                'referer': `${BASE_URL}/eDocs`,
            },
        });

        if (!documentsResponse.ok) {
            throw new Error(`Failed to fetch documents: ${documentsResponse.status} ${documentsResponse.statusText}`);
        }

        const documentsData = await documentsResponse.json();

        if (!documentsData || !Array.isArray(documentsData.Accounts)) {
            throw new Error('Invalid response format: missing Accounts array');
        }

        // Store the entire documents response as profileId (serialized JSON)
        const profileId = JSON.stringify(documentsData);

        return {
            sessionId,
            profileId,
            profileName,
        };
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        throw new Error(`Failed to get profile: ${message}`);
    }
}

/**
 * Retrieves all accounts for the user
 * @param {import('./bank.types').Profile} profile - User profile
 * @returns {Promise<import('./bank.types').Account[]>}
 */
export async function getAccounts(profile) {
    try {
        // Deserialize documents data from profileId
        const data = JSON.parse(profile.profileId);

        if (!data || !Array.isArray(data.Accounts)) {
            throw new Error('Invalid profile data: missing Accounts array');
        }

        return data.Accounts.map((/** @type {any} */ account) => {
            // Map account type based on account name patterns
            let accountType = /** @type {import('./bank.types').AccountType} */ ('Checking');
            const displayName = account.DisplayName || '';
            const lowerName = displayName.toLowerCase();

            if (lowerName.includes('savings')) {
                accountType = 'Savings';
            } else if (lowerName.includes('credit') || lowerName.includes('card') || lowerName.includes('mastercard') || lowerName.includes('visa')) {
                accountType = 'CreditCard';
            } else if (lowerName.includes('loan') || lowerName.includes('mortgage')) {
                accountType = 'Loan';
            } else if (lowerName.includes('investment') || lowerName.includes('ira') || lowerName.includes('401k')) {
                accountType = 'Investment';
            }

            return {
                profile,
                accountId: account.AccountNumber || String(account.ID),
                accountName: displayName,
                accountMask: account.DisplayAccountNumber || '',
                accountType,
            };
        });
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        throw new Error(`Failed to get accounts: ${message}`);
    }
}

/**
 * Retrieves all statements for a specific account
 * @param {import('./bank.types').Account} account - Account to get statements for
 * @returns {Promise<import('./bank.types').Statement[]>}
 */
export async function getStatements(account) {
    try {
        // Deserialize documents data from profileId
        const data = JSON.parse(account.profile.profileId);

        if (!data || !Array.isArray(data.DocumentListings)) {
            throw new Error('Invalid profile data: missing DocumentListings array');
        }

        // Get the full account number from accountId
        const fullAccountNumber = account.accountId;

        // Extract last 4 digits from account mask (e.g., "*1644" -> "1644")
        const last4Digits = account.accountMask.replace(/\*/g, '');

        // Filter statements for this specific account
        // Include documents that are actual statements (Credit Cards, Monthly/Quarterly)
        const accountStatements = data.DocumentListings.filter((/** @type {any} */ doc) => {
            const docAccount = doc.Account || '';
            const docDisplayNumber = doc.DisplayAccountNumber || '';

            // Include only actual statement types (not notices, tax forms, etc.)
            const isStatement = (
                doc.Type === 'Credit Cards' ||
                doc.Type === 'Monthly/Quarterly' ||
                (doc.Name && doc.Name.includes('Statement'))
            );

            if (!isStatement) {
                return false;
            }

            // Match by:
            // 1. DisplayAccountNumber (most reliable: "*2301", "*1644")
            // 2. Full account number (for unmasked statements)
            // 3. Last 4 digits match in masked Account field (for credit cards: "************1644")
            const accountMatches =
                docDisplayNumber === account.accountMask ||
                docAccount === fullAccountNumber ||
                (last4Digits && docAccount.endsWith(last4Digits));

            return accountMatches;
        });

        return accountStatements.map((/** @type {any} */ statement) => {
            // Parse date from YYYY/MM/DD format to ISO 8601
            const dateParts = statement.DocumentDate.split('/');
            const isoDate = `${dateParts[0]}-${dateParts[1]}-${dateParts[2]}`;

            // Create unique statement ID from provider ID, key, and date
            const statementId = `${statement.ProviderId}_${statement.Key}_${statement.DocumentDate.replace(/\//g, '')}`;

            return {
                account,
                statementId,
                statementDate: isoDate,
            };
        });
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        throw new Error(`Failed to get statements: ${message}`);
    }
}

/**
 * Downloads a statement as a PDF blob
 * @param {import('./bank.types').Statement} statement - Statement to download
 * @returns {Promise<Blob>}
 */
export async function downloadStatement(statement) {
    try {
        // Parse statement ID: format is "providerId_documentKey_date"
        const parts = statement.statementId.split('_');
        if (parts.length < 2) {
            throw new Error('Invalid statement ID format');
        }

        const providerId = parts[0];
        const documentKey = parts[1];

        const url = `${BASE_URL}/eDocs/GetDocument?providerId=${providerId}&documentKey=${encodeURIComponent(documentKey)}`;

        const response = await fetch(url, {
            method: 'GET',
            credentials: 'include',
            headers: {
                'accept': 'application/pdf,*/*',
                'referer': `${BASE_URL}/eDocs`,
            },
        });

        if (!response.ok) {
            throw new Error(`Failed to download statement: ${response.status} ${response.statusText}`);
        }

        const contentType = response.headers.get('content-type');
        if (!contentType || !contentType.includes('application/pdf')) {
            throw new Error(`Unexpected content type: ${contentType}. Expected application/pdf`);
        }

        const blob = await response.blob();

        if (blob.size === 0) {
            throw new Error('Downloaded PDF is empty');
        }

        return blob;
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        throw new Error(`Failed to download statement: ${message}`);
    }
}
