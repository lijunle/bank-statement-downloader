/**
 * EQ Bank API implementation for retrieving bank statements
 * @see analyze/eq_bank.md
 */

/** @type {string} */
export const bankId = 'eq_bank';

/** @type {string} */
export const bankName = 'EQ Bank';

const BASE_URL = 'https://web-api.eqbank.ca/web/v1.1';

/** @type {string | null} */
let capturedAccessToken = null;

/** @type {number | null} */
let tokenExpiryTime = null;

/**
 * Finds the encryption key cookie (eq_uuid*)
 * @returns {string | null}
 */
function getEncryptionKey() {
    const cookies = document.cookie.split(';');
    const eqUuidCookie = cookies
        .map(c => c.trim())
        .find(c => c.startsWith('eq_uuid'));

    if (!eqUuidCookie) {
        return null;
    }

    const [, ...valueParts] = eqUuidCookie.split('=');
    const encryptionKeyBase64 = valueParts.join('=');
    return atob(encryptionKeyBase64);
}

/**
 * MD5 hash implementation (native JavaScript, no external dependencies)
 * Required because Web Crypto API doesn't support MD5 (deprecated for security)
 * @param {Uint8Array} data - Data to hash
 * @returns {Uint8Array} MD5 hash (16 bytes)
 */
