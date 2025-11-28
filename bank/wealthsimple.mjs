/**
 * Wealthsimple API implementation for retrieving bank statements
 * @see analyze/wealthsimple.md
 * 
 * @typedef {import('../extension/extension.type').RequestFetchMessage} RequestFetchMessage
 * @typedef {import('../extension/extension.type').RequestFetchResponse} RequestFetchResponse
 */

/** @type {string} */
export const bankId = 'wealthsimple';

/** @type {string} */
export const bankName = 'Wealthsimple';

const BASE_URL = 'https://my.wealthsimple.com';
const GRAPHQL_ENDPOINT = `${BASE_URL}/graphql`;

/**
 * Extract headers needed for GraphQL requests
 * @returns {{authorization: string, deviceId: string, locale: string, profile: string, sessionId: string}}
 */
function extractHeaders() {
    let authorization = '';
    let deviceId = '';
    let locale = 'en-CA';
    let profile = 'invest';
    let sessionId = '';

    // Extract from cookies
    try {
        const cookies = document.cookie.split('; ').reduce((acc, cookie) => {
            const [key, value] = cookie.split('=');
            acc[key] = decodeURIComponent(value);
            return acc;
        }, /** @type {Record<string, string>} */({}));

        // Extract OAuth token from _oauth2_access_v2 cookie
        if (cookies['_oauth2_access_v2']) {
            try {
                const oauthData = JSON.parse(cookies['_oauth2_access_v2']);
                if (oauthData.access_token) {
                    authorization = `Bearer ${oauthData.access_token}`;
                }
            } catch (e) {
                // Cookie parsing failed
            }
        }

        // Extract device ID from wssdi cookie
        if (cookies['wssdi']) {
            deviceId = cookies['wssdi'];
        }

        // Extract global visitor ID for session ID
        if (cookies['ws_global_visitor_id']) {
            sessionId = cookies['ws_global_visitor_id'];
        }

        // Extract jurisdiction for locale
        if (cookies['ws_jurisdiction']) {
            const jurisdiction = cookies['ws_jurisdiction'];
            locale = jurisdiction === 'CA' ? 'en-CA' : 'en-US';
        }
    } catch (e) {
        // Cookie parsing failed
    }

    return { authorization, deviceId, locale, profile, sessionId };
}

/**
 * Makes an authenticated GraphQL request
 * @param {string} operationName - GraphQL operation name
 * @param {string} query - GraphQL query string
 * @param {object} variables - GraphQL variables
 * @returns {Promise<any>}
 */
async function makeGraphQLRequest(operationName, query, variables, includeSessionId = false) {
    const headers = extractHeaders();

    /** @type {Record<string, string>} */
    const requestHeaders = {
        'accept': '*/*',
        'content-type': 'application/json',
        'authorization': headers.authorization,
        'x-ws-api-version': '12',
        'x-ws-device-id': headers.deviceId,
        'x-ws-locale': headers.locale,
        'x-ws-profile': headers.profile,
        'x-platform-os': 'web',
    };

    // Some operations require x-ws-session-id, others don't
    if (includeSessionId && headers.sessionId) {
        requestHeaders['x-ws-session-id'] = headers.sessionId;
    }

    const response = await fetch(GRAPHQL_ENDPOINT, {
        method: 'POST',
        headers: requestHeaders,
        credentials: 'include',
        body: JSON.stringify({
            operationName,
            variables,
            query,
        }),
    });

    if (!response.ok) {
        throw new Error(`Wealthsimple GraphQL request failed: ${response.status} ${response.statusText} for ${operationName}`);
    }

    const data = await response.json();

    if (data.errors && data.errors.length > 0) {
        throw new Error(`GraphQL errors: ${data.errors.map((/** @type {any} */ e) => e.message).join(', ')}`);
    }

    return data.data;
}

/**
 * Get the current session ID (JWT token from Authorization header)
 * @returns {string}
 */
export function getSessionId() {
    const headers = extractHeaders();

    if (!headers.authorization) {
        throw new Error('No authorization token found. Please ensure you are logged in to Wealthsimple.');
    }

    // Return the full Bearer token
    return headers.authorization;
}

/**
 * Get the current profile information
 * @param {string} sessionId - The session ID (JWT token)
 * @returns {Promise<import('./bank.types').Profile>}
 */
