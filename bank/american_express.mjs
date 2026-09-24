/**
 * American Express API implementation for retrieving bank statements
 * Supports both credit cards and checking accounts
 * @see analyze/american_express.md
 */

/** @type {string} */
export const bankId = 'american_express';

/** @type {string} */
export const bankName = 'American Express';

const BASE_URL = 'https://global.americanexpress.com';
const FUNCTIONS_URL = 'https://functions.americanexpress.com';
const GRAPHQL_URL = 'https://graph.americanexpress.com/graphql';

/**
 * Makes an authenticated API request with all required headers and cookies
 * @param {string} url - Full URL
 * @param {RequestInit} [options] - Additional fetch options
 * @returns {Promise<Response>}
 */
async function makeAuthenticatedRequest(url, options = {}) {
    const headers = {
        'accept': options.method === 'POST' ? 'application/json' : 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*',
        'accept-language': 'en-US,en;q=0.9',
        'sec-fetch-dest': options.method === 'POST' ? 'empty' : 'document',
        'sec-fetch-mode': options.method === 'POST' ? 'cors' : 'navigate',
        'sec-fetch-site': 'same-origin',
        ...options.headers,
    };

    const response = await fetch(url, {
        ...options,
        headers,
        credentials: 'include', // Include cookies
    });

    if (!response.ok) {
        throw new Error(`American Express API request failed: ${response.status} ${response.statusText}`);
    }

    return response;
}

/**
 * @param {unknown} value
 * @returns {string}
 */
function getCreditCardDownloadUrl(value) {
    if (typeof value !== 'string' || !URL.canParse(value)) {
        throw new Error('Invalid credit card statement download URL');
    }
    const url = new URL(value);
    const prefix = '/api/servicing/v1/documents/statements/';
    if (url.origin !== BASE_URL || url.username || url.password ||
        !url.pathname.startsWith(prefix) || url.pathname.length === prefix.length) {
        throw new Error('Invalid credit card statement download URL');
    }
    return value;
}

/**
 * Reject common login/error payloads; full PDF readability is verified separately.
 * @param {Blob} blob
 * @returns {Promise<Blob>}
 */
async function validatePdf(blob) {
    if (blob.size === 0) {
        throw new Error('Downloaded PDF is empty');
    }
    if (blob.type.split(';')[0].trim().toLowerCase() !== 'application/pdf' ||
        await blob.slice(0, 5).text() !== '%PDF-') {
        throw new Error('Expected a PDF statement, but received a different document');
    }
    return blob;
}

/**
 * Fetches and extracts __INITIAL_STATE__ from the overview page
 * @returns {Promise<string>} The extracted state string
 */
async function extractInitialState() {
    const response = await makeAuthenticatedRequest(`${BASE_URL}/overview`, {
        method: 'GET',
    });

    const html = await response.text();

    // Extract window.__INITIAL_STATE__
    const stateMatch = html.match(/window\.__INITIAL_STATE__\s*=\s*(.+?);\s*window\.__holocron/s);
    if (!stateMatch) {
        throw new Error('Could not find __INITIAL_STATE__ in overview page');
    }

    return stateMatch[1];
}

/**
 * Extracts account data from the overview page's __INITIAL_STATE__
 * @returns {Promise<Array<{accountToken: string, accountKey: string, lastFiveDigits: string, cardName: string, accountType: 'CARD'|'CHECKING', accountNumberProxy?: string}>>}
 */