function md5(data) {
    /** @param {number} value @param {number} amount @returns {number} */
    function rotateLeft(value, amount) {
        return (value << amount) | (value >>> (32 - amount));
    }

    /** @param {number} x @param {number} y @returns {number} */
    function addUnsigned(x, y) {
        return (x + y) >>> 0;
    }

    /** @param {Uint32Array} x @param {Uint32Array} k @returns {void} */
    function md5cycle(x, k) {
        let a = x[0], b = x[1], c = x[2], d = x[3];

        a = ff(a, b, c, d, k[0], 7, 0xd76aa478);
        d = ff(d, a, b, c, k[1], 12, 0xe8c7b756);
        c = ff(c, d, a, b, k[2], 17, 0x242070db);
        b = ff(b, c, d, a, k[3], 22, 0xc1bdceee);
        a = ff(a, b, c, d, k[4], 7, 0xf57c0faf);
        d = ff(d, a, b, c, k[5], 12, 0x4787c62a);
        c = ff(c, d, a, b, k[6], 17, 0xa8304613);
        b = ff(b, c, d, a, k[7], 22, 0xfd469501);
        a = ff(a, b, c, d, k[8], 7, 0x698098d8);
        d = ff(d, a, b, c, k[9], 12, 0x8b44f7af);
        c = ff(c, d, a, b, k[10], 17, 0xffff5bb1);
        b = ff(b, c, d, a, k[11], 22, 0x895cd7be);
        a = ff(a, b, c, d, k[12], 7, 0x6b901122);
        d = ff(d, a, b, c, k[13], 12, 0xfd987193);
        c = ff(c, d, a, b, k[14], 17, 0xa679438e);
        b = ff(b, c, d, a, k[15], 22, 0x49b40821);

        a = gg(a, b, c, d, k[1], 5, 0xf61e2562);
        d = gg(d, a, b, c, k[6], 9, 0xc040b340);
        c = gg(c, d, a, b, k[11], 14, 0x265e5a51);
        b = gg(b, c, d, a, k[0], 20, 0xe9b6c7aa);
        a = gg(a, b, c, d, k[5], 5, 0xd62f105d);
        d = gg(d, a, b, c, k[10], 9, 0x02441453);
        c = gg(c, d, a, b, k[15], 14, 0xd8a1e681);
        b = gg(b, c, d, a, k[4], 20, 0xe7d3fbc8);
        a = gg(a, b, c, d, k[9], 5, 0x21e1cde6);
        d = gg(d, a, b, c, k[14], 9, 0xc33707d6);
        c = gg(c, d, a, b, k[3], 14, 0xf4d50d87);
        b = gg(b, c, d, a, k[8], 20, 0x455a14ed);
        a = gg(a, b, c, d, k[13], 5, 0xa9e3e905);
        d = gg(d, a, b, c, k[2], 9, 0xfcefa3f8);
        c = gg(c, d, a, b, k[7], 14, 0x676f02d9);
        b = gg(b, c, d, a, k[12], 20, 0x8d2a4c8a);

        a = hh(a, b, c, d, k[5], 4, 0xfffa3942);
        d = hh(d, a, b, c, k[8], 11, 0x8771f681);
        c = hh(c, d, a, b, k[11], 16, 0x6d9d6122);
        b = hh(b, c, d, a, k[14], 23, 0xfde5380c);
        a = hh(a, b, c, d, k[1], 4, 0xa4beea44);
        d = hh(d, a, b, c, k[4], 11, 0x4bdecfa9);
        c = hh(c, d, a, b, k[7], 16, 0xf6bb4b60);
        b = hh(b, c, d, a, k[10], 23, 0xbebfbc70);
        a = hh(a, b, c, d, k[13], 4, 0x289b7ec6);
        d = hh(d, a, b, c, k[0], 11, 0xeaa127fa);
        c = hh(c, d, a, b, k[3], 16, 0xd4ef3085);
        b = hh(b, c, d, a, k[6], 23, 0x04881d05);
        a = hh(a, b, c, d, k[9], 4, 0xd9d4d039);
        d = hh(d, a, b, c, k[12], 11, 0xe6db99e5);
        c = hh(c, d, a, b, k[15], 16, 0x1fa27cf8);
        b = hh(b, c, d, a, k[2], 23, 0xc4ac5665);

        a = ii(a, b, c, d, k[0], 6, 0xf4292244);
        d = ii(d, a, b, c, k[7], 10, 0x432aff97);
        c = ii(c, d, a, b, k[14], 15, 0xab9423a7);
        b = ii(b, c, d, a, k[5], 21, 0xfc93a039);
        a = ii(a, b, c, d, k[12], 6, 0x655b59c3);
        d = ii(d, a, b, c, k[3], 10, 0x8f0ccc92);
        c = ii(c, d, a, b, k[10], 15, 0xffeff47d);
        b = ii(b, c, d, a, k[1], 21, 0x85845dd1);
        a = ii(a, b, c, d, k[8], 6, 0x6fa87e4f);
        d = ii(d, a, b, c, k[15], 10, 0xfe2ce6e0);
        c = ii(c, d, a, b, k[6], 15, 0xa3014314);
        b = ii(b, c, d, a, k[13], 21, 0x4e0811a1);
        a = ii(a, b, c, d, k[4], 6, 0xf7537e82);
        d = ii(d, a, b, c, k[11], 10, 0xbd3af235);
        c = ii(c, d, a, b, k[2], 15, 0x2ad7d2bb);
        b = ii(b, c, d, a, k[9], 21, 0xeb86d391);

        x[0] = addUnsigned(a, x[0]);
        x[1] = addUnsigned(b, x[1]);
        x[2] = addUnsigned(c, x[2]);
        x[3] = addUnsigned(d, x[3]);
    }

    /** @param {number} q @param {number} a @param {number} b @param {number} x @param {number} s @param {number} t @returns {number} */
    function cmn(q, a, b, x, s, t) {
        a = addUnsigned(addUnsigned(a, q), addUnsigned(x, t));
        return addUnsigned(rotateLeft(a, s), b);
    }

    /** @param {number} a @param {number} b @param {number} c @param {number} d @param {number} x @param {number} s @param {number} t @returns {number} */
    function ff(a, b, c, d, x, s, t) {
        return cmn((b & c) | ((~b) & d), a, b, x, s, t);
    }

    /** @param {number} a @param {number} b @param {number} c @param {number} d @param {number} x @param {number} s @param {number} t @returns {number} */
    function gg(a, b, c, d, x, s, t) {
        return cmn((b & d) | (c & (~d)), a, b, x, s, t);
    }

    /** @param {number} a @param {number} b @param {number} c @param {number} d @param {number} x @param {number} s @param {number} t @returns {number} */
    function hh(a, b, c, d, x, s, t) {
        return cmn(b ^ c ^ d, a, b, x, s, t);
    }

    /** @param {number} a @param {number} b @param {number} c @param {number} d @param {number} x @param {number} s @param {number} t @returns {number} */
    function ii(a, b, c, d, x, s, t) {
        return cmn(c ^ (b | (~d)), a, b, x, s, t);
    }

    const msgLen = data.length;
    const nBlocks = ((msgLen + 8) >>> 6) + 1;
    const totalLen = nBlocks * 16;
    const words = new Uint32Array(totalLen);

    for (let i = 0; i < msgLen; i++) {
        words[i >>> 2] |= data[i] << ((i % 4) * 8);
    }

    words[msgLen >>> 2] |= 0x80 << ((msgLen % 4) * 8);
    words[totalLen - 2] = msgLen * 8;

    const state = new Uint32Array([0x67452301, 0xefcdab89, 0x98badcfe, 0x10325476]);

    for (let i = 0; i < totalLen; i += 16) {
        md5cycle(state, words.subarray(i, i + 16));
    }

    const result = new Uint8Array(16);
    for (let i = 0; i < 4; i++) {
        result[i * 4] = state[i] & 0xff;
        result[i * 4 + 1] = (state[i] >>> 8) & 0xff;
        result[i * 4 + 2] = (state[i] >>> 16) & 0xff;
        result[i * 4 + 3] = (state[i] >>> 24) & 0xff;
    }

    return result;
}

