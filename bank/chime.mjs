/**
 * Chime Bank API implementation for retrieving bank statements
 * @see analyze/chime.md
 * Uses GraphQL Automatic Persisted Queries (APQ) with static MD5 hashes.
 */

/** @type {string} */
export const bankId = 'chime';

/** @type {string} */
export const bankName = 'Chime';

const GRAPHQL_URL = 'https://app.chime.com/api/graphql';

// Persisted query hashes (MD5 prefixed) from analysis
const HASHES = {
    UserQuery: 'md5:f4a5ebcc4103cf23f7e582af45b0edd0',
    HomeFeedAccountsQuery: 'md5:ca98a6f37e5df3c609f762c922dd5edb',
    AccountInfoQuery: 'md5:e57adf8d54262ff92f7b952f3aac90b7',
    DocumentsQuery: 'md5:a17bd74480800ce36bfbc0c4b1516bae',
    GetMonthlyPdfStatementQuery: 'md5:409087bebf32f903eaab1e1498e1a724',
};

/**
 * Make a Chime GraphQL APQ request.
 * @param {string} operationName
 * @param {Record<string, any>} variables
 * @param {string} hash
 * @returns {Promise<any>} JSON response body
 */
async function graphQL(operationName, variables, hash) {
    const body = JSON.stringify({
        operationName,
        variables,
        extensions: { persistedQuery: { version: 1, sha256Hash: hash } },
    });

    const headers = {
        'accept': '*/*',
        'content-type': 'application/json',
        'chime-timezone': Intl.DateTimeFormat().resolvedOptions().timeZone || 'America/Los_Angeles',
        'origin': 'https://app.chime.com',
        'referer': 'https://app.chime.com/',
    };

    const resp = await fetch(GRAPHQL_URL, {
        method: 'POST',
        headers,
        body,
        credentials: 'include',
    });

    if (!resp.ok) {
        throw new Error(`Chime GraphQL error ${resp.status} ${resp.statusText} (${operationName})`);
    }

    const json = /** @type {any} */(await resp.json());
    if (!isObject(json) || (json.errors !== undefined &&
        (!Array.isArray(json.errors) || json.errors.length > 0)) || !isObject(json.data)) {
        const msg = Array.isArray(json?.errors)
            ? json.errors.map(/** @param {any} e */ e => typeof e?.message === 'string' ? e.message : 'Unknown error').join('; ')
            : 'Unknown error';
        throw new Error(`Invalid GraphQL response for ${operationName}: ${msg}`);
    }
    return json;
}