export async function getProfile(sessionId) {
    // Extract identity ID from the cookie (easier than JWT parsing)
    let identityId = '';

    try {
        const cookies = document.cookie.split('; ').reduce((acc, cookie) => {
            const [key, value] = cookie.split('=');
            acc[key] = decodeURIComponent(value);
            return acc;
        }, /** @type {Record<string, string>} */({}));

        if (cookies['_oauth2_access_v2']) {
            const oauthData = JSON.parse(cookies['_oauth2_access_v2']);
            identityId = oauthData.identity_canonical_id || '';
        }
    } catch (e) {
        // If cookie parsing fails, try JWT
        try {
            const parts = sessionId.replace('Bearer ', '').split('.');
            if (parts.length >= 2) {
                const payload = JSON.parse(atob(parts[1]));
                identityId = payload.sub || '';
            }
        } catch (jwtError) {
            throw new Error('Failed to extract identity ID from cookie or JWT token');
        }
    }

    if (!identityId) {
        throw new Error('Could not extract identity ID');
    }

    // Use a simpler query - Wealthsimple's identity doesn't have firstName/lastName at root level
    // Instead, get it from the users array or just use email
    const query = `query FetchIdentity($id: ID!) {
  identity(id: $id) {
    id
    email
    createdAt
    users {
      id
      profile
      __typename
    }
    __typename
  }
}`;

    const data = await makeGraphQLRequest('FetchIdentity', query, { id: identityId }, false);

    if (!data.identity) {
        throw new Error('Failed to retrieve identity information');
    }

    const identity = data.identity;

    // Wealthsimple doesn't have firstName/lastName at identity level
    // Use email as the profile name
    return {
        sessionId,
        profileId: identity.id,
        profileName: identity.email,
    };
}

/**
 * Map Wealthsimple account types to standardized account types
 * @param {string} accountType - Wealthsimple account type
 * @param {string} unifiedType - Wealthsimple unified account type
 * @returns {import('./bank.types').AccountType}
 */
function mapAccountType(accountType, unifiedType) {
    // Cash accounts (chequing/savings)
    if (accountType === 'ca_cash_msb' || unifiedType === 'CASH' || unifiedType === 'CASH_USD') {
        return 'Checking'; // Wealthsimple's cash account is essentially a chequing account
    }

    // Investment accounts
    if (accountType === 'tfsa' || accountType === 'rrsp' || accountType === 'non_registered' ||
        accountType === 'lira' || accountType === 'rrif' || accountType === 'resp' ||
        unifiedType.includes('TFSA') || unifiedType.includes('RRSP') || unifiedType.includes('REGISTERED')) {
        return 'Investment';
    }

    // Default to investment for other types
    return 'Investment';
}

/**
 * Get friendly account name from Wealthsimple account type
 * @param {string} unifiedType - Wealthsimple unified account type
 * @param {string} accountType - Wealthsimple account type
 * @param {string} nickname - User-assigned nickname
 * @returns {string}
 */
function getAccountName(unifiedType, accountType, nickname) {
    if (nickname) {
        return nickname;
    }

    // Map unified types to friendly names
    /** @type {Record<string, string>} */
    const typeMap = {
        'CASH': 'Chequing',
        'CASH_USD': 'USD Chequing',
        'SELF_DIRECTED_TFSA': 'TFSA',
        'SELF_DIRECTED_RRSP': 'RRSP',
        'SELF_DIRECTED_NON_REGISTERED': 'Non-registered',
        'SELF_DIRECTED_LIRA': 'LIRA',
        'SELF_DIRECTED_RRIF': 'RRIF',
        'SELF_DIRECTED_RESP': 'RESP',
    };

    return typeMap[unifiedType] || accountType.toUpperCase();
}

/**
 * Get all accounts for the user
 * @param {import('./bank.types').Profile} profile - The user profile
 * @returns {Promise<import('./bank.types').Account[]>}
 */
export async function getAccounts(profile) {
    // Simplified query without filter - just get basic account info
    const query = `query FetchAllAccounts($identityId: ID!, $pageSize: Int) {
  identity(id: $identityId) {
    accounts(first: $pageSize) {
      edges {
        node {
          id
          type
          status
          currency
          nickname
          unifiedAccountType
          branch
          createdAt
          closedAt
          archivedAt
          accountOwnerConfiguration
          __typename
        }
        __typename
      }
      pageInfo {
        hasNextPage
        endCursor
        __typename
      }
      __typename
    }
    __typename
  }
}`;

    const data = await makeGraphQLRequest('FetchAllAccounts', query, {
        identityId: profile.profileId,
        pageSize: 50,
    });

    if (!data.identity || !data.identity.accounts || !data.identity.accounts.edges) {
        throw new Error('Failed to retrieve accounts information');
    }

    const accounts = [];

    for (const edge of data.identity.accounts.edges) {
        const node = edge.node;

        // Skip closed or archived accounts
        if (node.status !== 'open') {
            continue;
        }

        accounts.push({
            profile,
            accountId: node.id,
            accountName: getAccountName(node.unifiedAccountType, node.type, node.nickname),
            accountMask: node.id.split('-').pop() || '****',
            accountType: mapAccountType(node.type, node.unifiedAccountType),
        });
    }

    return accounts;
}

/**
 * Format statement date from period string
 * @param {string} period - Period in format YYYY-MM-DD
 * @returns {string} - ISO 8601 date string
 */
function formatStatementDate(period) {
    // Period is in format "2025-10-01" (first day of statement month)
    // Return as ISO 8601 string
    return new Date(period).toISOString();
}

/**
 * Get all statements for an account
 * @param {import('./bank.types').Account} account - The account
 * @returns {Promise<import('./bank.types').Statement[]>}
 */