/**
 * Derives key and IV from passphrase using OpenSSL's EVP_BytesToKey with MD5
 * This replicates CryptoJS.AES.decrypt's key derivation for OpenSSL format
 * @param {string} passphrase - The passphrase/password
 * @param {Uint8Array} salt - 8-byte salt
 * @returns {Promise<{key: Uint8Array, iv: Uint8Array}>}
 */
async function evpBytesToKey(passphrase, salt) {
    const passphraseBytes = new TextEncoder().encode(passphrase);
    const keySize = 32; // 256 bits for AES-256
    const ivSize = 16;  // 128 bits for AES IV
    const derivedBytes = new Uint8Array(keySize + ivSize);

    /** @type {Uint8Array} */
    let currentHash = new Uint8Array(0);
    let derivedByteCount = 0;

    while (derivedByteCount < keySize + ivSize) {
        // Concatenate: currentHash + passphrase + salt
        const toHash = new Uint8Array(currentHash.length + passphraseBytes.length + salt.length);
        toHash.set(currentHash, 0);
        toHash.set(passphraseBytes, currentHash.length);
        toHash.set(salt, currentHash.length + passphraseBytes.length);

        // MD5 hash using native implementation
        currentHash = md5(toHash);

        // Copy hash to derived bytes
        const bytesToCopy = Math.min(currentHash.length, keySize + ivSize - derivedByteCount);
        derivedBytes.set(currentHash.subarray(0, bytesToCopy), derivedByteCount);
        derivedByteCount += bytesToCopy;
    }

    return {
        key: derivedBytes.subarray(0, keySize),
        iv: derivedBytes.subarray(keySize, keySize + ivSize)
    };
}

/**
 * Decrypt the EQ Bank token from sessionStorage
 * The token is stored encrypted in sessionStorage['ZXFUb2tlbg=='] (base64 for "eqToken")
 * It's encrypted using CryptoJS AES with OpenSSL-compatible format
 * 
 * @returns {Promise<string>} The decrypted JWT Bearer token
 */
