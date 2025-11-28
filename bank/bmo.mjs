/** @type {string} */
export const bankId = 'bmo';

/** @type {string} */
export const bankName = 'BMO';

/**
 * Helper function to get a cookie value by name
 * @param {string} name - Cookie name
 * @returns {string | null}
 */
function getCookie(name) {
    const cookies = document.cookie.split(';');
    for (const cookie of cookies) {
        const [key, value] = cookie.trim().split('=');
        if (key === name) {
            return decodeURIComponent(value);
        }
    }
    return null;
}

/**
 * Helper function to generate a random request ID
 * @returns {string}
 */
function generateRequestId() {
    const randomHex = Math.random().toString(16).substring(2, 18);
    return `REQ_${randomHex}`;
}

/**
 * Helper function to get the current timestamp in ISO format
 * @returns {string}
 */
function getTimestamp() {
    return new Date().toISOString().substring(0, 23);
}

/**
 * Helper function to create the standard HdrRq object for BMO API requests
 * @returns {Object}
 */
function createHeaderRequest() {
    const mfaDeviceToken = getCookie('PMData');
    const userAgent = navigator.userAgent;

    return {
        ver: '1.0',
        channelType: 'OLB',
        appName: 'OLB',
        hostName: 'BDBN-HostName',
        clientDate: getTimestamp(),
        rqUID: generateRequestId(),
        clientSessionID: 'session-id',
        userAgent: userAgent,
        clientIP: '127.0.0.1',
        mfaDeviceToken: mfaDeviceToken || '',
    };
}

/**
 * Helper function to make API requests with proper headers
 * @param {string} url - API endpoint URL
 * @param {Object} body - Request body
 * @returns {Promise<any>}
 */
