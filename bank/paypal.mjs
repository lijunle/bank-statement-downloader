/**
 * PayPal Bank API implementation for retrieving bank statements
 * @see analyze/paypal.md
 */

/** @type {string} */
export const bankId = 'paypal';

/** @type {string} */
export const bankName = 'PayPal';

const BASE_URL = 'https://www.paypal.com';

/**
 * Get the current session ID from cookies or storage
 * Note: PayPal's nsid cookie is HttpOnly and not accessible via JavaScript.
 * We try to get session identifiers from accessible storage.
 * @returns {string}
 */
export function getSessionId() {
    // Try localStorage 'vf' which contains a session token
    if (typeof localStorage !== 'undefined') {
        const vf = localStorage.getItem('vf');
        if (vf) {
            return vf;
        }
    }

    // Try sessionStorage 'PP_NC' as fallback
    if (typeof sessionStorage !== 'undefined') {
        const ppNc = sessionStorage.getItem('PP_NC');
        if (ppNc) {
            return ppNc;
        }
    }

    // Try to extract TLTSID from document.cookie as last resort
    if (typeof document !== 'undefined' && document.cookie) {
        const cookies = document.cookie.split(';');
        for (const cookie of cookies) {
            const [name, value] = cookie.trim().split('=');
            if (name === 'TLTSID' && value) {
                return value;
            }
        }
    }

    throw new Error('PayPal session not found. Please ensure you are logged in to PayPal.');
}

/**
 * Get the current user profile information
 * @param {string} sessionId - The session ID
 * @returns {Promise<import('./bank.types').Profile>}
 */
export async function getProfile(sessionId) {
    const response = await fetch(`${BASE_URL}/smartchat/chat-meta?pageURI=/myaccount/summary&isNativeEnabled=undefined`, {
        credentials: 'include',
        headers: {
            'accept': 'application/json',
        },
    });

    if (!response.ok) {
        throw new Error(`Failed to retrieve PayPal user profile: ${response.status} ${response.statusText}`);
    }

    const data = await response.json();

    if (!data.userInfo || !data.userInfo.firstName) {
        throw new Error('PayPal user profile data is missing or invalid');
    }

    return {
        sessionId,
        profileId: sessionId, // Use session ID as profile ID
        profileName: data.userInfo.firstName,
    };
}

/**
 * Get all accounts (PayPal balance and credit cards)
 * @param {import('./bank.types').Profile} profile - The user profile
 * @returns {Promise<import('./bank.types').Account[]>}
 */
