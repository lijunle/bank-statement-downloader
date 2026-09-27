/** @type {string} */
export const bankId = 'bmo';

/** @type {string} */
export const bankName = 'BMO';

function sessionContext() {
    let userId;
    try {
        userId = JSON.parse(localStorage.getItem('dpopUserId') || 'null');
    } catch {
        throw new Error('Invalid BMO session configuration. Reload the bank page.');
    }
    if (typeof userId !== 'string' || !userId) {
        throw new Error('BMO session configuration not found. Sign in on the bank page.');
    }
    return { userId, sessionId: getSessionId() };
}

/** @returns {Promise<string>} */
function getAccessToken() {
    return new Promise((resolve, reject) => {
        const responseEvent = 'TRANSMIT_CLIENT_ACCESS_TOKEN_RESPONSE';
        const timer = setTimeout(() => {
            window.removeEventListener(responseEvent, receive);
            reject(new Error('BMO token request timed out. Reload the bank page and sign in.'));
        }, 5000);
        /** @param {Event} event */
        function receive(event) {
            const detail = /** @type {CustomEvent} */ (event).detail;
            if (detail?.action !== 'response') return;
            clearTimeout(timer);
            window.removeEventListener(responseEvent, receive);
            if (typeof detail.accessToken !== 'string' || !detail.accessToken) {
                reject(new Error('BMO access token is unavailable. Reload the bank page and sign in.'));
            } else {
                resolve(detail.accessToken);
            }
        }
        window.addEventListener(responseEvent, receive);
        try {
            window.dispatchEvent(new Event('TRANSMIT_CLIENT_ACCESS_TOKEN_REQUEST'));
        } catch {
            clearTimeout(timer);
            window.removeEventListener(responseEvent, receive);
            reject(new Error('Could not request the BMO page access token.'));
        }
    });
}

/**
 * @param {string} userId
 * @returns {Promise<{jwk: JsonWebKey, privateKey: CryptoKey}>}
 */
async function getSigningKey(userId) {
    const db = await new Promise(/** @param {(db: IDBDatabase) => void} resolve */ (resolve, reject) => {
        const request = indexedDB.open('biometric-plugin');
        let abandoned = false;
        const timer = setTimeout(() => fail('BMO signing-key database lookup timed out. Reload the bank page.'), 5000);
        /** @param {string} message */
        function fail(message) {
            abandoned = true;
            clearTimeout(timer);
            reject(new Error(message));
        }
        request.onupgradeneeded = () => request.transaction?.abort();
        request.onblocked = () => fail('BMO signing-key database is blocked. Reload the bank page.');
        request.onerror = () => fail('BMO signing-key database is unavailable.');
        request.onsuccess = () => {
            clearTimeout(timer);
            if (abandoned) {
                request.result.close();
            } else {
                resolve(request.result);
            }
        };
    });
    try {
        if (!db.objectStoreNames.contains('dpop-keys')) {
            throw new Error('BMO signing-key store is unavailable.');
        }
        const key = await new Promise((resolve, reject) => {
            const transaction = db.transaction('dpop-keys', 'readonly');
            const request = transaction.objectStore('dpop-keys').get(userId);
            const timer = setTimeout(() => {
                reject(new Error('BMO signing-key read timed out. Reload the bank page.'));
                if (request.readyState === 'pending') transaction.abort();
            }, 5000);
            request.onerror = () => {
                clearTimeout(timer);
                reject(new Error('Could not read the BMO signing key.'));
            };
            request.onsuccess = () => {
                clearTimeout(timer);
                resolve(request.result);
            };
        });
        if (!key?.jwk || !(key.privateKey instanceof CryptoKey) ||
            key.privateKey.algorithm.name !== 'RSA-PSS' || !key.privateKey.usages.includes('sign')) {
            throw new Error('BMO signing key is unavailable or unsupported.');
        }
        return key;
    } finally {
        db.close();
    }
}

