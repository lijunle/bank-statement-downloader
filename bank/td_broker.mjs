/**
 * TD Direct Investing (WebBroker) API implementation for retrieving investment statements
 * @see analyze/td_broker.md
 * 
 * TD WebBroker uses cookie-based session management:
 * - JSESSIONID: Java session ID (HttpOnly)
 * - WBT-JSESSIONID: WebBroker session ID (HttpOnly)
 * - com.td.wb.SSO_GUID: SSO GUID token (HttpOnly)
 * - XSRF-TOKEN: CSRF protection token (accessible)
 * - com.td.last_login: Last login timestamp (accessible)
 * 
 * Session cookies are HttpOnly, so we use XSRF-TOKEN or com.td.last_login
 * to verify logged-in status. The actual session is handled by cookies
 * automatically via credentials: 'include'.
 */

/** @type {string} */
export const bankId = 'td_broker';

/** @type {string} */
export const bankName = 'TD Direct Investing (WebBroker)';

const BASE_URL = 'https://webbroker.td.com';
const API_BASE = `${BASE_URL}/waw/brk/wb/services/rest`;

/**
 * Get the current session ID from cookies
 * Uses XSRF-TOKEN or com.td.last_login as session identifier (accessible cookies)
 * The actual session is maintained via HttpOnly cookies automatically
 * @returns {string}
 */
export function getSessionId() {
    const cookies = document.cookie.split(';');
    /** @type {string | undefined} */
    let xsrfToken;
    /** @type {string | undefined} */
    let lastLogin;

    for (const cookie of cookies) {
        const [name, value] = cookie.trim().split('=');
        if (name === 'XSRF-TOKEN' && value) {
            xsrfToken = value;
        }
        if (name === 'com.td.last_login' && value) {
            lastLogin = value;
        }
    }

    if (xsrfToken) {
        return xsrfToken;
    }

    if (lastLogin) {
        return lastLogin;
    }

    throw new Error(
        'TD WebBroker session not found. Please ensure you are logged in to webbroker.td.com.'
    );
}

/**
 * Get user profile information
 * @param {string} sessionId - The session ID (not used directly, session is cookie-based)
 * @returns {Promise<import('./bank.types').Profile>}
 */
export async function getProfile(sessionId) {
    const url = `${API_BASE}/v1/eservices/profile?AJAXREQUEST=1`;

    const response = await fetch(url, {
        method: 'GET',
        credentials: 'include',
        headers: {
            'Accept': 'application/json',
        },
    });

    if (!response.ok) {
        throw new Error(`Failed to get profile: ${response.status} ${response.statusText}`);
    }

    const data = await response.json();

    // The profile API can return either:
    // 1. Direct payload: { connectId, email, status: 'REGISTERED', ... }
    // 2. Wrapped response: { status: 'SUCCESS', payload: { connectId, email, ... } }
    const payload = data.payload || data;

    if (!payload || !payload.connectId) {
        throw new Error('Profile API returned no valid data');
    }

    return {
        sessionId,
        profileId: payload.connectId || '',
        profileName: payload.email || payload.connectId || 'TD WebBroker User',
    };
}

/**
 * @typedef {object} AccountGroup
 * @property {boolean} favorite
 * @property {string} groupNumber
 * @property {string} groupId
 * @property {string} businessLine
 * @property {string} divisionType
 * @property {string} tradingPlatform
 * @property {string} accountPlatform
 */

/**
 * Get all account groups for the user
 * @param {import('./bank.types').Profile} profile - User profile
 * @returns {Promise<import('./bank.types').Account[]>}
 */
export async function getAccounts(profile) {
    const url = `${API_BASE}/v2/accountsV2/account-groups?filter=ESERVICES_STATEMENTS_FILTER&AJAXREQUEST=1`;

    const response = await fetch(url, {
        method: 'GET',
        credentials: 'include',
        headers: {
            'Accept': 'application/json',
        },
    });

    if (!response.ok) {
        throw new Error(`Failed to get accounts: ${response.status} ${response.statusText}`);
    }

    const data = await response.json();

    // The API can return either:
    // 1. Direct array: [{ groupNumber, groupId, ... }, ...]
    // 2. Wrapped response: { status: 'SUCCESS', payload: [...] }
    /** @type {AccountGroup[]} */
    const groups = Array.isArray(data) ? data : (data.payload || []);

    if (!Array.isArray(groups)) {
        throw new Error('Accounts API returned invalid data format');
    }

    return groups.map((group) => ({
        profile,
        accountId: group.groupId,
        accountName: group.businessLine,
        accountMask: group.groupNumber,
        accountType: /** @type {import('./bank.types').AccountType} */ ('Investment'),
    }));
}

/**
 * @typedef {object} StatementDocument
 * @property {string} documentType
 * @property {string} id
 * @property {string} seq
 * @property {string} fileType
 * @property {string} runDate
 * @property {object} states
 * @property {boolean} states.PERFORMANCE_AND_FEES
 * @property {boolean} states.REVISED
 * @property {boolean} states.DORMANT
 * @property {string} descriptionCode
 * @property {string} stmtDate
 * @property {string} mimeType
 * @property {string} docType
 * @property {string} groupNumber
 * @property {string} rrCode
 */

