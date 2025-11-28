/**
 * Fidelity Investments API implementation for retrieving bank statements
 * @see analyze/fidelity.md
 */

/** @type {string} */
export const bankId = 'fidelity';

/** @type {string} */
export const bankName = 'Fidelity';

const BASE_URL = 'https://digital.fidelity.com';
const PORTFOLIO_GRAPHQL_URL = `${BASE_URL}/ftgw/digital/portfolio/api/graphql`;
const DOCUMENTS_GRAPHQL_URL = `${BASE_URL}/ftgw/digital/documents/api/graphql`;
const CREDITCARD_GRAPHQL_URL = `${BASE_URL}/ftgw/digital/credit-card/api/graphql`;
const PDF_BASE_URL = `${BASE_URL}/ftgw/digital/documents/PDFStatement`;

/**
 * Parses Fidelity's date format to a Date object
 * Format: MDDYYYY or MMDDYYYY (single digit months have no leading zero)
 * Examples: 9302025 = Sept 30, 2025; 10312025 = Oct 31, 2025
 * @param {number} fidelityDate - Date in MDDYYYY or MMDDYYYY format
 * @returns {Date}
 */
function parseFidelityDate(fidelityDate) {
    const dateStr = String(fidelityDate);
    // The year is always the last 4 digits
    const year = parseInt(dateStr.substring(dateStr.length - 4), 10);
    // The rest is MMDD or MDD
    const monthDay = dateStr.substring(0, dateStr.length - 4);

    let month, day;
    if (monthDay.length === 4) {
        // MMDD format (2-digit month)
        month = parseInt(monthDay.substring(0, 2), 10);
        day = parseInt(monthDay.substring(2, 4), 10);
    } else if (monthDay.length === 3) {
        // MDD format (1-digit month)
        month = parseInt(monthDay.substring(0, 1), 10);
        day = parseInt(monthDay.substring(1, 3), 10);
    } else {
        throw new Error(`Invalid Fidelity date format: ${fidelityDate}`);
    }

    return new Date(year, month - 1, day);
}

/**
 * Formats a Date object to YYYY-MM-DD string
 * @param {Date} date - The date to format
 * @returns {string}
 */
function formatDateToISO(date) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
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

    throw new Error('Fidelity session not found. Please ensure you are logged in to digital.fidelity.com.');
}

/**
 * Retrieves the user profile information
 * Uses email address as the profile identifier since Fidelity doesn't provide a dedicated user name API
 * @param {string} sessionId - The session ID
 * @returns {Promise<import('./bank.types').Profile>}
 */