/** @param {Uint8Array} bytes */
function base64url(bytes) {
    return btoa(Array.from(bytes, byte => String.fromCharCode(byte)).join(''))
        .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/**
 * @param {string} target
 * @param {string} method
 * @param {{jwk: JsonWebKey, privateKey: CryptoKey}} key
 * @param {string} [accessToken]
 */
async function createProof(target, method, key, accessToken) {
    /** @type {Record<string, string | number>} */
    const payload = { htu: target, htm: method, jti: crypto.randomUUID(), iat: Math.floor(Date.now() / 1000) };
    if (accessToken) {
        const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(accessToken));
        payload.ath = base64url(new Uint8Array(hash));
    }
    const header = { typ: 'dpop+jwt', alg: 'PS256', jwk: key.jwk };
    const unsigned = `${base64url(new TextEncoder().encode(JSON.stringify(header)))}.${base64url(new TextEncoder().encode(JSON.stringify(payload)))}`;
    const signature = await crypto.subtle.sign(
        { name: 'RSA-PSS', saltLength: 32 }, key.privateKey, new TextEncoder().encode(unsigned),
    );
    return `${unsigned}.${base64url(new Uint8Array(signature))}`;
}

async function getAuthentication() {
    const context = sessionContext();
    const accessToken = await getAccessToken();
    const key = await getSigningKey(context.userId);
    return { context, accessToken, key };
}

/**
 * @param {string} url
 * @param {RequestInit} options
 * @returns {Promise<any>}
 */
async function authenticatedJson(url, options) {
    const auth = await getAuthentication();
    const headers = new Headers(options.headers);
    headers.set('Authorization', `dpop ${auth.accessToken}`);
    headers.set('DPoP', await createProof(new URL(url).pathname, options.method || 'GET', auth.key, auth.accessToken));
    const current = sessionContext();
    if (auth.context.userId !== current.userId || auth.context.sessionId !== current.sessionId) {
        throw new Error('BMO session changed during authentication. Reload the bank page.');
    }
    const response = await fetch(url, { ...options, headers, credentials: 'include' });
    if (!response.ok) {
        throw new Error(`BMO API request failed: HTTP ${response.status}.`);
    }
    return response.json();
}

/**
 * Helper function to get a cookie value by name
 * @param {string} name - Cookie name
 * @returns {string | null}
 */
function getCookie(name) {
    const cookies = document.cookie.split(';');
    for (const cookie of cookies) {
        const [key, ...parts] = cookie.trim().split('=');
        if (key === name) {
            return decodeURIComponent(parts.join('='));
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

    return authenticatedJson(url, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Accept': 'application/json, text/plain, */*',
            'X-XSRF-TOKEN': xsrfToken || '',
            'X-ChannelType': 'OLB',
            'X-Request-ID': Object.values(body)[0].HdrRq.rqUID,
            'X-UI-Session-ID': '0.0.1',
            'X-App-Version': 'session-id',
            'X-App-Current-Path': '/banking/digital/accounts',
            'X-Original-Request-Time': new Date().toUTCString(),
        },
        body: JSON.stringify(body),
    });

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
        'https://www1.bmo.com/api/cdb/customer-product-and-service-directory/mysummary/getMySummary',
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
                // Extract last 4 digits from account number (synthetic format: "0000 0001-234")
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
        'https://www1.bmo.com/api/cdb/document-services/estatements/getEStatementsEncryptedData',
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
    const statementListUrl = `https://www1.bmo.com/api/cdb/document-services/WebContentManager/getEDocumentsJSONList?encrypted_data=${encodeURIComponent(encryptedData)}`;
    const statementData = await authenticatedJson(statementListUrl, {
        method: 'GET',
        headers: {
            'Accept': 'application/json, text/plain, */*',
        },
    });

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

    const downloadUrl = `https://www1.bmo.com/api/cdb/document-services/WebContentManager/DownloadEStatementInPDFBOSServlet?dummyParams=${encodeURIComponent(dummyParams)}&token=${encodeURIComponent(token)}&econfirmation=false`;

    const response = await fetch(downloadUrl, {
        method: 'GET',
        headers: {
            'Accept': 'application/pdf',
        },
        credentials: 'include',
    });

    if (!response.ok) {
        throw new Error(`Failed to download statement: ${response.status} ${response.statusText}`);
    }

    const blob = await response.blob();
    if (blob.type.split(';')[0].trim().toLowerCase() !== 'application/pdf' ||
        await blob.slice(0, 5).text() !== '%PDF-') {
        throw new Error('BMO did not return a PDF statement.');
    }
    return blob;
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
