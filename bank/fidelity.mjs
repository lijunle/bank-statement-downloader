/**
 * Fidelity Investments API implementation for retrieving bank statements
 * @see analyze/fidelity.md
 */

/** @type {string} */
export const bankId = 'fidelity';

/** @type {string} */
export const bankName = 'Fidelity';

const BASE_URL = 'https://digital.fidelity.com';
const CONTEXT_URL = `${BASE_URL}/ftgw/digital/portfolio/api/GetContext`;
const CREDITCARD_URL = 'https://dpservice.fidelity.com/ftgw/dp/customer-creditcard-statements/v1/customers/creditcards';
const SERVICES_URL = 'https://digitalservices.fidelity.com';
const CONTACTS_URL = `${SERVICES_URL}/ftgw/dp/rwcf-cm-contacts/v4/customers/contacts/get`;
const ACCOUNTS_URL = 'https://dpservice.fidelity.com/ftgw/dp/customer-am-acctnxt/v2/accounts';
const STATEMENTS_URL = `${SERVICES_URL}/ftgw/dp/retail-am-financialdoc/v1/accounts/communications/financial-documents/statements`;
const DOWNLOAD_URL = `${SERVICES_URL}/ftgw/dp/retail-am-financialdoc/v2/accounts/communications/financial-documents/download`;
const DOCUMENT_HEADERS = {
    'Accept': 'application/json',
    'Content-Type': 'application/json',
    'appid': 'AP160308',
    'appname': 'Document Access Hub',
    'fid-originating-app-id': 'AP160308',
    'fid-originating-app-version': '1',
};
const CONTACT_HEADERS = {
    'Accept': 'application/json',
    'Content-Type': 'application/json',
    'appid': 'AP162039',
    'appname': 'Enterprise Personal Info',
    'fid-originating-app-id': 'AP162039',
    'fid-originating-app-version': '2',
};
const CREDITCARD_HEADERS = {
    'Accept': 'application/json, text/plain, */*',
    'Content-Type': 'application/json',
    'appid': 'AP159750',
    'appname': 'Portfolio Summary Credit Card Account Management',
};

/**
 * @param {unknown} value
 * @returns {value is Record<string, unknown>}
 */
function isRecord(value) {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * @param {string} url
 * @param {Record<string, unknown>} body
 * @param {Record<string, string>} [headers]
 * @returns {Promise<Record<string, unknown>>}
 */
async function postJson(url, body, headers = DOCUMENT_HEADERS) {
    return fetchJson(url, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
    });
}

/**
 * @param {string} url
 * @param {RequestInit} options
 * @returns {Promise<Record<string, unknown>>}
 */
async function fetchJson(url, options) {
    const response = await fetch(url, { ...options, credentials: 'include' });
    if (!response.ok) {
        throw new Error(`Fidelity API request failed: ${response.status} ${response.statusText}`);
    }
    if (!response.headers.get('content-type')?.includes('application/json')) {
        throw new Error('Expected a JSON response from Fidelity. Please sign in to the Documents page again.');
    }
    const data = /** @type {unknown} */ (await response.json());
    if (!isRecord(data)) {
        throw new Error('Invalid Fidelity API response structure');
    }
    return data;
}

/**
 * @param {unknown} seconds
 * @returns {string}
 */
function formatStatementDate(seconds) {
    if (typeof seconds !== 'number' || !Number.isSafeInteger(seconds) || seconds <= 0) {
        throw new Error('Invalid Fidelity statement date: expected Unix seconds');
    }
    const date = new Date(seconds * 1000);
    if (Number.isNaN(date.getTime()) || date.getUTCFullYear() > 9999) {
        throw new Error('Invalid Fidelity statement date');
    }
    return date.toISOString().split('T')[0];
}

/**
 * @param {unknown} value
 * @returns {string}
 */
function creditCardDate(value) {
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
        throw new Error('Invalid Fidelity credit-card statement date');
    }
    const date = new Date(`${value}T00:00:00Z`);
    if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value) {
        throw new Error('Invalid Fidelity credit-card statement date');
    }
    return value;
}

/**
 * @param {unknown} value
 * @returns {value is string}
 */
function isFullCardId(value) {
    return typeof value === 'string' && value.trim().length > 4;
}

