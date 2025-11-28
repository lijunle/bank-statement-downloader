/**
 * TD Bank Canada API implementation for retrieving bank statements
 * @see analyze/td_bank.md
 * 
 * TD Bank uses two separate session systems:
 * 1. /ms/ endpoints: Use JSESSIONID (HttpOnly) - set during login
 * 2. /waw/api/ endpoints: Use JESSIONID (HttpOnly) - set via SSO flow
 * 
 * E-Statement SSO Flow:
 * 1. GET /waw/ezw/servlet/com.td.estatement.servlet.EStatementAccountRepositoryServlet
 *    - Sets ssoTicketId and oauthToken cookies (HttpOnly, Path=/waw/api/ssologin)
 * 2. POST /waw/api/ssologin (receives above cookies automatically)
 *    - Sets JESSIONID cookie (HttpOnly, Path=/waw/api)
 * 3. /waw/api/* endpoints now work with the JESSIONID cookie
 */

/** @type {string} */
export const bankId = 'td_bank';

/** @type {string} */
export const bankName = 'TD Bank (EasyWeb)';

const BASE_URL = 'https://easyweb.td.com';

/**
 * Get the current session ID from cookies
 * @returns {string}
 */
export function getSessionId() {
    const cookies = document.cookie.split(';');
    /** @type {string | undefined} */
    let jessionId;
    /** @type {string | undefined} */
    let hd4bjx6n;

    for (const cookie of cookies) {
        const [name, value] = cookie.trim().split('=');
        if (name === 'JESSIONID') {
            jessionId = value;
        }
        if (name === 'HD4bjx6N') {
            hd4bjx6n = value;
        }
    }

    if (!jessionId) {
        throw new Error('JESSIONID cookie not found. Please ensure you are logged in to TD EasyWeb.');
    }

    return hd4bjx6n || jessionId;
}

/**
 * Generates a unique identifier for tracing requests
 * @returns {string}
 */
function generateUUID() {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
        const r = Math.random() * 16 | 0;
        const v = c === 'x' ? r : (r & 0x3 | 0x8);
        return v.toString(16);
    });
}

/**
 * Initialize the WAW session for e-statements access
 * @returns {Promise<void>}
 */
async function initializeWawSession() {
    const servletResponse = await fetch(`${BASE_URL}/waw/ezw/servlet/com.td.estatement.servlet.EStatementAccountRepositoryServlet`, {
        method: 'GET',
        credentials: 'include',
        headers: {
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
            'sec-fetch-dest': 'frame',
            'sec-fetch-mode': 'navigate',
            'sec-fetch-site': 'same-origin',
            'Upgrade-Insecure-Requests': '1',
        },
    });

    if (!servletResponse.ok) {
        throw new Error(`EStatementAccountRepositoryServlet failed: ${servletResponse.status}`);
    }

    const ssoResponse = await fetch(`${BASE_URL}/waw/api/ssologin`, {
        method: 'POST',
        credentials: 'include',
        headers: {
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
            'Content-Type': 'application/x-www-form-urlencoded',
            'Referer': `${BASE_URL}/waw/ezw/servlet/com.td.estatement.servlet.EStatementAccountRepositoryServlet`,
            'sec-fetch-dest': 'document',
            'sec-fetch-mode': 'navigate',
            'sec-fetch-site': 'same-origin',
            'Upgrade-Insecure-Requests': '1',
        },
        body: new URLSearchParams({
            'applicationUrl': `${BASE_URL}/waw/ezw/`,
            'goto': 'EZW_OCA',
            'channelID': 'EasyWeb',
            'language': 'en',
            'applicationId': 'EZW:PRODBDC',
        }),
    });

    if (!ssoResponse.ok) {
        throw new Error(`SSO login failed: ${ssoResponse.status}`);
    }
}

/**
 * Makes an authenticated API request
 * @param {string} endpoint - API endpoint path
 * @param {RequestInit} [options] - Additional fetch options
 * @returns {Promise<Response>}
 */
