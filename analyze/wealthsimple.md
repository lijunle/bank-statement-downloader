# Wealthsimple Network API Analysis

**Bank ID**: `wealthsimple`
**Bank Name**: Wealthsimple
**Bank URL**: https://www.wealthsimple.com / https://my.wealthsimple.com
**Analysis Date**: November 23, 2025
**HAR File**: `analyze/wealthsimple_1763899399558.har`
**Implementation**: `bank/wealthsimple.mjs`
**Validation Status**: ✅ All APIs validated and working

## Overview

Wealthsimple uses a GraphQL API architecture for all account and document operations. The API is hosted at `https://my.wealthsimple.com/graphql` and requires bearer token authentication stored in cookies. All data fetching is done through GraphQL queries with specific operation names.

## Validation Results

### Browser Testing (November 23, 2025)

All API functions have been validated in a live browser environment:

- ✅ **getSessionId()**: Successfully extracts 755-character Bearer token from cookies
- ✅ **getProfile()**: Returns profile information (email: john.doe@example.com, ID: identity-gY6Lf91dcOYYlWgU1KjhnCGhV8x)
- ✅ **getAccounts()**: Retrieved 3 accounts (Non-registered Investment, TFSA Investment, Chequing)
- ✅ **getStatements()**: Retrieved 30 statements for test account
- ✅ **downloadStatement()**: Successfully downloads PDFs via background script with S3 host permissions

### Key Findings

1. **Authentication**: Token stored in `_oauth2_access_v2` cookie as JSON, not in meta tags or localStorage
2. **GraphQL Structure**: Queries use snake_case field names (e.g., `s3_bucket_name`, `created_at`)
3. **Statement Storage**: Statement metadata includes S3 bucket and key, stored in JSON format in statementId
4. **CORS Handling**: S3 downloads require host permissions in manifest.json for `*.s3.amazonaws.com`
5. **No Session ID Header**: The `x-ws-session-id` header is optional and not required for most operations

## Authentication

### Session ID / Token

**Location**: Cookie `_oauth2_access_v2` (JSON string)
**Format**: `Bearer {JWT_TOKEN}`
**Type**: JWT (JSON Web Token) stored in cookie
**Example**: `Bearer eyJhbGciOiJSUzI1NiJ9.eyJzdWIiOiJpZGVudGl0eS1nWTZMZjkxZGNPWVlsV2dVMUtqaG5D...`

**Cookie Structure**:

```json
{
  "access_token": "eyJhbGciOiJSUzI1NiJ9...",
  "identity_canonical_id": "identity-gY6Lf91dcOYYlWgU1KjhnCGhV8x",
  "token_type": "Bearer",
  "expires_in": 3600
}
```

The JWT token is stored in the `_oauth2_access_v2` cookie as a JSON string. The `access_token` field contains the Bearer token, and `identity_canonical_id` contains the user's identity ID.

### Required HTTP Headers

All GraphQL requests require the following headers:

- **Authorization**: `Bearer {JWT_TOKEN}` - Extracted from `_oauth2_access_v2` cookie
- **x-ws-api-version**: `12` - API version identifier (required)
- **x-ws-device-id**: Unique device identifier from `wssdi` cookie (required)
- **x-ws-locale**: User locale from `ws_jurisdiction` cookie (e.g., `en-CA` or `en-US`)
- **x-ws-profile**: Profile type, typically `invest` (required)
- **x-platform-os**: Platform identifier, use `web` (required)
- **Content-Type**: `application/json` (required)
- **Accept**: `*/*`

### Optional Headers

- **x-ws-session-id**: Global visitor ID from `ws_global_visitor_id` cookie (optional, not required for most operations)

### Additional Cookies

- **wssdi**: Device identifier (required for x-ws-device-id header)
- **ws_global_visitor_id**: Session tracking ID (optional)
- **ws_jurisdiction**: User's jurisdiction (`CA` or `US`) for locale determination

## Retrieve User Profile Information

**API Endpoint**: `https://my.wealthsimple.com/graphql`
**HTTP Method**: POST
**GraphQL Operation**: `FetchIdentity`

### Request

**Headers**:

```
Authorization: Bearer {JWT_TOKEN}
Content-Type: application/json
x-ws-api-version: 12
x-ws-device-id: {DEVICE_ID}
x-ws-locale: en-CA
x-ws-profile: invest
x-ws-session-id: {SESSION_ID}
```

**Request Body** (Validated Implementation):

```json
{
  "operationName": "FetchIdentity",
  "variables": {},
  "query": "query FetchIdentity { identity { id email createdAt } }"
}
```

**Note**: The validated implementation does NOT use the `$id` parameter. The API automatically uses the identity from the authentication token. Requesting fields like `firstName` and `lastName` causes UNPROCESSABLE_ENTITY errors as they are not at the root level of the `identity` object.

### Response

**Response Structure**:

```json
{
  "data": {
    "identity": {
      "id": "identity-gY6Lf91dcOYYlWgU1KjhnCGhV8x",
      "email": "john.doe@example.com",
      "createdAt": "2022-04-27T20:48:29.825Z"
    }
  }
}
```

**Key Fields**:

- `identity.id`: Unique identity ID (starts with `identity-`) - use as `profileId`
- `identity.email`: User's email address - use as `profileName`
- `identity.createdAt`: Account creation timestamp

**Parameter Sources**:

- No parameters required. The identity is inferred from the `Authorization` Bearer token in the request headers.

## List All Accounts

**API Endpoint**: `https://my.wealthsimple.com/graphql`
**HTTP Method**: POST
**GraphQL Operation**: `FetchAllAccounts`

### Request

**Headers**: Same as user profile request

**Request Body** (Validated Implementation):

```json
{
  "operationName": "FetchAllAccounts",
  "variables": {
    "pageSize": 25
  },
  "query": "query FetchAllAccounts($pageSize: Int) { identity { accounts(first: $pageSize) { edges { node { id type status currency nickname unifiedAccountType branch createdAt closedAt archivedAt accountOwnerConfiguration } } pageInfo { hasNextPage endCursor } } } }"
}
```

**Note**: The validated implementation does NOT use the `filter` parameter or `identityId` parameter. The `filter: {}` causes UNPROCESSABLE_ENTITY errors. The API automatically uses the identity from the authentication token.

### Response

**Response Structure**:

```json
{
  "data": {
    "identity": {
      "accounts": {
        "edges": [
          {
            "cursor": "MQ",
            "node": {
              "id": "non-registered-9DcGqjyfLx",
              "type": "non_registered",
              "status": "open",
              "currency": "CAD",
              "nickname": "",
              "unifiedAccountType": "SELF_DIRECTED_NON_REGISTERED",
              "branch": "TR",
              "createdAt": "2023-06-09T07:26:37",
              "closedAt": null,
              "archivedAt": null,
              "accountOwnerConfiguration": "INDIVIDUAL",
              "__typename": "Account"
            }
          },
          {
            "cursor": "Mg",
            "node": {
              "id": "tfsa-9iFT3QnQqB",
              "type": "tfsa",
              "status": "open",
              "currency": "CAD",
              "nickname": "",
              "unifiedAccountType": "SELF_DIRECTED_TFSA",
              "branch": "TR",
              "createdAt": "2024-03-12T17:27:30",
              "__typename": "Account"
            }
          },
          {
            "cursor": "NA",
            "node": {
              "id": "ca-cash-msb-guyN5Pf1-x",
              "type": "ca_cash_msb",
              "status": "open",
              "currency": "CAD",
              "nickname": "",
              "unifiedAccountType": "CASH",
              "branch": "WS",
              "accountOwnerConfiguration": "MULTI_OWNER",
              "__typename": "Account"
            }
          }
        ],
        "pageInfo": {
          "hasNextPage": false,
          "endCursor": "NQ"
        }
      }
    }
  }
}
```

**Key Fields**:

- `accounts.edges[].node.id`: Unique account ID (e.g., `tfsa-9iFT3QnQqB`, `ca-cash-msb-guyN5Pf1-x`)
- `accounts.edges[].node.type`: Account type identifier (e.g., `tfsa`, `non_registered`, `ca_cash_msb`)
- `accounts.edges[].node.unifiedAccountType`: Human-readable account type (e.g., `SELF_DIRECTED_TFSA`, `CASH`)
- `accounts.edges[].node.status`: Account status (`open`, `closed`)
- `accounts.edges[].node.branch`: Branch code (`TR` for trading, `WS` for cash accounts)
- `accounts.edges[].node.nickname`: User-assigned nickname (if any)
- `accounts.edges[].node.accountOwnerConfiguration`: Ownership type (`INDIVIDUAL`, `MULTI_OWNER`)

**Account Types**:

- `ca_cash_msb`: Chequing account (Cash account)
- `tfsa`: Tax-Free Savings Account
- `non_registered`: Non-registered investment account
- `rrsp`: Registered Retirement Savings Plan (if applicable)

**Parameter Sources**:

- `identityId`: From user profile API or JWT token
- `filter`: Optional filter object (can be empty `{}` for all accounts)
- `pageSize`: Number of accounts to fetch (default: 25)

## List Available Statements

**API Endpoint**: `https://my.wealthsimple.com/graphql`
**HTTP Method**: POST
**GraphQL Operation**: `FetchIdentityPaginatedDocuments`

### Request

**Headers**: Same as previous requests

**Request Body** (Validated Implementation):

```json
{
  "operationName": "FetchIdentityPaginatedDocuments",
  "variables": {
    "limit": 50,
    "accountIds": ["non-registered-9DcGqjyfLx"]
  },
  "query": "query FetchIdentityPaginatedDocuments($limit: Int, $accountIds: [ID!], $categories: [DocumentCategory!], $types: [DocumentType!]) { identity { documents(limit: $limit, accountIds: $accountIds, categories: $categories, types: $types) { offset totalCount results { id type category period frequency created_at: createdAt available_at: availableAt display_at: displayAt filename s3_bucket_name: s3BucketName s3_key: s3Key download_url: downloadUrl account { id type } documents { id type created_at: createdAt download_url: downloadUrl s3_bucket_name: s3BucketName s3_key: s3Key } } } } }"
}
```

**Important Notes**:

1. **NO identity ID parameter**: The API automatically uses the identity from the authentication token
2. **Snake_case field names**: All response fields must use snake_case aliases (e.g., `created_at: createdAt`, `s3_bucket_name: s3BucketName`) to avoid UNPROCESSABLE_ENTITY errors
3. **Required filters**: `accountIds` is typically provided to filter statements for a specific account
4. **Optional filters**: `categories`, `types` can be used to filter by document category/type

### Response

**Response Structure**:

```json
{
  "data": {
    "identity": {
      "documents": {
        "offset": 0,
        "totalCount": 111,
        "results": [
          {
            "id": "pdf-statement-119Y5yi4UYwc",
            "type": "brokerage",
            "category": "performance",
            "period": "2025-10-01",
            "frequency": "month",
            "createdAt": "2025-11-09T11:00:49.986Z",
            "availableAt": "2025-11-09T11:00:49.986Z",
            "displayAt": null,
            "filename": null,
            "s3BucketName": "so-docs-index-service-prod",
            "s3Key": "pdf-statement-119Y5yi4UYwc",
            "downloadUrl": null,
            "account": {
              "id": "tfsa-9iFT3QnQqB",
              "type": "tfsa"
            },
            "documents": null,
            "__typename": "Document"
          },
          {
            "id": "pdf-statement-119Y5rMiPn1G",
            "type": "brokerage",
            "category": "performance",
            "period": "2025-10-01",
            "frequency": "month",
            "createdAt": "2025-11-09T09:14:44.528Z",
            "availableAt": "2025-11-09T09:14:44.528Z",
            "s3BucketName": "so-docs-index-service-prod",
            "s3Key": "pdf-statement-119Y5rMiPn1G",
            "account": {
              "id": "non-registered-9DcGqjyfLx",
              "type": "non_registered"
            },
            "__typename": "Document"
          },
          {
            "id": "pdf-statement-119Y5Y6fF5uE",
            "type": "cash",
            "category": "performance",
            "period": "2025-10-01",
            "frequency": "month",
            "createdAt": "2025-11-09T04:36:32.794Z",
            "availableAt": "2025-11-09T04:36:32.794Z",
            "s3BucketName": "so-docs-index-service-prod",
            "s3Key": "pdf-statement-119Y5Y6fF5uE",
            "account": {
              "id": "ca-cash-msb-guyN5Pf1-x",
              "type": "ca_cash_msb"
            },
            "documents": [
              {
                "id": "",
                "type": "so-statement",
                "createdAt": "2025-11-09T04:36:32",
                "s3BucketName": "so-docs-index-service-prod",
                "s3Key": "pdf-statement-119Y5Y6fF5uE"
              },
              {
                "id": "",
                "type": "so-statement",
                "createdAt": "2025-11-08T16:22:32",
                "s3BucketName": "so-docs-index-service-prod",
                "s3Key": "pdf-statement-119Y4jICU5PW"
              }
            ],
            "__typename": "Document"
          }
        ]
      }
    }
  }
}
```