/**
 * @param {import('./bank.types').Account} account
 * @returns {string}
 */
function creditCardStatementsUrl(account) {
    if (!isFullCardId(account.accountId)) {
        throw new Error('Full Fidelity credit-card identifier is missing. Refresh the account list.');
    }
    return `${CREDITCARD_URL}/${encodeURIComponent(account.accountId)}/statements`;
}

/**
 * @param {unknown} content
 * @returns {Blob}
 */
function decodePdf(content) {
    if (typeof content !== 'string' || !content) {
        throw new Error('No PDF content in Fidelity statement response');
    }
    const binary = atob(content);
    if (!binary.startsWith('%PDF-')) {
        throw new Error('Fidelity statement content is not a PDF');
    }
    return new Blob([Uint8Array.from(binary, character => character.charCodeAt(0))], {
        type: 'application/pdf',
    });
}

/**
 * Gets the current session ID from cookies
 * Fidelity uses multiple session cookies (FC, MC, RC, SC, etc.) managed by the browser.
 * We return any available session cookie value as the session identifier.
 * @returns {string}
 */
export function getSessionId() {
    const cookies = document.cookie.split(';');
    const sessionCookies = ['FC', 'MC', 'RC', 'SC'];

    for (const cookie of cookies) {
        const [name, value] = cookie.trim().split('=');
        // Check for any Fidelity session cookie
        if (sessionCookies.includes(name)) {
            return value;
        }
    }

    throw new Error('Fidelity session not found. Please sign in and open the Fidelity Documents page.');
}

/**
 * Retrieves the user profile information
 * Uses the primary retail email without requesting phones or addresses.
 * @param {string} sessionId - The session ID
 * @returns {Promise<import('./bank.types').Profile>}
 */
export async function getProfile(sessionId) {
    try {
        const data = await postJson(CONTACTS_URL, {
            workplaceSrcs: ['PARTICIPANT'],
            contactTypes: ['EMAIL'],
            addrDetails: ['CUSTOMER'],
        }, CONTACT_HEADERS);
        if (!Array.isArray(data.emails)) {
            throw new Error('Email list not found in profile response');
        }
        const primaryEmails = data.emails.filter(isRecord)
            .filter(email => email.type === 'PRIMARY' && email.custRel === 'RETAIL');
        if (primaryEmails.length !== 1) {
            throw new Error('Expected one primary retail email in profile response');
        }
        const emailAddr = primaryEmails[0].email;
        if (typeof emailAddr !== 'string' || !emailAddr.includes('@')) {
            throw new Error('Invalid primary retail email in profile response');
        }

        return {
            sessionId,
            profileId: emailAddr,
            profileName: emailAddr,
        };
    } catch (error) {
        const err = /** @type {Error} */ (error);
        throw new Error(`Failed to get profile: ${err.message}`);
    }
}

/**
 * Maps Fidelity account types to standard account types
 * @param {string} acctType - Fidelity account type
 * @returns {import('./bank.types').AccountType}
 */
function mapAccountType(acctType) {
    if (acctType === 'Fidelity Credit Card') {
        return 'CreditCard';
    }
    if (acctType === 'Brokerage' || acctType === 'SPS') {
        return 'Investment';
    }
    // Default to Investment for all other Fidelity account types
    return 'Investment';
}

/**
 * Retrieves all accounts for the logged-in user
 * @param {import('./bank.types').Profile} profile - The user profile
 * @returns {Promise<import('./bank.types').Account[]>}
 */