/** @param {any} value @returns {boolean} */
function isObject(value) {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/**
 * Parse document cookies into a map.
 * @returns {Record<string,string>}
 */
function getCookies() {
    /** @type {Record<string,string>} */
    const out = {};
    for (const part of document.cookie.split(/;\s*/)) {
        if (!part) continue;
        const eqIdx = part.indexOf('=');
        if (eqIdx === -1) continue;
        const name = part.substring(0, eqIdx);
        const value = part.substring(eqIdx + 1);
        out[name] = value;
    }
    return out;
}

/**
 * Get the current session ID from the `chime_session` cookie.
 * Falls back to `__Host-authn` if needed.
 * @returns {string}
 */
export function getSessionId() {
    const cookies = getCookies();
    const sessionCookie = cookies['chime_session'];
    if (sessionCookie) {
        // chime_session format: id=<uuid>&end_ts=<timestamp>
        const match = /id=([^&]+)/.exec(sessionCookie);
        if (match) return match[1];
        return sessionCookie; // fallback raw value
    }
    if (cookies['__Host-authn']) {
        return cookies['__Host-authn'];
    }
    throw new Error('Chime session cookie not found. User may not be logged in.');
}

/**
 * Retrieve user profile info via UserQuery.
 * @param {string} sessionId
 * @returns {Promise<import('./bank.types').Profile>}
 */
export async function getProfile(sessionId) {
    try {
        const json = await graphQL('UserQuery', {}, HASHES.UserQuery);
        const me = json.data.me;
        if (!isObject(me)) throw new Error('Invalid Chime profile data');
        const cookies = getCookies();
        const profileId = cookies['chime_user_id'] || cookies['__Host-uid'] || sessionId;
        const first = (me.first_name || '').trim();
        const last = (me.last_name || '').trim();
        const profileName = (first || last) ? [first, last].filter(Boolean).join(' ') : profileId;
        return { sessionId, profileId: String(profileId), profileName };
    } catch (err) {
        const e = /** @type {Error} */(err);
        throw new Error(`Failed to get Chime profile: ${e.message}`);
    }
}

/**
 * Map Chime account name / type to internal AccountType.
 * @param {string} name
 * @returns {import('./bank.types').AccountType}
 */
function mapAccountType(name) {
    const n = (name || '').toLowerCase();
    if (n.includes('check')) return 'Checking';
    if (n.includes('saving')) return 'Savings';
    if (n.includes('credit')) return 'CreditCard';
    return 'Checking';
}

/**
 * Retrieve accounts via HomeFeedAccountsQuery.
 * @param {import('./bank.types').Profile} profile
 * @returns {Promise<import('./bank.types').Account[]>}
 */
export async function getAccounts(profile) {
    try {
        const json = await graphQL('HomeFeedAccountsQuery', {}, HASHES.HomeFeedAccountsQuery);
        const root = json.data.user?.bank_account_v2;
        if (!isObject(root)) throw new Error('Invalid Chime account data');
        const out = [];

        const primary = root.primary_funding_account;
        if (primary && primary.id) {
            const info = await graphQL('AccountInfoQuery', {}, HASHES.AccountInfoQuery);
            const details = info.data.me?.bank_account_v2?.primary_funding_account;
            if (!isObject(details) || details.id !== primary.id ||
                typeof details.account_number !== 'string' || !/^\d{4,}$/.test(details.account_number)) {
                throw new Error('Invalid or mismatched Chime checking account details');
            }
            out.push({
                profile,
                accountId: String(primary.id),
                accountName: primary.account_name || 'Checking',
                accountMask: details.account_number.slice(-4),
                accountType: mapAccountType(primary.account_name || 'Checking'),
            });
        }
        const savings = root.savings_account;
        if (savings && savings.id) {
            out.push({
                profile,
                accountId: String(savings.id),
                accountName: savings.account_name || 'Savings',
                accountMask: String(savings.id).slice(-4),
                accountType: /** @type {import('./bank.types').AccountType} */('Savings'),
            });
        }
        const credit = root.secured_credit_account;
        if (credit && credit.id) {
            out.push({
                profile,
                accountId: String(credit.id),
                accountName: credit.account_name || 'Credit Card',
                accountMask: String(credit.id).slice(-4),
                accountType: /** @type {import('./bank.types').AccountType} */('CreditCard'),
            });
        }
        return out;
    } catch (err) {
        const e = /** @type {Error} */(err);
        throw new Error(`Failed to get Chime accounts: ${e.message}`);
    }
}

/**
 * Get statements for an account by querying all statement accounts and filtering.
 * @param {import('./bank.types').Account} account
 * @returns {Promise<import('./bank.types').Statement[]>}
 */
export async function getStatements(account) {
    try {
        // Query all types, then match against this account's type bucket.
        const json = await graphQL('DocumentsQuery', { account_types: ['credit', 'checking', 'savings'] }, HASHES.DocumentsQuery);
        const statementAccounts = json.data.statements?.statement_accounts;
        if (!Array.isArray(statementAccounts) || statementAccounts.some(a => !isObject(a) || typeof a.account_type !== 'string')) {
            throw new Error('Invalid Chime statement account list');
        }
        const targetType = accountTypeToApi(account.accountType);
        const buckets = statementAccounts.filter(/** @param {any} a */ a => a.account_type === targetType);
        if (buckets.length > 1) throw new Error('Ambiguous Chime statement accounts');
        const periods = buckets.length ? buckets[0].statement_periods : [];
        if (!Array.isArray(periods)) throw new Error('Invalid Chime statement periods');
        const out = [];
        for (const p of periods) {
            if (!isObject(p) || typeof p.id !== 'string' || !p.id.trim() ||
                !Number.isInteger(p.month) || p.month < 1 || p.month > 12 ||
                !Number.isInteger(p.year) || p.year < 1000 || p.year > 9999) {
                throw new Error('Invalid statement period from Chime');
            }
            const date = new Date(Date.UTC(p.year, p.month - 1, 1)).toISOString();
            out.push({
                account,
                statementId: String(p.id),
                statementDate: date,
            });
        }
        // Newest first
        out.sort((a, b) => new Date(b.statementDate).getTime() - new Date(a.statementDate).getTime());
        return out;
    } catch (err) {
        const e = /** @type {Error} */(err);
        throw new Error(`Failed to get Chime statements for account ${account.accountId}: ${e.message}`);
    }
}

/**
 * Download a statement PDF using GetMonthlyPdfStatementQuery.
 * @param {import('./bank.types').Statement} statement
 * @returns {Promise<Blob>}
 */
export async function downloadStatement(statement) {
    try {
        const date = new Date(statement.statementDate);
        if (!Number.isFinite(date.getTime())) throw new Error('Invalid Chime statement date');
        const month = date.getUTCMonth() + 1;
        const year = date.getUTCFullYear();
        const accountTypeApi = accountTypeToApi(statement.account.accountType);
        const json = await graphQL('GetMonthlyPdfStatementQuery', {
            account_types: [accountTypeApi],
            month,
            year,
        }, HASHES.GetMonthlyPdfStatementQuery);
        const accounts = json.data.statements?.statement_accounts;
        if (!Array.isArray(accounts)) throw new Error('Invalid Chime PDF account list');
        if (accounts.length > 1) throw new Error('Ambiguous Chime PDF accounts');
        const b64 = accounts[0]?.monthly_pdf_statement?.encoded_pdf;
        if (typeof b64 !== 'string' || !b64) {
            throw new Error('Encoded PDF not found in response');
        }
        // Decode base64 to binary
        const bytes = Uint8Array.from(atob(b64), c => c.charCodeAt(0));
        const blob = new Blob([bytes], { type: 'application/pdf' });
        if (await blob.slice(0, 5).text() !== '%PDF-') {
            throw new Error('Chime did not return a PDF statement');
        }
        return blob;
    } catch (err) {
        const e = /** @type {Error} */(err);
        throw new Error(`Failed to download Chime statement ${statement.statementId}: ${e.message}`);
    }
}

/**
 * Convert internal AccountType to Chime API account_type string.
 * @param {import('./bank.types').AccountType} t
 * @returns {'checking'|'savings'|'credit'}
 */
function accountTypeToApi(t) {
    switch (t) {
        case 'Savings': return 'savings';
        case 'CreditCard': return 'credit';
        default: return 'checking';
    }
}