async function makeAuthenticatedRequest(endpoint, options = {}) {
    const url = `${BASE_URL}${endpoint}`;

    if (endpoint.includes('/waw/api/')) {
        const headers = {
            'Accept': 'application/json, text/plain, */*',
            'Referer': `${BASE_URL}/waw/webui/acct/`,
            ...options.headers,
        };

        const response = await fetch(url, { ...options, headers, credentials: 'include' });

        if (response.status === 403) {
            await initializeWawSession();
            const retryResponse = await fetch(url, { ...options, headers, credentials: 'include' });
            if (!retryResponse.ok) {
                throw new Error(`API request failed after session init: ${retryResponse.status} at ${endpoint}`);
            }
            return retryResponse;
        }

        if (!response.ok) {
            throw new Error(`API request failed: ${response.status} at ${endpoint}`);
        }
        return response;
    }

    // /ms/ endpoints use custom TD headers
    const appName = endpoint.includes('/ms/uainq/v1/accounts') ? 'RWUI-uu-accounts' : 'RWUI-unav-ew';
    const appVersion = endpoint.includes('/ms/uainq/v1/accounts') ? '25.7.1' : '25.9.1';

    const headers = {
        'Accept': 'application/json',
        'Accept-Language': 'en_CA',
        'Content-Type': 'application/json',
        'Referer': `${BASE_URL}/ui/ew/fs?fsType=PFS&kyc=Y`,
        'messageid': generateUUID(),
        'originating-app-name': appName,
        'originating-app-version-num': appVersion,
        'originating-channel-name': 'EWP',
        'timestamp': new Date().toISOString(),
        'traceabilityid': generateUUID(),
        ...(endpoint.includes('/accounts/list') ? { 'accept-secondary-language': 'fr_CA' } : {}),
        ...options.headers,
    };

    const response = await fetch(url, { ...options, headers, credentials: 'include' });

    if (!response.ok) {
        throw new Error(`API request failed: ${response.status} at ${endpoint}`);
    }
    return response;
}

/**
 * Retrieves the current user profile information
 * @param {string} sessionId - The session ID
 * @returns {Promise<import('./bank.types').Profile>}
 */
export async function getProfile(sessionId) {
    const response = await makeAuthenticatedRequest('/ms/mpref/v1/preferences/displayname');
    const data = /** @type {{displayName: string, firstName: string, initials: string}} */ (await response.json());

    if (!data?.displayName) {
        throw new Error('Invalid profile data received');
    }

    return {
        sessionId,
        profileId: data.displayName,
        profileName: data.displayName,
    };
}

/**
 * Maps TD Bank account type to standard account type
 * @param {string} accountType - TD Bank account type (PDA, VSA, etc.)
 * @param {string} productCd - Product code
 * @returns {import('./bank.types').AccountType}
 */
function mapAccountType(accountType, productCd) {
    if (accountType === 'VSA') return 'CreditCard';
    if (accountType === 'PDA' && productCd === 'IBA') return 'Savings';
    return 'Checking';
}

/**
 * Retrieves all accounts for the logged-in user
 * @param {import('./bank.types').Profile} profile - The user profile
 * @returns {Promise<import('./bank.types').Account[]>}
 */
export async function getAccounts(profile) {
    const response = await makeAuthenticatedRequest('/ms/uainq/v1/accounts/list');
    const data = /** @type {{accountList: Array<{
        accountKey: string,
        accountNumber: string,
        accountDisplayName: string,
        accountType: string,
        productCd: string,
        accountName: string
    }>}} */ (await response.json());

    if (!Array.isArray(data?.accountList)) {
        throw new Error('Invalid account list data received');
    }

    return data.accountList.map(account => ({
        profile,
        accountId: account.accountKey,
        accountName: account.accountDisplayName || account.accountName,
        accountMask: account.accountNumber.slice(-4),
        accountType: mapAccountType(account.accountType, account.productCd),
    }));
}

/**
 * Retrieves available statements for an account
 * @param {import('./bank.types').Account} account - The account
 * @returns {Promise<import('./bank.types').Statement[]>}
 */
export async function getStatements(account) {
    const endpoint = `/waw/api/edelivery/estmt/documentlist?accountKey=${account.accountId}&period=Last_12_Months&documentType=ESTMT`;
    const response = await makeAuthenticatedRequest(endpoint);
    const data = /** @type {{
        status: {statusCode: string, severity: string},
        documentList: Array<{
            documentId: string,
            name: string,
            documentDate: string,
            startDate: string,
            endDate: string
        }>
    }} */ (await response.json());

    if (!data?.documentList || data.status.severity !== 'SUCCESS') {
        throw new Error(`Invalid statement data: ${data?.status?.statusCode || 'unknown'}`);
    }

    return data.documentList.map(doc => ({
        account,
        statementId: doc.documentId,
        statementDate: (doc.endDate || doc.documentDate || doc.startDate).replace(/\//g, '-'),
    }));
}

/**
 * Downloads a statement PDF file
 * @param {import('./bank.types').Statement} statement - The statement
 * @returns {Promise<Blob>}
 */
export async function downloadStatement(statement) {
    const endpoint = `/waw/api/edelivery/estmt/documentdetail?documentKey=${statement.statementId}`;
    const response = await makeAuthenticatedRequest(endpoint);
    const data = /** @type {{
        status: {statusCode: string, severity: string},
        document: {content: string, documentId: string, mimeType: string}
    }} */ (await response.json());

    if (!data?.document?.content || data.status.severity !== 'SUCCESS') {
        throw new Error(`Invalid statement data: ${data?.status?.statusCode || 'unknown'}`);
    }

    const binaryString = atob(data.document.content);
    const bytes = new Uint8Array(binaryString.length);
    for (let i = 0; i < binaryString.length; i++) {
        bytes[i] = binaryString.charCodeAt(i);
    }
    return new Blob([bytes], { type: 'application/pdf' });
}