async function decryptToken() {
    // Step 1: Get the encryption key from cookie
    const encryptionKey = getEncryptionKey();
    if (!encryptionKey) {
        throw new Error(
            'Encryption key not found. Please make sure you are logged in to EQ Bank.'
        );
    }

    // Step 2: Get the encrypted token from sessionStorage
    const encryptedTokenKey = 'ZXFUb2tlbg=='; // base64 for "eqToken"
    const encryptedToken = sessionStorage.getItem(encryptedTokenKey);

    if (!encryptedToken) {
        throw new Error(
            'Encrypted token not found in sessionStorage. Please make sure you are logged in to EQ Bank.'
        );
    }

    // Step 3: Decrypt using native Web Crypto API
    try {
        // Decode base64 ciphertext (CryptoJS OpenSSL format: "Salted__" + 8-byte salt + ciphertext)
        const ciphertextBytes = Uint8Array.from(atob(encryptedToken), c => c.charCodeAt(0));

        // Check for "Salted__" prefix (OpenSSL format)
        const salted = String.fromCharCode(...ciphertextBytes.subarray(0, 8));
        if (salted !== 'Salted__') {
            throw new Error('Invalid ciphertext format (missing Salted__ prefix)');
        }

        // Extract salt and actual ciphertext
        const salt = ciphertextBytes.subarray(8, 16);
        const actualCiphertext = ciphertextBytes.subarray(16);

        // Derive key and IV using OpenSSL's EVP_BytesToKey (MD5)
        const { key, iv } = await evpBytesToKey(encryptionKey, salt);

        // Import key for Web Crypto API
        const cryptoKey = await crypto.subtle.importKey(
            'raw',
            /** @type {BufferSource} */(key),
            { name: 'AES-CBC' },
            false,
            ['decrypt']
        );

        // Decrypt
        const decryptedBuffer = await crypto.subtle.decrypt(
            { name: 'AES-CBC', iv: /** @type {BufferSource} */ (iv) },
            cryptoKey,
            /** @type {BufferSource} */(actualCiphertext)
        );

        // Convert to UTF-8 string
        const decryptedToken = new TextDecoder().decode(decryptedBuffer);

        if (!decryptedToken || !decryptedToken.startsWith('eyJ')) {
            throw new Error('Decryption produced invalid result (not a JWT)');
        }

        return decryptedToken;

    } catch (error) {
        const err = /** @type {Error} */ (error);
        throw new Error(`Failed to decrypt token: ${err.message}`);
    }
}

/**
 * Parses JWT token and extracts expiry time
 * @param {string} token - JWT token
 * @returns {number} Expiry timestamp in milliseconds
 */
function getTokenExpiry(token) {
    try {
        const parts = token.split('.');
        if (parts.length !== 3) {
            return 0;
        }

        // Decode the payload (second part)
        const payload = JSON.parse(atob(parts[1]));

        // JWT exp is in seconds, convert to milliseconds
        if (payload.exp) {
            return payload.exp * 1000;
        }

        return 0;
    } catch (error) {
        console.error('Failed to parse JWT token:', error);
        return 0;
    }
}

/**
 * Checks if the cached token is still valid (not expired)
 * @returns {boolean} True if token is valid and not expired
 */
function isTokenValid() {
    if (!capturedAccessToken || !tokenExpiryTime) {
        return false;
    }

    // Check if token will expire in the next minute (60 seconds buffer)
    const now = Date.now();
    const bufferTime = 60 * 1000; // 60 seconds

    return (tokenExpiryTime - now) > bufferTime;
}

/**
 * Decrypts and returns the JWT access token from sessionStorage
 * @returns {Promise<string>} The JWT Bearer token
 */
export async function getSessionId() {
    // Check if we already have a valid token cached
    if (isTokenValid() && capturedAccessToken) {
        return capturedAccessToken;
    }

    // Decrypt the token from sessionStorage
    const token = await decryptToken();

    // Parse and cache the token expiry
    tokenExpiryTime = getTokenExpiry(token);

    // Cache the token for future use
    capturedAccessToken = token;

    return token;
}

/**
 * Makes an authenticated API request with all required headers
 * @param {string} endpoint - API endpoint path
 * @param {import('./bank.types').Profile} profile - User profile containing sessionId and email
 * @param {RequestInit} [options] - Additional fetch options
 * @param {Record<string, string>} [extraHeaders] - Additional headers to include
 * @returns {Promise<Response>}
 */