async function apiRequest(url, body) {
    const xsrfToken = getCookie('XSRF-TOKEN');

    const response = await fetch(url, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Accept': 'application/json, text/plain, */*',
            'X-XSRF-TOKEN': xsrfToken || '',
            'X-ChannelType': 'OLB',
            'X-Request-ID': generateRequestId(),
            'X-UI-Session-ID': '0.0.1',
            'X-App-Version': 'session-id',
            'X-App-Current-Path': '/banking/digital/accounts',
            'X-Original-Request-Time': new Date().toUTCString(),
        },
        body: JSON.stringify(body),
    });

    if (!response.ok) {
        throw new Error(`API request failed: ${response.status} ${response.statusText}`);
    }

    return response.json();
}

/**
 * Retrieves the current session ID from cookies
 * @returns {string} The XSRF-TOKEN cookie value
 */
export function getSessionId() {
    // BMO uses XSRF-TOKEN as the primary session identifier
    const xsrfToken = getCookie('XSRF-TOKEN');
    if (!xsrfToken) {
        throw new Error('XSRF-TOKEN cookie not found - user may not be logged in');
    }
    return xsrfToken;
}

/**
 * Helper function to call getMySummary API
 * @returns {Promise<any>}
 */
async function getMySummary() {
    const requestBody = {
        MySummaryRq: {
            HdrRq: createHeaderRequest(),
            BodyRq: {
                refreshProfile: 'N',
            },
        },
    };

    const response = await apiRequest(
        'https://www1.bmo.com/banking/services/mysummary/getMySummary',
        requestBody
    );

    if (response.GetMySummaryRs?.HdrRs?.callStatus !== 'Success') {
        throw new Error('Failed to get summary: ' + (response.GetMySummaryRs?.HdrRs?.callStatus || 'Unknown error'));
    }

    return response.GetMySummaryRs.BodyRs;
}

/**
 * Retrieves the current profile information
 * @param {string} sessionId - The session ID
 * @returns {Promise<import('./bank.types.ts').Profile>}
 */
export async function getProfile(sessionId) {
    const bodyRs = await getMySummary();

    const credential = bodyRs.credential || '';
    const firstName = bodyRs.firstName || '';
    const lastName = bodyRs.lastName || '';
    const customerName = bodyRs.customerName || `${firstName} ${lastName}`.trim();

    return {
        sessionId,
        profileId: credential,
        profileName: customerName,
    };
}

/**
 * @param {import('./bank.types.ts').Profile} profile - The user profile
 * @returns {Promise<import('./bank.types.ts').Account[]>}
 */
export async function getAccounts(profile) {
    const bodyRs = await getMySummary();

    const accounts = [];
    const categories = bodyRs.categories || [];

    for (const category of categories) {
        const products = category.products || [];
        for (const product of products) {
            // Only include accounts that support eStatements
            if (product.menuOptions?.includes('VIEW_ESTATEMENTS')) {
                const accountNumber = product.accountNumber || '';
                // Extract last 4 digits from account number (format: "0784 3894-673")
                // Remove all non-digit characters and get last 4 digits
                const accountMask = accountNumber.replace(/\D/g, '').slice(-4);

                accounts.push({
                    profile,
                    accountId: `${category.categoryName}:${product.accountIndex}`,
                    accountName: product.productName || product.ocifAccountName || 'Unknown Account',
                    accountMask: accountMask,
                    accountType: mapAccountType(product.productName || '', category.categoryName || ''),
                });
            }
        }
    }

    return accounts;
}

/**
 * @param {import('./bank.types.ts').Account} account
 * @returns {Promise<import('./bank.types.ts').Statement[]>}
 */
export async function getStatements(account) {
    // Parse accountId to get category and index
    const [categoryName, accountIndexStr] = account.accountId.split(':');
    const accountIndex = parseInt(accountIndexStr, 10);

    // Step 1: Get encrypted data token
    const encryptedDataRequest = {
        EStatementsEncryptedDataRq: {
            HdrRq: createHeaderRequest(),
            BodyRq: {
                acctType: categoryName,
                inquiryAccountIndex: accountIndex,
            },
        },
    };

    const encryptedDataResponse = await apiRequest(
        'https://www1.bmo.com/banking/services/estatements/getEStatementsEncryptedData',
        encryptedDataRequest
    );

    if (encryptedDataResponse.GetEStatementsEncryptedDataRs?.HdrRs?.callStatus !== 'Success') {
        throw new Error('Failed to get encrypted statement data: ' +
            (encryptedDataResponse.GetEStatementsEncryptedDataRs?.HdrRs?.callStatus || 'Unknown error'));
    }

    // Note the typo in the API response: "ecryptedData" instead of "encryptedData"
    const encryptedData = encryptedDataResponse.GetEStatementsEncryptedDataRs.BodyRs.ecryptedData;
    if (!encryptedData) {
        throw new Error('No encrypted data returned from API');
    }

    // Step 2: Get statement list by decrypting the token
    const statementListUrl = `https://www1.bmo.com/WebContentManager/getEDocumentsJSONList?encrypted_data=${encryptedData}`;
    const statementListResponse = await fetch(statementListUrl, {
        method: 'GET',
        headers: {
            'Accept': 'application/json, text/plain, */*',
        },
    });

    if (!statementListResponse.ok) {
        throw new Error(`Failed to get statement list: ${statementListResponse.status} ${statementListResponse.statusText}`);
    }

    const statementData = await statementListResponse.json();
    const eDocuments = statementData.eDocuments || [];

    return eDocuments.map((/** @type {any} */ doc) => ({
        account,
        statementId: JSON.stringify({ dummyParams: doc.dummyParams, token: doc.token }),
        statementDate: new Date(doc.date).toISOString(),
    }));
}

/**
 * @param {import('./bank.types.ts').Statement} statement
 * @returns {Promise<Blob>}
 */
export async function downloadStatement(statement) {
    // Parse the statementId to get dummyParams and token
    const { dummyParams, token } = JSON.parse(statement.statementId);

    const downloadUrl = `https://www1.bmo.com/WebContentManager/DownloadEStatementInPDFBOSServlet?dummyParams=${encodeURIComponent(dummyParams)}&token=${encodeURIComponent(token)}&econfirmation=false`;

    const response = await fetch(downloadUrl, {
        method: 'GET',
        headers: {
            'Accept': 'application/pdf',
        },
    });

    if (!response.ok) {
        throw new Error(`Failed to download statement: ${response.status} ${response.statusText}`);
    }

    return response.blob();
}

/**
 * Maps BMO product name and category to standard AccountType
 * @param {string} productName - Product name from API (e.g., "Chequing", "Savings", "Credit Card")
 * @param {string} categoryName - Category code from API (e.g., "BA", "CC", "LM", "IN")
 * @returns {import('./bank.types').AccountType}
 */
function mapAccountType(productName, categoryName) {
    const lowerName = productName.toLowerCase();

    // Map based on category first
    if (categoryName === 'CC') {
        return 'CreditCard';
    }

    if (categoryName === 'LM') {
        // Loans & Mortgages - both map to Loan type
        return 'Loan';
    }

    if (categoryName === 'IN') {
        return 'Investment';
    }

    // Bank Accounts (BA) - determine from product name
    if (lowerName.includes('cheq') || lowerName.includes('check')) {
        return 'Checking';
    }
    if (lowerName.includes('sav')) {
        return 'Savings';
    }

    // Default to Checking for bank accounts
    return 'Checking';
}