export async function getStatements(account) {
    const query = `query FetchIdentityPaginatedDocuments($id: ID!, $limit: Int, $offset: Int, $locale: String, $categories: [String!], $accountIds: [String!], $startDate: String, $endDate: String) {
  identity(id: $id) {
    id
    documents(
      limit: $limit
      offset: $offset
      locale: $locale
      categories: $categories
      account_ids: $accountIds
      start_date: $startDate
      end_date: $endDate
    ) {
      totalCount: total_count
      offset
      results {
        id
        createdAt: created_at
        availableAt: available_at
        displayAt: display_at
        filename
        period
        frequency
        type
        downloadUrl: download_url
        uploaderName: uploader_name
        s3BucketName: s3_bucket_name
        s3Key: s3_key
        category
        account {
          id
          type
          __typename
        }
        documents {
          id
          createdAt: created_at
          downloadUrl: download_url
          s3BucketName: s3_bucket_name
          s3Key: s3_key
          type
          account {
            id
            type
            custodianAccountIds: custodian_account_ids
            __typename
          }
          __typename
        }
        __typename
      }
      __typename
    }
    __typename
  }
}`;

    const data = await makeGraphQLRequest('FetchIdentityPaginatedDocuments', query, {
        id: account.profile.profileId,
        limit: 50,
        accountIds: [account.accountId],
    });

    if (!data.identity || !data.identity.documents || !data.identity.documents.results) {
        throw new Error('Failed to retrieve statements information');
    }

    const statements = [];

    for (const doc of data.identity.documents.results) {
        // Only include monthly statements
        if (doc.frequency !== 'month') {
            continue;
        }

        // Skip if no S3 key (can't download)
        if (!doc.s3Key || !doc.s3BucketName) {
            continue;
        }

        // Store S3 bucket and key as JSON string in statementId for download
        const downloadInfo = JSON.stringify({
            id: doc.id,
            bucket: doc.s3BucketName,
            key: doc.s3Key,
        });

        statements.push({
            account,
            statementId: downloadInfo,
            statementDate: formatStatementDate(doc.period),
        });
    }

    // Sort by date descending (newest first)
    statements.sort((a, b) => b.statementDate.localeCompare(a.statementDate));

    return statements;
}

/**
 * Get signed download URL for a statement
 * @param {string} bucket - S3 bucket name
 * @param {string} key - S3 object key
 * @returns {Promise<string>}
 */
async function getSignedDownloadUrl(bucket, key) {
    const query = `
        mutation DocumentSignedUrlCreate($bucket: String!, $key: String!) {
            signDocumentUrl(bucket: $bucket, key: $key) {
                downloadUrl
                __typename
            }
        }
    `;

    const data = await makeGraphQLRequest('DocumentSignedUrlCreate', query, {
        bucket,
        key,
    });

    if (!data.signDocumentUrl || !data.signDocumentUrl.downloadUrl) {
        throw new Error('Failed to get signed download URL');
    }

    return data.signDocumentUrl.downloadUrl;
}



/**
 * Download a statement PDF
 * @param {import('./bank.types').Statement} statement - The statement to download
 * @returns {Promise<Blob>}
 */
export async function downloadStatement(statement) {
    // Extract S3 bucket and key from statementId (stored as JSON)
    const downloadInfo = JSON.parse(statement.statementId);
    const { bucket, key } = downloadInfo;

    // Get signed download URL
    const downloadUrl = await getSignedDownloadUrl(bucket, key);

    // Download the PDF from S3 using background script to bypass CORS
    /** @type {RequestFetchMessage} */
    const message = {
        action: 'requestFetch',
        url: downloadUrl,
        options: {
            method: 'GET',
        }
    };

    /** @type {RequestFetchResponse} */
    const response = await chrome.runtime.sendMessage(message);

    if ('error' in response) {
        throw new Error(`Failed to download statement PDF: ${response.error}`);
    }

    // Response contains base64-encoded PDF data in body
    const { ok, status, statusText, body } = response;

    if (!ok) {
        throw new Error(`Failed to download statement PDF: ${status} ${statusText}`);
    }

    // Verify body is present
    if (!body) {
        throw new Error('Failed to download statement PDF: Empty response body');
    }

    // Convert base64 data URL to blob
    // The background script converts PDF to data URL format: "data:application/pdf;base64,..."
    if (body.startsWith('data:')) {
        try {
            // Use fetch to convert data URL back to blob
            const dataUrlResponse = await fetch(body);
            if (!dataUrlResponse.ok) {
                throw new Error(`Data URL fetch failed: ${dataUrlResponse.status}`);
            }
            return await dataUrlResponse.blob();
        } catch (error) {
            throw new Error(`Failed to convert data URL to blob: ${error instanceof Error ? error.message : String(error)}`);
        }
    }

    // Fallback: convert string to blob (shouldn't happen for PDFs from S3)
    // Create Uint8Array from string characters
    const bytes = new Uint8Array(body.length);
    for (let i = 0; i < body.length; i++) {
        bytes[i] = body.charCodeAt(i);
    }
    return new Blob([bytes], { type: 'application/pdf' });
}