async function makeAuthenticatedRequest(endpoint, profile, options = {}, extraHeaders = {}) {
    const url = `${BASE_URL}${endpoint}`;

    const headers = /** @type {Record<string, string>} */ ({
        'accept': 'application/json, text/plain, */*',
        'accept-language': 'en-CA',
        'channel': 'WEB',
        'correlationid': generateCorrelationId(),
        'traceparent': generateTraceparent(),
        'origin': 'https://secure.eqbank.ca',
        'referer': 'https://secure.eqbank.ca/',
        ...extraHeaders,
        ...(options.headers || {}),
    });

    // Add Authorization header
    headers['authorization'] = `Bearer ${profile.sessionId}`;

    // Extract email from profileId (format: mnemonic|email)
    const profileIdParts = profile.profileId.split('|');
    if (profileIdParts.length > 1 && profileIdParts[1]) {
        headers['email'] = profileIdParts[1];
    }

    const response = await fetch(url, {
        ...options,
        headers,
        credentials: 'include',
    });

    // Handle 401 Unauthorized (expired token)
    if (response.status === 401) {
        // Clear cached token and force refresh
        capturedAccessToken = null;
        tokenExpiryTime = null;

        // Try to get a fresh token
        const freshToken = await getSessionId();

        // Update profile with fresh token
        profile.sessionId = freshToken;

        // Retry the request with fresh token
        const retryHeaders = { ...headers };
        retryHeaders['authorization'] = `Bearer ${freshToken}`;
        retryHeaders['correlationid'] = generateCorrelationId();
        retryHeaders['traceparent'] = generateTraceparent();

        const retryResponse = await fetch(url, {
            ...options,
            headers: retryHeaders,
            credentials: 'include',
        });

        if (!retryResponse.ok) {
            throw new Error(`EQ Bank API request failed after token refresh: ${retryResponse.status} ${retryResponse.statusText} at ${endpoint}`);
        }

        return retryResponse;
    }

    if (!response.ok) {
        throw new Error(`EQ Bank API request failed: ${response.status} ${response.statusText} at ${endpoint}`);
    }

    return response;
}

/**
 * Generates a correlation ID (UUID v4 format) for API requests
 * @returns {string} A UUID v4 formatted string
 */
function generateCorrelationId() {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
        const r = Math.random() * 16 | 0;
        const v = c === 'x' ? r : (r & 0x3 | 0x8);
        return v.toString(16);
    });
}

/**
 * Generates a traceparent header (W3C Trace Context format)
 * Format: 00-{trace-id}-{parent-id}-{trace-flags}
 * @returns {string} A W3C Trace Context traceparent string
 */
function generateTraceparent() {
    // Generate 32-char hex trace-id
    const traceId = Array.from({ length: 32 }, () =>
        Math.floor(Math.random() * 16).toString(16)
    ).join('');

    // Generate 16-char hex parent-id
    const parentId = Array.from({ length: 16 }, () =>
        Math.floor(Math.random() * 16).toString(16)
    ).join('');

    // trace-flags: 01 means sampled
    return `00-${traceId}-${parentId}-01`;
}

/**
 * Retrieves the current user profile
 * @param {string} sessionId - The JWT access token
 * @returns {Promise<import('./bank.types').Profile>}
 */