/**
 * Format date to YYYY-MM-DDT00:00:00 format
 * @param {Date} date
 * @returns {string}
 */
function formatDateParam(date) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}T00:00:00`;
}

/**
 * Get all statements for an account
 * @param {import('./bank.types').Account} account - The account to get statements for
 * @returns {Promise<import('./bank.types').Statement[]>}
 */
export async function getStatements(account) {
    // Get statements for the last 7 years (TD typically keeps statements for 7 years)
    const toDate = new Date();
    const fromDate = new Date();
    fromDate.setFullYear(fromDate.getFullYear() - 7);

    const fromDateStr = formatDateParam(fromDate);
    const toDateStr = formatDateParam(toDate);

    const url = `${API_BASE}/v1/eservices/statements/${encodeURIComponent(account.accountId)}?fromDate=${encodeURIComponent(fromDateStr)}&toDate=${encodeURIComponent(toDateStr)}&AJAXREQUEST=1`;

    const response = await fetch(url, {
        method: 'GET',
        credentials: 'include',
        headers: {
            'Accept': 'application/json',
        },
    });

    if (!response.ok) {
        throw new Error(`Failed to get statements: ${response.status} ${response.statusText}`);
    }

    const data = await response.json();

    // The API returns either:
    // 1. Direct format: { documents: [...] }
    // 2. Wrapped format: { status: 'SUCCESS', payload: { documents: [...] } }
    /** @type {StatementDocument[]} */
    const documents = data.documents || data.payload?.documents || [];

    return documents.map((doc) => ({
        account,
        // Store the full document info as JSON in statementId for use in download
        statementId: JSON.stringify({
            documentType: doc.documentType,
            id: doc.id,
            seq: doc.seq,
            fileType: doc.fileType,
            runDate: doc.runDate,
            states: doc.states,
            descriptionCode: doc.descriptionCode,
            stmtDate: doc.stmtDate,
            mimeType: doc.mimeType,
            docType: doc.docType,
            groupNumber: doc.groupNumber,
            rrCode: doc.rrCode,
        }),
        statementDate: doc.stmtDate,
    }));
}

/**
 * Download a statement as PDF
 * @param {import('./bank.types').Statement} statement - The statement to download
 * @returns {Promise<Blob>}
 */
export async function downloadStatement(statement) {
    // Parse the document info from statementId
    /** @type {StatementDocument} */
    let docInfo;
    try {
        docInfo = JSON.parse(statement.statementId);
    } catch (e) {
        throw new Error('Invalid statement ID format');
    }

    // Build export request
    const exportRequest = {
        type: 'ESERVICES',
        fileFormat: 'PDF',
    };

    // Build export params with document details
    const exportParams = {
        documentList: [
            {
                documentType: docInfo.documentType,
                id: docInfo.id,
                seq: docInfo.seq,
                fileType: docInfo.fileType,
                runDate: convertToUTCFormat(docInfo.runDate),
                states: docInfo.states,
                descriptionCode: docInfo.descriptionCode,
                stmtDate: convertToUTCFormat(docInfo.stmtDate),
                mimeType: docInfo.mimeType,
                docType: docInfo.docType,
                groupNumber: docInfo.groupNumber,
                rrCode: docInfo.rrCode,
                description: getDescriptionFromCode(docInfo.descriptionCode),
            },
        ],
    };

    // Use POST method to download (returns attachment)
    const url = `${API_BASE}/v1/export`;

    const body = new URLSearchParams();
    body.append('exportRequest', JSON.stringify(exportRequest));
    body.append('exportParams', JSON.stringify(exportParams));

    const response = await fetch(url, {
        method: 'POST',
        credentials: 'include',
        headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            'Accept': 'application/pdf,*/*',
        },
        body: body.toString(),
    });

    if (!response.ok) {
        throw new Error(`Failed to download statement: ${response.status} ${response.statusText}`);
    }

    const contentType = response.headers.get('Content-Type');
    if (!contentType || !contentType.includes('application/pdf')) {
        throw new Error(`Unexpected content type: ${contentType}`);
    }

    return response.blob();
}

/**
 * Convert date string to UTC format expected by export API
 * e.g., "2025-10-01T00:00:00-0400" -> "2025-10-01T07:00:00.000Z"
 * @param {string} dateStr
 * @returns {string}
 */
function convertToUTCFormat(dateStr) {
    const date = new Date(dateStr);
    return date.toISOString();
}

/**
 * Get description text from description code
 * @param {string} code
 * @returns {string}
 */
function getDescriptionFromCode(code) {
    /** @type {Record<string, string>} */
    const descriptions = {
        'DIRECT_TRADE_CAD': 'Direct Trading - Canadian Dollar',
        'DIRECT_TRADE_USD': 'Direct Trading - US Dollar',
        'TFSA': 'Tax-Free Savings Account',
        'RRSP': 'Registered Retirement Savings Plan',
        'RRIF': 'Registered Retirement Income Fund',
        'RESP': 'Registered Education Savings Plan',
        'LIRA': 'Locked-In Retirement Account',
        'LIF': 'Life Income Fund',
    };
    return descriptions[code] || code;
}