async function extractAccountsFromOverview() {
    try {
        const stateString = await extractInitialState();

        // Extract credit card accounts (accountToken + accountKey)
        const tokenPattern = /accountToken\\",\\"([A-Z0-9]+)\\",\\"accountKey\\",\\"([A-F0-9]+)\\"/g;
        const accountsMap = new Map();
        let match;

        while ((match = tokenPattern.exec(stateString))) {
            const accountToken = match[1];
            const accountKey = match[2];

            // Use Map to deduplicate accounts by token
            if (!accountsMap.has(accountToken)) {
                accountsMap.set(accountToken, {
                    accountToken,
                    accountKey,
                    lastFiveDigits: '',
                    cardName: '',
                    accountType: 'CARD',
                });
            }
        }

        // Extract account details for credit cards (last digits and card names)
        // Find the productsList section which contains account details
        const productsListIdx = stateString.indexOf('productsList');
        const productsListSection = productsListIdx !== -1 ? stateString.substring(productsListIdx, productsListIdx + 50000) : '';

        for (const account of accountsMap.values()) {
            // Only process credit card accounts that don't have details yet
            if (account.accountType === 'CARD') {
                // Find account in productsList section
                const accountIdx = productsListSection.indexOf(`\\"${account.accountToken}\\"`);
                if (accountIdx !== -1) {
                    const accountSection = productsListSection.substring(accountIdx, accountIdx + 1000);

                    // Extract display_account_number
                    const displayMatch = accountSection.match(/display_account_number\\",\\"(\d+)\\"/);
                    if (displayMatch) {
                        account.lastFiveDigits = displayMatch[1];
                    }

                    // Extract product description (card name)
                    const productMatch = accountSection.match(/description\\",\\"([^\\"]+)\\"/);
                    if (productMatch) {
                        account.cardName = productMatch[1];
                    }
                }
            }
        }

        // Extract checking accounts (use opaqueAccountId/accountNumberProxy)
        // Pattern: opaqueAccountId (used in URLs) or accountNumberProxy (used in API calls)
        const checkingPattern = /opaqueAccountId\\",\\"([A-Za-z0-9_\-]+)\\"/g;
        while ((match = checkingPattern.exec(stateString))) {
            const accountNumberProxy = match[1];

            // Skip if this looks like a credit card token
            if (/^[A-Z0-9]+$/.test(accountNumberProxy) && accountNumberProxy.length < 20) {
                continue;
            }

            // Use the accountNumberProxy as the unique identifier for checking accounts
            if (!accountsMap.has(accountNumberProxy)) {
                // Find checking account in productsList section for details
                const accountIdx = productsListSection.indexOf(accountNumberProxy);
                if (accountIdx !== -1) {
                    const accountSection = productsListSection.substring(accountIdx, accountIdx + 800);

                    // Extract last digits from displayAccountNumber
                    let lastDigits = '';
                    const digitsMatch = accountSection.match(/displayAccountNumber\\",\\"(\d{4})\\"/);
                    if (digitsMatch) {
                        lastDigits = digitsMatch[1];
                    }

                    // Extract product name from productDisplayName
                    let productName = 'Checking Account';
                    const nameMatch = accountSection.match(/productDisplayName\\",\\"([^\\"]+)\\"/);
                    if (nameMatch) {
                        productName = nameMatch[1];
                    }

                    accountsMap.set(accountNumberProxy, {
                        accountToken: accountNumberProxy,
                        accountKey: '', // Not used for checking accounts
                        lastFiveDigits: lastDigits,
                        cardName: productName,
                        accountType: 'CHECKING',
                        accountNumberProxy: accountNumberProxy,
                    });
                }
            }
        }

        return Array.from(accountsMap.values());
    } catch (error) {
        const err = /** @type {Error} */ (error);
        throw new Error(`Failed to extract accounts from overview page: ${err.message}`);
    }
}

/**
 * Retrieves all accounts for the logged-in user
 * @param {import('./bank.types').Profile} profile - The user profile
 * @returns {Promise<import('./bank.types').Account[]>}
 */
export async function getAccounts(profile) {
    try {
        const accountsData = await extractAccountsFromOverview();

        return accountsData.map(account => ({
            profile,
            accountId: account.accountToken,
            accountName: account.cardName || `Card ending in ${account.lastFiveDigits}`,
            accountMask: account.lastFiveDigits,
            accountType: /** @type {import('./bank.types').AccountType} */ (account.accountType === 'CHECKING' ? 'Checking' : 'CreditCard'),
        }));
    } catch (error) {
        const err = /** @type {Error} */ (error);
        throw new Error(`Failed to get accounts: ${err.message}`);
    }
}

/**
 * Makes a GraphQL request to the American Express GraphQL API
 * @param {string} operationName - The GraphQL operation name
 * @param {any} variables - Variables for the GraphQL query
 * @param {string} query - The GraphQL query string
 * @returns {Promise<any>}
 */
async function makeGraphQLRequest(operationName, variables, query) {
    const response = await makeAuthenticatedRequest(GRAPHQL_URL, {
        method: 'POST',
        headers: {
            'content-type': 'application/json',
            'accept': '*/*',
            'origin': BASE_URL,
            'ce-source': 'WEB',
            'correlation-id': crypto.randomUUID(),
        },
        body: JSON.stringify({
            operationName,
            variables,
            query,
        }),
    });

    const data = await response.json();

    if (data.errors?.length) {
        throw new Error(`GraphQL error in ${operationName}`);
    }
    if (!data.data || typeof data.data !== 'object') {
        throw new Error(`Invalid GraphQL response for ${operationName}`);
    }

    return data.data;
}

/**
 * Retrieves statements for a credit card account
 * @param {import('./bank.types').Account} account
 * @returns {Promise<import('./bank.types').Statement[]>}
 */
async function getCreditCardStatements(account) {
    // Call ReadAccountActivity.web.v1 API to get billing statements
    const correlationId = `CSR-${crypto.randomUUID()}`;

    const response = await makeAuthenticatedRequest(`${FUNCTIONS_URL}/ReadAccountActivity.web.v1`, {
        method: 'POST',
        headers: {
            'content-type': 'application/json',
            'one-data-correlation-id': correlationId,
            'origin': BASE_URL,
            'ce-source': 'WEB',
        },
        body: JSON.stringify({
            accountToken: account.accountId,
            axplocale: 'en-US',
            view: 'STATEMENTS',
        }),
    });

    const data = /** @type {any} */ (await response.json());

    if (!data || !data.billingStatements) {
        throw new Error('Invalid response format from ReadAccountActivity API');
    }

    const { recentStatements, olderStatements } = data.billingStatements;
    if ((!Array.isArray(recentStatements) && !Array.isArray(olderStatements)) ||
        (recentStatements !== undefined && !Array.isArray(recentStatements)) ||
        (olderStatements !== undefined && !Array.isArray(olderStatements))) {
        throw new Error('Invalid response format from ReadAccountActivity API');
    }

    const allStatements = [
        ...(recentStatements ?? []),
        ...(olderStatements ?? []),
    ];

    const statements = allStatements.flatMap(stmt => {
        const options = stmt?.downloadOptions;
        // Additional cards can expose transaction exports without a billing PDF.
        if (options && !Object.prototype.hasOwnProperty.call(options, 'STATEMENT_PDF') &&
            ['EXCEL', 'CSV', 'QUICKBOOKS', 'QUICKEN'].some(format => typeof options[format] === 'string' && options[format].length > 0)) {
            return [];
        }
        const pdfUrl = getCreditCardDownloadUrl(stmt?.downloadOptions?.STATEMENT_PDF);
        const dateStr = stmt.statementEndDate;
        const date = new Date(dateStr);
        if (typeof dateStr !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(dateStr) ||
            !Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== dateStr) {
            throw new Error('Invalid credit card statement date');
        }

        return [{
            account,
            statementId: pdfUrl,
            statementDate: date.toISOString(),
        }];
    });

    // Sort by date descending (newest first)
    statements.sort((a, b) => new Date(b.statementDate).getTime() - new Date(a.statementDate).getTime());

    return statements;
}

/**
 * Retrieves statements for a checking account
 * @param {import('./bank.types').Account} account
 * @returns {Promise<import('./bank.types').Statement[]>}
 */
async function getCheckingStatements(account) {
    // Use GraphQL bankingAccountDocuments operation
    const query = `query bankingAccountDocuments($accountFilter: ProductAccountByAccountNumberProxyInput!, $documentFilter: CheckingAccountStatementInput) {
  productAccountByAccountNumberProxy(filter: $accountFilter) {
    ... on CheckingAccount {
      statements(filter: $documentFilter) {
        document
        identifier
        type
        year
        month
        __typename
      }
      __typename
    }
    __typename
  }
}`;

    const data = await makeGraphQLRequest('bankingAccountDocuments', {
        accountFilter: {
            productClass: 'PERSONAL_CHECKING_ACCOUNT',
            accountNumberProxy: account.accountId,
        },
        documentFilter: {
            type: 'FINANCIAL',
        },
    }, query);

    const statements = data.productAccountByAccountNumberProxy?.statements;
    if (!Array.isArray(statements)) {
        throw new Error('Invalid checking statement list response');
    }

    return statements.map(stmt => {
        if (!stmt || typeof stmt.identifier !== 'string' || !stmt.identifier.trim() ||
            !/^\d{4}$/.test(String(stmt.year)) || !/^\d{1,2}$/.test(String(stmt.month))) {
            throw new Error('Invalid checking statement identifier or period');
        }
        const year = Number(stmt.year);
        const month = Number(stmt.month);
        if (year < 1000 || month < 1 || month > 12) {
            throw new Error('Invalid checking statement period');
        }
        const statementDate = new Date(Date.UTC(year, month, 0)).toISOString();

        return {
            account,
            // Use the identifier as statementId (contains full URN)
            statementId: stmt.identifier,
            statementDate,
        };
    }).sort((/** @type {import('./bank.types').Statement} */ a, /** @type {import('./bank.types').Statement} */ b) => new Date(b.statementDate).getTime() - new Date(a.statementDate).getTime());
}

/**
 * Retrieves all statements for a specific account
 * @param {import('./bank.types').Account} account - The account to get statements for
 * @returns {Promise<import('./bank.types').Statement[]>}
 */
export async function getStatements(account) {
    try {
        if (account.accountType === 'Checking') {
            return await getCheckingStatements(account);
        } else if (account.accountType === 'CreditCard') {
            return await getCreditCardStatements(account);
        }
        throw new Error(`Unsupported American Express account type: ${account.accountType}`);
    } catch (error) {
        const err = /** @type {Error} */ (error);
        throw new Error(`Failed to get statements: ${err.message}`);
    }
}

/**
 * Downloads a credit card statement PDF
 * @param {import('./bank.types').Statement} statement
 * @returns {Promise<Blob>}
 */
async function downloadCreditCardStatement(statement) {
    const downloadUrl = getCreditCardDownloadUrl(statement.statementId);
    const response = await makeAuthenticatedRequest(downloadUrl, {
        method: 'GET',
        headers: {
            'accept': 'application/pdf',
        },
    });

    return validatePdf(await response.blob());
}

/**
 * Downloads a checking account statement PDF
 * @param {import('./bank.types').Statement} statement
 * @returns {Promise<Blob>}
 */
async function downloadCheckingStatement(statement) {
    // Use GraphQL accountDocument operation to get base64-encoded PDF
    const query = `query accountDocument($filter: CheckingAccountStatementFilterInput!) {
  checkingAccountStatement(filter: $filter) {
    name
    contentType
    content
    __typename
  }
}`;

    const data = await makeGraphQLRequest('accountDocument', {
        filter: {
            identifier: statement.statementId,
            accountNumberProxy: statement.account.accountId,
        },
    }, query);

    const statementData = data.checkingAccountStatement;
    if (!statementData || typeof statementData.content !== 'string' || !statementData.content) {
        throw new Error('No statement content returned from API');
    }
    if (typeof statementData.contentType !== 'string' ||
        statementData.contentType.split(';')[0].trim().toLowerCase() !== 'application/pdf') {
        throw new Error('Expected a PDF statement, but received a different document');
    }

    // Decode base64 content to binary
    const base64Content = statementData.content;
    const binaryString = atob(base64Content);
    const bytes = new Uint8Array(binaryString.length);
    for (let i = 0; i < binaryString.length; i++) {
        bytes[i] = binaryString.charCodeAt(i);
    }

    // Create blob with PDF MIME type
    const blob = new Blob([bytes], { type: 'application/pdf' });

    return validatePdf(blob);
}

/**
 * Downloads a statement PDF file
 * @param {import('./bank.types').Statement} statement - The statement to download
 * @returns {Promise<Blob>}
 */
export async function downloadStatement(statement) {
    try {
        if (statement.account.accountType === 'Checking') {
            return await downloadCheckingStatement(statement);
        } else if (statement.account.accountType === 'CreditCard') {
            return await downloadCreditCardStatement(statement);
        }
        throw new Error(`Unsupported American Express account type: ${statement.account.accountType}`);
    } catch (error) {
        const err = /** @type {Error} */ (error);
        throw new Error(`Failed to download statement: ${err.message}`);
    }
}

/**
 * Retrieves the current session ID from cookies
 * Uses JSESSIONID which is stable across requests
 * @returns {string} The JSESSIONID cookie value
 */
export function getSessionId() {
    const cookies = document.cookie.split('; ');
    for (const cookie of cookies) {
        const [name, ...valueParts] = cookie.split('=');
        if (name === 'JSESSIONID') {
            return valueParts.join('='); // Rejoin in case the value contains '='
        }
    }
    throw new Error('JSESSIONID cookie not found. User may not be logged in to American Express.');
}

/**
 * Retrieves the current profile information
 * @param {string} sessionId - The session ID
 * @returns {Promise<import('./bank.types').Profile>}
 */
export async function getProfile(sessionId) {
    try {
        const stateString = await extractInitialState();

        // Extract embossed_name from the profile section
        // Pattern: "embossed_name","NAME" in Transit JSON format
        const namePattern = /embossed_name\\",\\"([^"]+)\\"/;
        const nameMatch = stateString.match(namePattern);
        const profileName = nameMatch ? nameMatch[1] : 'American Express';

        return {
            sessionId,
            profileId: sessionId,
            profileName,
        };
    } catch (error) {
        const err = /** @type {Error} */ (error);
        throw new Error(`Failed to get profile: ${err.message}`);
    }
}