export async function getProfile(sessionId) {
    try {
        // Call the login-details endpoint to get user information
        // This endpoint returns customerFirstName, customerLastName, and mnemonic (user ID)
        const response = await fetch('https://api.eqbank.ca/auth/v3/login-details', {
            method: 'GET',
            headers: {
                'accept': 'application/json, text/plain, */*',
                'accept-language': 'en-CA',
                'authorization': `Bearer ${sessionId}`,
                'channel': 'WEB',
                'correlationid': generateCorrelationId(),
                'origin': 'https://secure.eqbank.ca',
                'referer': 'https://secure.eqbank.ca/',
            },
            credentials: 'include',
        });

        // Handle 401 Unauthorized (expired token)
        if (response.status === 401) {
            // Clear cached token and force refresh
            capturedAccessToken = null;
            tokenExpiryTime = null;

            // Try to get a fresh token
            const freshToken = await getSessionId();

            // Retry the request with fresh token
            const retryResponse = await fetch('https://api.eqbank.ca/auth/v3/login-details', {
                method: 'GET',
                headers: {
                    'accept': 'application/json, text/plain, */*',
                    'accept-language': 'en-CA',
                    'authorization': `Bearer ${freshToken}`,
                    'channel': 'WEB',
                    'correlationid': generateCorrelationId(),
                    'origin': 'https://secure.eqbank.ca',
                    'referer': 'https://secure.eqbank.ca/',
                },
                credentials: 'include',
            });

            if (!retryResponse.ok) {
                throw new Error(`Failed to get profile after token refresh: ${retryResponse.status} ${retryResponse.statusText}`);
            }

            const retryData = await retryResponse.json();
            const retryCustomerDetails = retryData.data?.customerDetails;

            if (!retryCustomerDetails) {
                throw new Error('No customer details found in response after retry');
            }

            const retryMnemonic = retryCustomerDetails.mnemonic || 'unknown';
            const retryEmail = retryCustomerDetails.email || '';
            const retryProfileName = retryCustomerDetails.customerName ||
                `${retryCustomerDetails.customerFirstName || ''} ${retryCustomerDetails.customerLastName || ''}`.trim() ||
                `User ${retryMnemonic}`;

            const retryProfileId = `${retryMnemonic}|${retryEmail}`;

            return {
                sessionId: freshToken,
                profileId: retryProfileId,
                profileName: retryProfileName,
            };
        }

        if (!response.ok) {
            throw new Error(`Failed to get profile: ${response.status} ${response.statusText}`);
        }

        const data = await response.json();
        const customerDetails = data.data?.customerDetails;

        if (!customerDetails) {
            throw new Error('No customer details found in response');
        }

        const mnemonic = customerDetails.mnemonic || 'unknown';
        const email = customerDetails.email || '';
        const profileName = customerDetails.customerName ||
            `${customerDetails.customerFirstName || ''} ${customerDetails.customerLastName || ''}`.trim() ||
            `User ${mnemonic}`;

        // Concatenate email into profileId using pipe separator
        const profileId = `${mnemonic}|${email}`;

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
 * Maps EQ Bank account types to standard account types
 * @param {string} accountType - The account type from EQ Bank
 * @param {string} productType - The product type from EQ Bank
 * @returns {import('./bank.types').AccountType}
 */
function mapAccountType(accountType, productType) {
    // Check product type first
    if (productType === 'CARD' || accountType === 'PPC') {
        return 'CreditCard';
    }

    // Map savings/checking types
    switch (accountType) {
        case 'HISA':
        case 'USD_HISA':
        case 'TFSA':
        case 'RRSP':
        case 'FHSA':
            return 'Savings';
        default:
            return 'Checking';
    }
}

/**
 * Retrieves all accounts for the logged-in user
 * @param {import('./bank.types').Profile} profile - The user profile
 * @returns {Promise<import('./bank.types').Account[]>}
 */
export async function getAccounts(profile) {
    try {
        const response = await makeAuthenticatedRequest('/accounts/v2/accounts', profile, {
            method: 'GET',
        });

        const data = await response.json();

        if (!Array.isArray(data)) {
            throw new Error('Invalid response format from accounts API');
        }

        const accounts = [];
        for (const account of data) {
            // Skip closed accounts
            if (account.restrictionStatus === 'CLOSED' || account.cardStatus === 'CLOSED') {
                continue;
            }

            const accountType = mapAccountType(account.accountType, account.productType);

            // Format account mask - show only last 4 digits or last part after dash
            let accountMask = account.accountNumber;
            if (account.productType === 'CARD' && account.cards && account.cards[0]) {
                // For cards, use last 4 digits from cards array
                accountMask = account.cards[0].lastFourDigits;
            } else if (accountMask && accountMask.length === 9) {
                // For regular accounts, show only last 3 digits (after the dashes)
                accountMask = accountMask.substring(6);
            } else if (account.cardNumber) {
                // Fallback: extract last 4 digits from cardNumber
                accountMask = account.cardNumber.replace(/\*/g, '').slice(-4);
            } else if (accountMask) {
                // Generic fallback: show last 4 digits
                accountMask = accountMask.slice(-4);
            }

            // Encode accountOpeningDate into accountId using pipe separator
            const accountIdWithDate = account.accountOpeningDate
                ? `${account.accountId}|${account.accountOpeningDate}`
                : account.accountId;

            accounts.push({
                profile,
                accountId: accountIdWithDate,
                accountName: `${account.accountName} (${account.currency})`,
                accountMask: accountMask || account.accountId.substring(0, 8),
                accountType,
            });
        }

        if (accounts.length === 0) {
            throw new Error('No active accounts found');
        }

        return accounts;
    } catch (error) {
        const err = /** @type {Error} */ (error);
        throw new Error(`Failed to get accounts: ${err.message}`);
    }
}

/**
 * Retrieves the account number from the original account data
 * This requires fetching the accounts again to get the mapping
 * @param {string} accountId - The account ID (hashed)
 * @param {string} sessionId - The JWT access token
 * @returns {Promise<string>}
 */
async function getAccountNumber(accountId, sessionId) {
    try {
        // Create minimal profile for API call
        const profile = { sessionId, profileId: '', profileName: '', profileEmail: '' };
        const response = await makeAuthenticatedRequest('/accounts/v2/accounts', profile, {
            method: 'GET',
        });

        const data = await response.json();

        if (!Array.isArray(data)) {
            throw new Error('Invalid response format from accounts API');
        }

        for (const account of data) {
            if (account.accountId === accountId) {
                return account.accountNumber;
            }
        }

        throw new Error(`Account number not found for accountId: ${accountId}`);
    } catch (error) {
        const err = /** @type {Error} */ (error);
        throw new Error(`Failed to get account number: ${err.message}`);
    }
}

/**
 * Retrieves the product type for an account
 * @param {string} accountId - The account ID (hashed)
 * @param {string} sessionId - The JWT access token
 * @returns {Promise<string>}
 */
async function getProductType(accountId, sessionId) {
    try {
        // Create minimal profile for API call
        const profile = { sessionId, profileId: '', profileName: '', profileEmail: '' };
        const response = await makeAuthenticatedRequest('/accounts/v2/accounts', profile, {
            method: 'GET',
        });

        const data = await response.json();

        if (!Array.isArray(data)) {
            throw new Error('Invalid response format from accounts API');
        }

        for (const account of data) {
            if (account.accountId === accountId) {
                return account.productType;
            }
        }

        throw new Error(`Product type not found for accountId: ${accountId}`);
    } catch (error) {
        const err = /** @type {Error} */ (error);
        throw new Error(`Failed to get product type: ${err.message}`);
    }
}

/**
 * Generates a list of statement dates for the past 12 months
 * @param {string | null} [accountOpeningDate] - Optional account opening date in YYYY-MM-DD format
 * @returns {Array<{statementMonthYear: string, startDate: string, endDate: string}>}
 */
function generateStatementDates(accountOpeningDate) {
    const statements = [];
    const now = new Date();

    // Parse account opening date if provided
    let openingDate = null;
    if (accountOpeningDate) {
        openingDate = new Date(accountOpeningDate);
    }

    // Start from previous month (skip current month since it hasn't ended)
    for (let i = 1; i <= 12; i++) {
        const statementDate = new Date(now.getFullYear(), now.getMonth() - i, 1);
        const year = statementDate.getFullYear();
        const month = statementDate.getMonth() + 1; // 0-indexed

        // Calculate start and end dates for the month
        const startDate = new Date(year, month - 1, 1);
        const endDate = new Date(year, month, 0); // Last day of the month

        // Skip months before account opening date
        if (openingDate && endDate < openingDate) {
            continue;
        }

        // Format: MMYYYY
        const statementMonthYear = `${month.toString().padStart(2, '0')}${year}`;

        // Format: YYYY-MM-DD
        const startDateStr = `${year}-${month.toString().padStart(2, '0')}-01`;
        const endDateStr = `${year}-${month.toString().padStart(2, '0')}-${endDate.getDate().toString().padStart(2, '0')}`;

        statements.push({
            statementMonthYear,
            startDate: startDateStr,
            endDate: endDateStr,
        });
    }

    return statements;
}

/**
 * Formats a date string for card statement API (ISO format with timezone)
 * @param {string} dateStr - Date string in YYYY-MM-DD format
 * @param {boolean} isEndDate - Whether this is an end date (sets to 23:59:59)
 * @returns {string}
 */
function formatCardStatementDate(dateStr, isEndDate = false) {
    // Parse the date string components to avoid timezone conversion
    const [year, month, day] = dateStr.split('-').map(Number);

    // Create date object in local timezone
    const date = new Date(year, month - 1, day);

    if (isEndDate) {
        // Set to end of day
        date.setHours(23, 59, 59, 999);
    } else {
        // Set to start of day
        date.setHours(0, 0, 0, 0);
    }

    // Format as ISO string with timezone offset
    const offset = -date.getTimezoneOffset();
    const offsetHours = Math.floor(Math.abs(offset) / 60);
    const offsetMinutes = Math.abs(offset) % 60;
    const offsetSign = offset >= 0 ? '+' : '-';

    const yearStr = date.getFullYear().toString();
    const monthStr = (date.getMonth() + 1).toString().padStart(2, '0');
    const dayStr = date.getDate().toString().padStart(2, '0');
    const hours = date.getHours().toString().padStart(2, '0');
    const minutes = date.getMinutes().toString().padStart(2, '0');
    const seconds = date.getSeconds().toString().padStart(2, '0');

    return `${yearStr}-${monthStr}-${dayStr}T${hours}:${minutes}:${seconds}${offsetSign}${offsetHours.toString().padStart(2, '0')}:${offsetMinutes.toString().padStart(2, '0')}`;
}

/**
 * Retrieves all statements for a specific account
 * @param {import('./bank.types').Account} account - The account to get statements for
 * @returns {Promise<import('./bank.types').Statement[]>}
 */
export async function getStatements(account) {
    try {
        // Decode accountOpeningDate from accountId (format: accountId|YYYY-MM-DD)
        const accountIdParts = account.accountId.split('|');
        const actualAccountId = accountIdParts[0];
        const accountOpeningDate = accountIdParts[1] || null;

        const statementDates = generateStatementDates(accountOpeningDate);
        const statements = [];

        // Get account number and product type for API calls
        const accountNumber = await getAccountNumber(actualAccountId, account.profile.sessionId);
        const productType = await getProductType(actualAccountId, account.profile.sessionId);

        for (const dateInfo of statementDates) {
            let statementId;
            let statementDate;

            if (productType === 'CARD') {
                // Card accounts use ISO datetime format
                const fromDateTime = formatCardStatementDate(dateInfo.startDate, false);
                const toDateTime = formatCardStatementDate(dateInfo.endDate, true);
                statementId = `${actualAccountId}|${fromDateTime}|${toDateTime}`;
                statementDate = dateInfo.endDate;
            } else {
                // Regular accounts use MMYYYY format
                statementId = `${accountNumber}|${dateInfo.statementMonthYear}|${dateInfo.startDate}|${dateInfo.endDate}`;
                statementDate = dateInfo.endDate;
            }

            statements.push({
                account,
                statementId,
                statementDate,
            });
        }

        return statements;
    } catch (error) {
        const err = /** @type {Error} */ (error);
        throw new Error(`Failed to get statements: ${err.message}`);
    }
}

/**
 * Downloads a statement file
 * @param {import('./bank.types').Statement} statement - The statement to download
 * @returns {Promise<Blob>}
 */
export async function downloadStatement(statement) {
    // PDF download is not currently supported for EQ Bank
    // The analysis document indicates that EQ Bank generates PDFs client-side using Angular + jsPDF,
    // and there is no reliable server-side PDF generation API available.
    // See analyze/eq_bank.md for detailed explanation of the challenges.
    throw new Error('PDF download is not currently supported for EQ Bank. EQ Bank generates PDFs client-side using Angular + jsPDF, and there is no reliable server-side PDF API. Please use the bank\'s website to download PDFs manually, or use the transaction data directly from getStatements().');
}