export async function getAccounts(profile) {
    try {
        const data = await postJson(ACCOUNTS_URL, {
            acctCategory: 'Brokerage,StockPlans,Annuity,Charitable,FidelityCreditCards,InternalDigital,BrokerageLending,RegisteredStock,WorkplaceBenefits,WorkplaceContributions',
            filters: {
                returnCustomerAttrDetail: true,
                returnPreferenceDetail: true,
                returnAcctRelAttrDetail: true,
                returnAcctIndDetail: true,
                returnOrderedAccounts: true,
                returnAcctStateDetail: true,
            },
        });
        const assets = data.acctDetails;
        if (!Array.isArray(assets)) {
            throw new Error('Account list not found in Fidelity response');
        }

        const accounts = [];
        /** @type {Record<string, unknown>[] | undefined} */
        let contextAssets;

        for (const asset of assets) {
            if (!isRecord(asset)) {
                throw new Error('Invalid account entry in Fidelity response');
            }
            const preference = isRecord(asset.preferenceDetail) ? asset.preferenceDetail : undefined;
            // Skip hidden accounts
            if (preference?.isHidden === true) {
                continue;
            }

            const acctNum = typeof asset.acctNum === 'string' ? asset.acctNum : '';
            const acctType = typeof asset.acctType === 'string' ? asset.acctType : '';

            // For credit cards, we need to store the full account number for statement retrieval
            const cardDetail = isRecord(asset.creditCardDetail) ? asset.creditCardDetail : undefined;
            let accountId = typeof cardDetail?.creditCardAcctNumber === 'string' && cardDetail.creditCardAcctNumber
                ? cardDetail.creditCardAcctNumber : acctNum;

            if (acctType === 'Fidelity Credit Card' && !isFullCardId(cardDetail?.creditCardAcctNumber)) {
                if (!acctNum) {
                    throw new Error('Credit-card account mask missing from Fidelity response');
                }
                if (!contextAssets) {
                    const data = await postJson(CONTEXT_URL, {}, {
                        'Accept': 'application/json',
                        'Content-Type': 'application/json',
                    });
                    const context = isRecord(data.getContext) ? data.getContext : undefined;
                    const person = isRecord(context?.person) ? context.person : undefined;
                    if (!Array.isArray(person?.assets) || !person.assets.every(isRecord)) {
                        throw new Error('Account assets missing or malformed in Fidelity Portfolio context');
                    }
                    contextAssets = person.assets;
                }
                const matches = contextAssets.filter(asset =>
                    asset.acctType === 'Fidelity Credit Card' && asset.acctNum === acctNum);
                if (matches.length !== 1) {
                    throw new Error('Expected one matching credit card in Fidelity Portfolio context');
                }
                const detail = isRecord(matches[0].creditCardDetail) ? matches[0].creditCardDetail : undefined;
                if (!isFullCardId(detail?.creditCardAcctNumber)) {
                    throw new Error('Full credit-card identifier missing from Fidelity Portfolio context');
                }
                accountId = detail.creditCardAcctNumber;
            }

            if (!accountId) {
                continue; // Skip accounts without an ID
            }

            accounts.push({
                profile,
                accountId,
                accountName: typeof preference?.name === 'string' && preference.name
                    ? preference.name
                    : typeof asset.acctSubTypeDesc === 'string' && asset.acctSubTypeDesc
                        ? asset.acctSubTypeDesc : `Account ${acctNum}`,
                accountMask: (acctNum || accountId).slice(-4),
                accountType: mapAccountType(acctType),
            });
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
        const isCreditCard = account.accountType === 'CreditCard';

        if (isCreditCard) {
            return await getCreditCardStatements(account);
        } else {
            return await getBrokerageStatements(account);
        }
    } catch (error) {
        const err = /** @type {Error} */ (error);
        throw new Error(`Failed to get statements: ${err.message}`);
    }
}

/**
 * Retrieves statements for brokerage/investment accounts
 * @param {import('./bank.types').Account} account - The account
 * @returns {Promise<import('./bank.types').Statement[]>}
 */
async function getBrokerageStatements(account) {
    const endDate = new Date();
    const startDate = new Date();
    startDate.setMonth(startDate.getMonth() - 6); // Get last 6 months

    const data = await postJson(STATEMENTS_URL, {
        startDate: startDate.toISOString().split('T')[0],
        endDate: endDate.toISOString().split('T')[0],
        docType: 'STMT',
        hasCryptoAccount: false,
        annuityAccountLookup: true,
    });
    const statement = isRecord(data.statement) ? data.statement : undefined;
    const details = isRecord(statement?.docDetails) ? statement.docDetails : undefined;
    if (!Array.isArray(details?.docDetail)) {
        throw new Error('Statement list not found in Fidelity response');
    }

    const statements = [];

    for (const doc of details.docDetail) {
        if (!isRecord(doc)) {
            throw new Error('Invalid statement entry in Fidelity response');
        }
        const formats = isRecord(doc.formatTypes) ? doc.formatTypes : undefined;
        if (!isRecord(formats?.formatType)) {
            throw new Error('Statement format metadata not found in Fidelity response');
        }
        if (formats.formatType.isPDF !== true) {
            continue;
        }
        if (doc.acctNum !== undefined && doc.acctNum !== null && typeof doc.acctNum !== 'string') {
            throw new Error('Invalid account identifier in Fidelity statement response');
        }
        if (typeof doc.acctNum === 'string' && doc.acctNum) {
            if (doc.acctNum !== account.accountId) continue;
        } else if (doc.isHouseholded !== true) {
            throw new Error('Account identifier missing from a non-consolidated statement');
        }
        if (typeof doc.id !== 'string' || !doc.id) {
            throw new Error('Statement identifier missing from Fidelity response');
        }

        statements.push({
            account,
            statementId: doc.id,
            statementDate: formatStatementDate(doc.periodEndDate ?? doc.generatedDate),
        });
    }

    return statements;
}

/**
 * Retrieves statements for credit card accounts
 * @param {import('./bank.types').Account} account - The credit card account
 * @returns {Promise<import('./bank.types').Statement[]>}
 */
async function getCreditCardStatements(account) {
    const url = new URL(creditCardStatementsUrl(account));
    const endDate = new Date();
    const startDate = new Date();
    startDate.setMonth(startDate.getMonth() - 6); // Get last 6 months

    url.searchParams.set('startDate', startDate.toISOString().split('T')[0]);
    url.searchParams.set('endDate', endDate.toISOString().split('T')[0]);
    const data = await fetchJson(url.href, {
        method: 'GET',
        headers: CREDITCARD_HEADERS,
    });

    const statementList = data.statements;
    if (!Array.isArray(statementList)) {
        throw new Error('Credit-card statement list missing from Fidelity response');
    }

    const statements = [];

    for (const stmt of statementList) {
        if (!isRecord(stmt)) {
            throw new Error('Invalid credit-card statement entry in Fidelity response');
        }
        const date = creditCardDate(stmt.statementDate);
        statements.push({
            account,
            statementId: date,
            statementDate: date,
        });
    }

    return statements;
}

/**
 * Downloads a statement PDF
 * @param {import('./bank.types').Statement} statement - The statement to download
 * @returns {Promise<Blob>}
 */
export async function downloadStatement(statement) {
    try {
        const isCreditCard = statement.account.accountType === 'CreditCard';

        if (isCreditCard) {
            const date = creditCardDate(statement.statementId);
            if (date !== statement.statementDate) {
                throw new Error('Credit-card statement identifier does not match its date');
            }
            const url = `${creditCardStatementsUrl(statement.account)}/${encodeURIComponent(date)}`;
            const data = await fetchJson(url, { method: 'GET', headers: CREDITCARD_HEADERS });
            if (!isRecord(data.statement) || data.statement.statementDate !== date) {
                throw new Error('Fidelity credit-card response does not match the requested statement date');
            }
            return decodePdf(data.statement.pageContent);
        } else {
            const data = await postJson(DOWNLOAD_URL, {
                id: statement.statementId,
                formatType: 'PDF',
                docType: 'STMT',
                acctType: 'Brokerage',
            }, { ...DOCUMENT_HEADERS, 'fid-originating-app-version': '1.0' });
            const document = isRecord(data.document) ? data.document : undefined;
            const detail = isRecord(document?.docDetail) ? document.docDetail : undefined;
            if (typeof detail?.content !== 'string' || !detail.content) {
                throw new Error('No PDF content in Fidelity statement response');
            }
            if (typeof detail.encoding !== 'string' || detail.encoding.toLowerCase() !== 'base64') {
                throw new Error('Unsupported Fidelity statement encoding');
            }
            if (typeof detail.contentType !== 'string' ||
                detail.contentType.split(';')[0].trim().toLowerCase() !== 'application/pdf') {
                throw new Error('Fidelity statement response is not a PDF');
            }

            // The observed response says deflated=Y but decodes directly to PDF bytes.
            return decodePdf(detail.content);
        }
    } catch (error) {
        const err = /** @type {Error} */ (error);
        throw new Error(`Failed to download statement: ${err.message}`);
    }
}