**Key Fields**:

- `documents.results[].id`: Unique document ID (e.g., `pdf-statement-119Y5yi4UYwc`)
- `documents.results[].type`: Document type (`brokerage` for investment accounts, `cash` for chequing)
- `documents.results[].category`: Document category (`performance` for statements, `tax` for tax documents)
- `documents.results[].period`: Statement period in YYYY-MM-DD format (e.g., `2025-10-01`)
- `documents.results[].frequency`: Statement frequency (`month`, `year`, `once`)
- `documents.results[].s3BucketName`: AWS S3 bucket name (`so-docs-index-service-prod`)
- `documents.results[].s3Key`: S3 object key (document identifier for download)
- `documents.results[].account.id`: Associated account ID
- `documents.results[].account.type`: Associated account type
- `documents.results[].documents[]`: For cash accounts, contains versions of the statement (current and previous)

**Statement Types by Account Type**:

- **Chequing (ca_cash_msb)**: `type: "cash"`, `category: "performance"`
- **TFSA**: `type: "brokerage"`, `category: "performance"`
- **Non-registered**: `type: "brokerage"`, `category: "performance"`

**Parameter Sources**:

- `id`: Identity ID from user profile
- `limit`: Number of documents to fetch (default: 50)
- `accountIds`: Optional array of account IDs to filter by specific accounts
- `categories`: Optional array to filter by category (`performance`, `tax`, `account_agreement`, etc.)
- `types`: Optional array to filter by document type
- `period`: Optional date range filter
- `statuses`: Optional account status filter

## Download Statement PDF

**Step 1: Get Signed URL**

**API Endpoint**: `https://my.wealthsimple.com/graphql`
**HTTP Method**: POST
**GraphQL Operation**: `DocumentSignedUrlCreate`

### Request

**Headers**: Same as previous requests

**Request Body**:

```json
{
  "operationName": "DocumentSignedUrlCreate",
  "variables": {
    "bucket": "so-docs-index-service-prod",
    "key": "pdf-statement-119Y5Y6fF5uE"
  },
  "query": "mutation DocumentSignedUrlCreate($bucket: String!, $key: String!) { signDocumentUrl(bucket: $bucket, key: $key) { downloadUrl } }"
}
```

### Response

**Response Structure**:

```json
{
  "data": {
    "signDocumentUrl": {
      "downloadUrl": "https://so-docs-index-service-prod.s3.ca-central-1.amazonaws.com/cash-statements/WS/2025-10/XL5SAHK40DBE/identity-g3PlzWWDXYOJKuOZJRX0V7HYfXk/XL5SAHK40DBE_identity-g3PlzWWDXYOJKuOZJRX0V7HYfXk_2025-10_v_0.pdf?X-Amz-Security-Token=JRpKc4JpcmduX2VkFIVb...&X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Date=20251123T120511Z&X-Amz-SignedHeaders=host&X-Amz-Expires=3600&X-Amz-Credential=BTJBYXDYQGRPLE8TPKLK%2F20251123%2Fca-central-1%2Fs3%2Faws4_request&X-Amz-Signature=feg13c6gf73b2f8b25307328165e26dbb04768480369df8380817630e0ed4dbf",
      "__typename": "SignedDocument"
    }
  }
}
```

**Key Fields**:

- `signDocumentUrl.downloadUrl`: Temporary AWS S3 signed URL (valid for 1 hour based on `X-Amz-Expires=3600`)

**Parameter Sources**:

- `bucket`: S3 bucket name from the document list API (`s3BucketName` field)
- `key`: S3 object key from the document list API (`s3Key` field)

**Step 2: Download PDF**

**API Endpoint**: The signed URL from Step 1
**HTTP Method**: GET
**Authentication**: None (URL contains AWS signature)

The signed URL is a temporary AWS S3 URL that can be used to download the PDF file directly via HTTP GET request. The URL expires after 1 hour (3600 seconds).

**Important**: Direct fetch from browser will fail with CORS error. Use the browser extension's background script to fetch the PDF via `chrome.runtime.sendMessage` with the `requestFetch` action.

**Implementation Pattern**:

```javascript
// From content script
const response = await chrome.runtime.sendMessage({
  action: "requestFetch",
  url: signedDownloadUrl,
  options: {
    method: "GET",
    headers: {},
  },
});

// Response contains base64-encoded PDF
const base64Data = response.body;
```

**Manifest Requirements**:

The extension requires the following host permissions in `manifest.json` to bypass CORS:

```json
{
  "host_permissions": [
    "*://*.s3.ca-central-1.amazonaws.com/*",
    "*://*.s3.amazonaws.com/*"
  ]
}
```

**Example URLs by Account Type**:

- **Chequing Account**:

  ```
  https://so-docs-index-service-prod.s3.ca-central-1.amazonaws.com/cash-statements/WS/2025-10/XL5SAHK40DBE/identity-{IDENTITY_ID}/{ACCOUNT_ID}_identity-{IDENTITY_ID}_2025-10_v_0.pdf?{AWS_SIGNATURE}
  ```

- **Investment Accounts (TFSA/Non-registered)**:
  ```
  https://so-docs-index-service-prod.s3.ca-central-1.amazonaws.com/statements/TR/2025-10/{ACCOUNT_ID}/person-{PERSON_ID}/{ACCOUNT_ID}_person-{PERSON_ID}_2025-10_v_0.pdf?{AWS_SIGNATURE}
  ```

## Additional Notes

### API Architecture

- All APIs use GraphQL with POST requests to a single endpoint
- Operations are identified by the `operationName` field in the request body
- The GraphQL schema is strongly typed with `__typename` fields for type identification

### Error Handling

- GraphQL responses may include an `errors` array if the operation fails
- HTTP status codes are typically 200 even for errors; check the response body for `errors`

### Rate Limiting

- No explicit rate limiting information observed in the network trace
- Standard rate limiting headers may apply but were not captured

### Pagination

- Account and document lists support cursor-based pagination
- Use `pageInfo.hasNextPage` and `pageInfo.endCursor` to fetch subsequent pages
- Pass `after: endCursor` in variables to get the next page

### Document Versions

- Cash account statements may have multiple versions (indicated by `documents` array)
- The array contains version history with creation timestamps
- Use the `s3Key` from the most recent version (first in array) for the latest statement

### Statement ID Storage Optimization

To avoid making an extra GraphQL call to fetch S3 download information, the implementation stores all required S3 metadata in the `statementId` field as JSON:

```javascript
// Format
statementId = JSON.stringify({
  id: "pdf-statement-119Y5rMiPn1G", // Document ID
  bucket: "so-docs-index-service-prod", // S3 bucket name
  key: "pdf-statement-119Y5rMiPn1G", // S3 object key
});

// Example
statementId =
  '{"id":"pdf-statement-119Y5rMiPn1G","bucket":"so-docs-index-service-prod","key":"pdf-statement-119Y5rMiPn1G"}';
```

When downloading, parse the JSON to extract bucket and key, then call the `DocumentSignedUrlCreate` mutation to get the signed download URL.

### Session Management

- JWT tokens appear to have a limited lifetime (typically 1 hour based on `expires_in: 3600` in the cookie)
- The token must be refreshed periodically by re-authenticating or using a refresh token mechanism
- Session cookies like `wssdi` (device ID) persist across sessions
- The `x-ws-session-id` header tracks the session
- Tokens may need to be refreshed periodically (exact duration not observed)