export async function getAccounts(profile) {
    const accounts = [];

    // Fetch the summary page to parse account information
    const response = await fetch(`${BASE_URL}/myaccount/summary`, {
        credentials: 'include',
        headers: {
            'accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        },
    });

    if (!response.ok) {
        throw new Error(`Failed to retrieve PayPal accounts: ${response.status} ${response.statusText}`);
    }

    const html = await response.text();

    // Parse PayPal balance account (always present for logged-in users)
    // Look for balance information in the HTML
    const balanceMatch = html.match(/balance[^>]*>([^<]*USD[^<]*)</i);
    if (balanceMatch) {
        accounts.push({
            profile,
            accountId: 'paypal_balance_usd',
            accountName: 'PayPal Balance (USD)',
            accountMask: 'USD',
            accountType: /** @type {import('./bank.types').AccountType} */ ('Checking'), // PayPal balance acts like a checking account
        });
    } else {
        // Always add the balance account even if we can't find balance in HTML
        accounts.push({
            profile,
            accountId: 'paypal_balance_usd',
            accountName: 'PayPal Balance (USD)',
            accountMask: 'USD',
            accountType: /** @type {import('./bank.types').AccountType} */ ('Checking'),
        });
    }

    // Look for credit card account
    // Check if there's a link to credit/rewards-card in the HTML
    if (html.includes('/myaccount/credit/rewards-card/')) {
        // Extract credit account ID from HTML if possible
        // Try two patterns:
        // 1. creditAccountId":"11ED-DC42-A4C3066A-9B41-EEBDF64D0D2D (UUID format from summary page)
        // 2. encryptedAccountNumber":"SC92AFJEJEJY4" (short format from credit card page)
        let creditIdMatch = html.match(/creditAccountId["\s:]+([0-9A-F-]{36})/i);
        if (!creditIdMatch) {
            creditIdMatch = html.match(/encryptedAccountNumber["\s:]+([A-Z0-9]+)/i);
        }

        if (creditIdMatch) {
            const creditAccountId = creditIdMatch[1];

            // Extract credit card mask from HTML
            // Pattern: ••0981 (the bullet character is the actual bullet, not two dots)
            const maskMatch = html.match(/••(\d{4})/);
            const cardMask = maskMatch ? maskMatch[1] : 'XXXX';

            // Extract card name from embedded JSON in HTML
            // Pattern: "header":"PayPal Cashback World Mastercard ••0981"
            let cardName = 'PayPal Credit Card';
            const jsonMatch = html.match(/"header"\s*:\s*"([^"]*PayPal[^"]*(?:Cashback|Credit)[^"]*)"/i);
            if (jsonMatch) {
                // Remove the mask from the name (e.g., "PayPal Cashback World Mastercard ••0981" -> "PayPal Cashback World Mastercard")
                cardName = jsonMatch[1].replace(/\s*••\d{4}$/, '').trim();
            }

            accounts.push({
                profile,
                accountId: creditAccountId,
                accountName: cardName,
                accountMask: cardMask,
                accountType: /** @type {import('./bank.types').AccountType} */ ('CreditCard'),
            });
        } else {
            // Credit card exists but couldn't extract ID, add placeholder
            accounts.push({
                profile,
                accountId: 'paypal_credit_card',
                accountName: 'PayPal Credit Card',
                accountMask: 'XXXX',
                accountType: /** @type {import('./bank.types').AccountType} */ ('CreditCard'),
            });
        }
    }

    if (accounts.length === 0) {
        throw new Error('No PayPal accounts found. Please ensure you are logged in and have an active account.');
    }

    return accounts;
}

/**
 * Get credit card details via GraphQL
 * @param {string} creditAccountId - The credit account ID
 * @returns {Promise<{name: string, mask: string}>}
 */
async function getCreditCardDetails(creditAccountId) {
    const query = `query Web_CONSUMER_REWARDS_US_Hub_ServicingOverview($creditAccountId: CreditAccountId!, $creditProductIdentifier: CreditProductIdentifier!) {
  revolvingCreditServicingOverview(
    creditProductIdentifier: $creditProductIdentifier
    creditAccountId: $creditAccountId
  ) {
    accountSummary {
      last4Digits
      cardProductName
    }
  }
}`;

    const response = await fetch(`${BASE_URL}/myaccount/credit/rewards-card/graphql/Web_CONSUMER_REWARDS_US_Hub_ServicingOverview`, {
        method: 'POST',
        credentials: 'include',
        headers: {
            'content-type': 'application/json',
            'accept': 'application/json',
        },
        body: JSON.stringify({
            operationName: 'Web_CONSUMER_REWARDS_US_Hub_ServicingOverview',
            variables: {
                creditAccountId,
                creditProductIdentifier: 'CREDIT_CARD_PAYPAL_CONSUMER_REWARDS_US',
            },
            query,
        }),
    });

    if (!response.ok) {
        throw new Error(`Failed to get credit card details: ${response.status}`);
    }

    const data = await response.json();
    const accountSummary = data?.data?.revolvingCreditServicingOverview?.accountSummary;

    return {
        name: accountSummary?.cardProductName || 'PayPal Cashback Mastercard',
        mask: accountSummary?.last4Digits || 'XXXX',
    };
}

/**
 * Get statements for an account
 * @param {import('./bank.types').Account} account - The account
 * @returns {Promise<import('./bank.types').Statement[]>}
 */
export async function getStatements(account) {
    const statements = [];

    if (account.accountType === 'CreditCard') {
        // Get credit card statements via GraphQL
        const creditStatements = await getCreditCardStatements(account.accountId);
        for (const stmt of creditStatements) {
            statements.push({
                account,
                statementId: stmt.statementId,
                statementDate: stmt.statementDate,
            });
        }
    } else {
        // Get PayPal balance transaction statements
        const balanceStatements = await getBalanceStatements();
        for (const stmt of balanceStatements) {
            statements.push({
                account,
                statementId: stmt.statementId,
                statementDate: stmt.statementDate,
            });
        }
    }

    return statements;
}

/**
 * Get PayPal balance transaction statements
 * @returns {Promise<Array<{statementId: string, statementDate: string}>>}
 */
async function getBalanceStatements() {
    const response = await fetch(`${BASE_URL}/myaccount/statements/api/statements`, {
        credentials: 'include',
        headers: {
            'accept': 'application/json',
        },
    });

    if (!response.ok) {
        throw new Error(`Failed to retrieve PayPal balance statements: ${response.status} ${response.statusText}`);
    }

    const data = await response.json();
    const statements = [];

    if (data.data && Array.isArray(data.data.statements)) {
        for (const yearGroup of data.data.statements) {
            if (Array.isArray(yearGroup.details)) {
                for (const detail of yearGroup.details) {
                    statements.push({
                        statementId: detail.date, // YYYYMMDD format
                        statementDate: formatStatementDate(detail.date),
                    });
                }
            }
        }
    }

    return statements;
}

/**
 * Get credit card statements via GraphQL
 * @param {string} creditAccountId - The credit account ID
 * @returns {Promise<Array<{statementId: string, statementDate: string}>>}
 */
async function getCreditCardStatements(creditAccountId) {
    // Extract CSRF token from credit card page
    const csrfToken = await getCsrfToken();

    const query = `query Web_CONSUMER_REWARDS_US_Hub_StatementHeaders($creditAccountId: CreditAccountId!, $creditProductIdentifier: CreditProductIdentifier!) {
  revolvingCreditStatementHeaders(
    creditProductIdentifier: $creditProductIdentifier
    creditAccountId: $creditAccountId
  ) {
    statementHeaders {
      statementId
      formattedClosingDate {
        formattedDateString
        formattedDateStringLong
      }
    }
  }
}`;

    const response = await fetch(`${BASE_URL}/myaccount/credit/rewards-card/graphql/Web_CONSUMER_REWARDS_US_Hub_StatementHeaders`, {
        method: 'POST',
        credentials: 'include',
        headers: {
            'content-type': 'application/json',
            'accept': 'application/json',
            'x-csrf-token': csrfToken,
        },
        body: JSON.stringify({
            operationName: 'Web_CONSUMER_REWARDS_US_Hub_StatementHeaders',
            variables: {
                creditAccountId,
                creditProductIdentifier: 'CREDIT_CARD_PAYPAL_CONSUMER_REWARDS_US',
            },
            query,
        }),
    });

    if (!response.ok) {
        throw new Error(`Failed to retrieve credit card statements: ${response.status} ${response.statusText}`);
    }

    const data = await response.json();
    const statements = [];

    const headers = data?.data?.revolvingCreditStatementHeaders?.statementHeaders;
    if (Array.isArray(headers)) {
        for (const header of headers) {
            statements.push({
                statementId: header.statementId, // YYYY-MM-DD format
                statementDate: header.statementId, // Already in ISO format
            });
        }
    }

    return statements;
}

/**
 * Format statement date from YYYYMMDD to ISO 8601 format
 * @param {string} dateStr - Date in YYYYMMDD format
 * @returns {string} ISO 8601 date string
 */
function formatStatementDate(dateStr) {
    // dateStr format: YYYYMMDD
    const year = dateStr.substring(0, 4);
    const month = dateStr.substring(4, 6);
    const day = dateStr.substring(6, 8);
    return `${year}-${month}-${day}`;
}

/**
 * Extract CSRF token from credit card page HTML
 * @returns {Promise<string>} CSRF token
 */
async function getCsrfToken() {
    const response = await fetch(
        `${BASE_URL}/myaccount/credit/rewards-card/?source=FINANCIAL_SNAPSHOT`,
        {
            credentials: 'include',
        }
    );

    if (!response.ok) {
        throw new Error(`Failed to load credit card page: ${response.status} ${response.statusText}`);
    }

    const html = await response.text();
    const csrfMatch = html.match(/"_csrf":"([^"]+)"/);

    if (!csrfMatch) {
        throw new Error('CSRF token not found in page');
    }

    // Decode unicode escapes (e.g., \u002F -> /)
    const decodedToken = csrfMatch[1].replace(/\\u([0-9a-fA-F]{4})/g, (match, hex) => {
        return String.fromCharCode(parseInt(hex, 16));
    });

    return decodedToken;
}

/**
 * Download a statement PDF
 * @param {import('./bank.types').Statement} statement - The statement to download
 * @returns {Promise<Blob>}
 */
export async function downloadStatement(statement) {
    if (statement.account.accountType === 'CreditCard') {
        // Download credit card statement
        return await downloadCreditCardStatement(statement.account.accountId, statement.statementId);
    } else {
        // Download PayPal balance transaction statement
        return await downloadBalanceStatement(statement.statementId);
    }
}

/**
 * Download PayPal balance transaction statement
 * @param {string} statementId - Statement ID in YYYYMMDD format
 * @returns {Promise<Blob>}
 */
async function downloadBalanceStatement(statementId) {
    // Convert ISO date format back to YYYYMMDD if needed
    const monthList = statementId.replace(/-/g, '');

    const url = `${BASE_URL}/myaccount/statements/download?monthList=${monthList}&reportType=standard`;

    const response = await fetch(url, {
        credentials: 'include',
        headers: {
            'accept': 'application/octet-stream, application/pdf',
        },
    });

    if (!response.ok) {
        throw new Error(`Failed to download PayPal balance statement: ${response.status} ${response.statusText}`);
    }

    const blob = await response.blob();

    // Validate PDF
    if (blob.size < 10240) { // Less than 10KB is suspicious
        throw new Error(`Downloaded statement file is too small (${blob.size} bytes). It may not be a valid PDF.`);
    }

    return blob;
}

/**
 * Download credit card statement
 * @param {string} creditAccountId - The credit account ID
 * @param {string} statementId - Statement ID in YYYY-MM-DD format
 * @returns {Promise<Blob>}
 */
async function downloadCreditCardStatement(creditAccountId, statementId) {
    // Extract CSRF token from credit card page
    const csrfToken = await getCsrfToken();

    const response = await fetch(`${BASE_URL}/myaccount/credit/rewards-card/statement/download`, {
        method: 'POST',
        credentials: 'include',
        headers: {
            'content-type': 'application/json',
            'accept': 'application/octet-stream, application/pdf',
            'x-csrf-token': csrfToken,
        },
        body: JSON.stringify({
            variables: {
                statementId,
                creditAccountId,
            },
        }),
    });

    if (!response.ok) {
        throw new Error(`Failed to download credit card statement: ${response.status} ${response.statusText}`);
    }

    const blob = await response.blob();

    // Validate PDF
    if (blob.size < 10240) { // Less than 10KB is suspicious
        throw new Error(`Downloaded statement file is too small (${blob.size} bytes). It may not be a valid PDF.`);
    }

    return blob;
}