export async function getProfile(sessionId) {
    try {
        const query = `query GetDeliveryPref {
  deliveryPrefData {
    deliveryPrefInquiry {
      deliveryPref {
        custInformation {
          emailAddr
          __typename
        }
        __typename
      }
      __typename
    }
    __typename
  }
}`;

        const response = await fetch(DOCUMENTS_GRAPHQL_URL, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Accept': 'application/json',
            },
            credentials: 'include',
            body: JSON.stringify({
                operationName: 'GetDeliveryPref',
                query: query,
            }),
        });

        if (!response.ok) {
            throw new Error(`GetDeliveryPref API request failed: ${response.status} ${response.statusText}`);
        }

        const data = /** @type {any} */ (await response.json());

        const emailAddr = data?.data?.deliveryPrefData?.deliveryPrefInquiry?.deliveryPref?.custInformation?.emailAddr;

        if (!emailAddr) {
            throw new Error('Email address not found in profile response');
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
        const query = `query GetContext {
  getContext {
    person {
      assets {
        acctNum
        acctType
        acctSubType
        acctSubTypeDesc
        preferenceDetail {
          name
          isHidden
          acctGroupId
        }
        creditCardDetail {
          creditCardAcctNumber
        }
      }
    }
  }
}`;

        const response = await fetch(PORTFOLIO_GRAPHQL_URL, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Accept': 'application/json',
                'Referer': `${BASE_URL}/ftgw/digital/portfolio/summary`,
            },
            credentials: 'include',
            body: JSON.stringify({
                operationName: 'GetContext',
                query: query,
            }),
        });

        if (!response.ok) {
            throw new Error(`GetContext API request failed: ${response.status} ${response.statusText}`);
        }

        const data = /** @type {any} */ (await response.json());

        const assets = data?.data?.getContext?.person?.assets;

        if (!Array.isArray(assets)) {
            throw new Error('No accounts found in GetContext response');
        }

        const accounts = [];

        for (const asset of assets) {
            // Skip hidden accounts
            if (asset.preferenceDetail?.isHidden) {
                continue;
            }

            const acctNum = asset.acctNum;
            const acctType = asset.acctType;

            // For credit cards, we need to store the full account number for statement retrieval
            const accountId = asset.creditCardDetail?.creditCardAcctNumber || acctNum;

            if (!accountId) {
                continue; // Skip accounts without an ID
            }

            accounts.push({
                profile,
                accountId: String(accountId),
                accountName: asset.preferenceDetail?.name || asset.acctSubTypeDesc || `Account ${acctNum}`,
                accountMask: acctNum ? String(acctNum).slice(-4) : accountId.slice(-4),
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

    const query = `query GetStatements($docType: String, $startDate: String, $endDate: String) {
  getStatement(docType: $docType, startDate: $startDate, endDate: $endDate) {
    statement {
      docDetails {
        docDetail {
          id
          type
          acctNum
          periodStartDate
          periodEndDate
          generatedDate
          isHouseholded
          formatTypes {
            formatType {
              isPDF
            }
          }
        }
      }
    }
  }
}`;

    const response = await fetch(DOCUMENTS_GRAPHQL_URL, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Accept': 'application/json',
            'Referer': `${BASE_URL}/ftgw/digital/documents`,
        },
        credentials: 'include',
        body: JSON.stringify({
            operationName: 'GetStatements',
            variables: {
                docType: 'STMT',
                startDate: startDate.toISOString().split('T')[0],
                endDate: endDate.toISOString().split('T')[0],
            },
            query: query,
        }),
    });

    if (!response.ok) {
        throw new Error(`GetStatements API request failed: ${response.status} ${response.statusText}`);
    }

    const data = /** @type {any} */ (await response.json());

    const docDetails = data?.data?.getStatement?.statement?.docDetails?.docDetail;

    if (!Array.isArray(docDetails)) {
        return []; // No statements found
    }

    const statements = [];

    for (const doc of docDetails) {
        // Filter to only this account's statements
        // Match by account mask (last 4 digits)
        if (doc.acctNum && account.accountMask && !doc.acctNum.endsWith(account.accountMask)) {
            continue;
        }

        // Check if PDF is available
        // Note: formatType is an object, not an array
        const hasPDF = doc.formatTypes?.formatType?.isPDF === true;
        if (!hasPDF) {
            continue;
        }

        // Parse the date from MMDDYYYY format to ISO string
        const endDate = parseFidelityDate(doc.periodEndDate || doc.generatedDate);
        const dateStr = formatDateToISO(endDate);

        statements.push({
            account,
            statementId: doc.id,
            statementDate: dateStr,
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
    const endDate = new Date();
    const startDate = new Date();
    startDate.setMonth(startDate.getMonth() - 6); // Get last 6 months

    const query = `query GetStatementsList($accountId: String!, $dateRange: DateRange, $year: String) {
  getStatementsList(accountId: $accountId, dateRange: $dateRange, year: $year) {
    statements {
      statementName
      statementStartDate
      statementEndDate
    }
  }
}`;

    const response = await fetch(CREDITCARD_GRAPHQL_URL, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Accept': 'application/json',
            'apollographql-client-name': 'credit-card',
            'apollographql-client-version': '0.0.1',
            'Referer': `${BASE_URL}/ftgw/digital/portfolio/creditstatements`,
        },
        credentials: 'include',
        body: JSON.stringify({
            operationName: 'GetStatementsList',
            variables: {
                accountId: account.accountId,
                dateRange: {
                    startDate: startDate.toISOString().split('T')[0],
                    endDate: endDate.toISOString().split('T')[0],
                },
            },
            query: query,
        }),
    });

    if (!response.ok) {
        throw new Error(`GetStatementsList API request failed: ${response.status} ${response.statusText}`);
    }

    const data = /** @type {any} */ (await response.json());

    const statementList = data?.data?.getStatementsList?.statements;

    if (!Array.isArray(statementList)) {
        return []; // No statements found
    }

    const statements = [];

    for (const stmt of statementList) {
        statements.push({
            account,
            statementId: stmt.statementEndDate,
            statementDate: stmt.statementEndDate,
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
            // Credit card statements use GraphQL API with Base64-encoded PDF
            const query = `query GetStatement($accountId: String!, $statementDate: String!) {
  getStatement(accountId: $accountId, statementDate: $statementDate) {
    statement {
      statementDate
      pageContent
      __typename
    }
    __typename
  }
}`;

            const response = await fetch(CREDITCARD_GRAPHQL_URL, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Accept': 'application/json',
                    'apollographql-client-name': 'credit-card',
                    'apollographql-client-version': '0.0.1',
                    'Referer': `${BASE_URL}/ftgw/digital/portfolio/creditstatements`,
                },
                credentials: 'include',
                body: JSON.stringify({
                    operationName: 'GetStatement',
                    variables: {
                        accountId: statement.account.accountId,
                        statementDate: statement.statementDate, // Already in YYYY-MM-DD format
                    },
                    query,
                }),
            });

            if (!response.ok) {
                throw new Error(`Credit card PDF download failed: ${response.status} ${response.statusText}`);
            }

            const data = /** @type {any} */ (await response.json());
            const pageContent = data?.data?.getStatement?.statement?.pageContent;

            if (!pageContent) {
                throw new Error('No PDF content in credit card statement response');
            }

            // Decode Base64 to binary
            const binaryString = atob(pageContent);
            const bytes = new Uint8Array(binaryString.length);
            for (let i = 0; i < binaryString.length; i++) {
                bytes[i] = binaryString.charCodeAt(i);
            }

            return new Blob([bytes], { type: 'application/pdf' });
        } else {
            // Brokerage statements use direct PDF download URL
            // Parse date string directly to avoid timezone issues (YYYY-MM-DD format)
            const [year, month, day] = statement.statementDate.split('-');
            const filename = `Statement${month}${day}${year}.pdf`;

            const url = `${PDF_BASE_URL}/STMT/pdf/${filename}?id=${encodeURIComponent(statement.statementId)}`;

            const response = await fetch(url, {
                method: 'GET',
                headers: {
                    'Accept': 'application/pdf',
                    'Referer': `${BASE_URL}/ftgw/digital/documents`,
                },
                credentials: 'include',
            });

            if (!response.ok) {
                throw new Error(`PDF download failed: ${response.status} ${response.statusText}`);
            }

            return await response.blob();
        }
    } catch (error) {
        const err = /** @type {Error} */ (error);
        throw new Error(`Failed to download statement: ${err.message}`);
    }
}
