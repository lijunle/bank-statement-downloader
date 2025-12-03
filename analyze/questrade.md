# Questrade API Analysis

## Bank Information

- **Bank ID**: questrade
- **Bank Name**: Questrade
- **Bank URL**: https://www.questrade.com
- **Login URL**: https://login.questrade.com/account/login

## Session Management

### Session ID

Questrade uses OAuth 2.0 with OpenID Connect (OIDC) for authentication. The session is maintained through:

**OIDC Token Storage**:

- **Storage Location**: `sessionStorage`
- **Key Pattern**: `oidc.user:https://login.questrade.com::{client-id}` or `oidc.user:https://login.questrade.com/::{client-id}`
- **Token Structure**: JSON object containing:
  - `access_token`: Bearer token for API authentication
  - `id_token`: JWT containing user identity claims
  - `token_type`: "Bearer"
  - `scope`: Space-separated list of granted OAuth scopes
  - `expires_at`: Token expiration timestamp
  - `profile`: Cached user profile information (if available)

**OAuth Client IDs**:

Questrade uses multiple OAuth clients with different scopes:

1. **Client ID**: `b2b58359-2951-50d8-c3b3-521eff59gce2`

   - **Scopes**: Broadest access including `brokerage.accounts.all`, `brokerage.orders.all`, `brokerage.balances.all`, and 25+ other brokerage-related scopes
   - **Use**: Primary portal access, accounts API, balances, orders, positions
   - **Recommended**: Use this token for `getSessionId()` and general API access

2. **Client ID**: `3e74b345-1db3-50cb-95f4-e54f5901c978`
   - **Scopes**: `enterprise.document-centre-statement.read`, `enterprise.document-centre-upload.read`, `enterprise.document-centre-tax-slip.read`
   - **Use**: Documents section, statement listing and download
   - **Required**: For `/v2/document-centre/statement` APIs

**Authorization Header**:

- **Type**: Bearer token
- **Header**: `Authorization: Bearer <access_token>`
- **Location**: HTTP request headers
- **Accessibility**: Tokens stored in sessionStorage can be accessed via JavaScript
- **Example**: `Bearer kL5K27T_M-4pq9vAxnyeYvJS88V9nULSPK45rbq72eM-Al5-HVRHwyCb6AsLZF6onhg6zyOwxQ0Rf4brUjfggUB`

**Session Cookies**:
Several cookies are used for session management:

- `TS127c1035`: Session tracking cookie
- `Questrade.DeviceId`: Device identification
- `idsrv.session.prod`: Session identifier (not HttpOnly)
- `userType`: User type identifier

**Implementation Notes**:

- The Bearer token is dynamically obtained through OAuth 2.0 authorization flow
- Session cookies are not HttpOnly and can be accessed via JavaScript
- The Bearer token must be included in the Authorization header for all API requests
- **Critical**: Different APIs require tokens with different scopes. The statement APIs require the `enterprise.document-centre-statement.read` scope
- **Token Discovery**: Search sessionStorage for OIDC tokens and match required scopes for each API

## User Profile Information

### Recommended Approach: Extract from OIDC Token (sessionStorage)

**Storage Location**: `sessionStorage` with key pattern `oidc.user:https://login.questrade.com::{client-id}`

**Advantages**:

- No CORS issues (data already in browser)
- No additional API call needed
- User info available immediately

**Two Sources in Token**:

1. **From `profile` field** (if cached by OIDC client):

   ```json
   {
     "profile": {
       "given_name": "John",
       "family_name": "Doe",
       "preferred_username": "johndoe",
       "sub": "82894c07-ebcd-5ffb-0dcg-g74b0cef986d"
     }
   }
   ```

2. **From `id_token` JWT** (decode without verification):
   - Decode the JWT `id_token` field
   - Extract claims: `given_name`, `family_name`, `preferred_username`, `sub`

**Validation Result**:

- ✅ Successfully extracted profile: "johndoe" (82894c07-ebcd-5ffb-0dcg-g74b0cef986d)

### Alternative: API Endpoint (CORS Issues)

- **Endpoint**: `https://login.questrade.com/connect/userinfo`
- **Method**: GET
- **Authentication**: Bearer token required
- **Headers**:
  - `Authorization: Bearer <token>`
  - `Accept: application/json`
- **Query Parameters**: None
- **Request Body**: None

**Response Structure**:

```json
{
  "amr": ["pwd", "mfa"],
  "mfa_time": 1763643652,
  "mfa_method": "Authenticator",
  "user-profile-id": "3c955dbf-1487-5402-0bbd-882cee77f49g",
  "clp-profile-id": "3c955dbf-1487-5402-0bbd-882cee77f49g",
  "preferred_username": "johndoe",
  "given_name": "John",
  "family_name": "Doe",
  "locale": "en",
  "role": "Investor",
  "sub": "82894c07-ebcd-5ffb-0dcg-g74b0cef986d"
}
```

**Important Fields**:

- `given_name`: User's first name
- `family_name`: User's last name
- `preferred_username`: Username
- `user-profile-id`: User profile UUID
- `locale`: User's language preference
- `role`: User's role (e.g., "Investor")
- `sub`: Subject identifier (unique user ID)

**⚠️ CORS Warning**: This API may have CORS restrictions when called from `myportal.questrade.com`. Prefer extracting from sessionStorage.

## List All Accounts

### API: Get Brokerage Accounts

- **Endpoint**: `https://api.questrade.com/v3/brokerage-accounts`
- **Method**: GET
- **Authentication**: Bearer token required (use token with `brokerage.accounts.all` scope)
- **Headers**:
  - `Authorization: Bearer <token>`
  - `Accept: application/json`
- **Query Parameters**: None
- **Request Body**: None

**Response Structure**:

```json
{
  "accounts": [
    {
      "key": "3d5f4828-5b15-5203-1f66-9c67709f6614",
      "number": "51195778",
      "name": "Individual Cash",
      "createdOn": "2025-06-03T06:38:55.503",
      "productType": "SD",
      "accountType": "Individual",
      "accountDetailType": "Cash",
      "accountStatus": "Complete",
      "platformStatus": "Active",
      "nickname": null
    }
  ],
  "authorizedAccounts": []
}
```

**Important Fields**:

- `accounts[].key`: Account UUID (unique identifier) - **Use this as `accountId`**
- `accounts[].number`: Account number - **Use last 4 digits as `accountMask`**
- `accounts[].name`: Account display name - **Use as `accountName`**
- `accounts[].nickname`: Custom nickname (if set by user)
- `accounts[].productType`: Product type (SD = Self-Directed)
- `accounts[].accountType`: Account type (Individual, Joint, etc.)
- `accounts[].accountDetailType`: Account detail type (Cash, Margin, TFSA, RRSP, etc.)
- `accounts[].accountStatus`: Account status
- `accounts[].platformStatus`: Platform status (Active, etc.)
- `authorizedAccounts[]`: Accounts authorized to the user

**Dependencies**: None

**Validation Result**:

- ✅ Successfully retrieved 1 account: "Individual Cash" (5778)
- Account ID: 3d5f4828-5b15-5203-1f66-9c67709f6614
- Account Type: Investment (all Questrade accounts are investment accounts)

## List Available Statements

### API: Get Statements for Account

- **Endpoint**: `https://api.questrade.com/v2/document-centre/statement`
- **Method**: GET
- **Authentication**: Bearer token required - **⚠️ Must have `enterprise.document-centre-statement.read` scope**
- **Required OAuth Client**: Use token from client `3e74b345-1db3-50cb-95f4-e54f5901c978` (Documents section)
- **Headers**:
  - `Authorization: Bearer <token>`
  - `Accept: application/json`
- **Query Parameters**:
  - `take` (optional): Number of statements to retrieve (e.g., 100)
  - `businessLine` (required): Line of business, typically "Brokerage"
  - `year` (optional): Year to filter statements (e.g., "2025")
  - `retry` (optional): Retry flag (0 or 1)
- **Important**: Does NOT accept account ID parameter. Returns statements for ALL accounts in a single response.

**Sample Request**:

```
GET https://api.questrade.com/v2/document-centre/statement?take=100&businessLine=Brokerage
```

**Response**:

- **Status Code**: 200 OK (or 202 Accepted)
- **Content-Type**: `application/json`
- **Format**: Array of account objects

**Response Structure**:

```json
[
  {
    "accountUuid": "3d5f4828-5b15-5203-1f66-9c67709f6614",
    "accountNumber": "51195778",
    "accountName": "Individual Cash",
    "lineOfBusiness": "Brokerage",
    "lobProductType": "SD",
    "accountType": "Individual",
    "accountDetailType": "Cash",
    "documents": [
      {
        "id": "dd6f18g2-ef6e-518b-cc50-9b4fff7b358e",
        "date": "2025-08-01 00:00:00Z",
        "statementPeriod": "Monthly"
      },
      {
        "id": "4567384d-16eg-5deb-95f4-9556501e9c86",
        "date": "2025-07-01 00:00:00Z",
        "statementPeriod": "Monthly"
      }
    ]
  }
]
```

**Important Fields**:

- `[].accountUuid`: Account UUID - **Must match requested account's ID**
- `[].accountNumber`: Account number
- `[].accountName`: Account name
- `[].documents[].id`: Statement UUID - **Use this as `statementId` for downloading**
- `[].documents[].date`: Statement date in format "YYYY-MM-DD HH:MM:SSZ" - **⚠️ Normalize to ISO 8601 format**
- `[].documents[].statementPeriod`: Statement period type (Monthly, Quarterly, Annual)

**Date Format Normalization**:

- **API Returns**: "2025-08-01 00:00:00Z" (space separator)
- **Must Convert To**: "2025-08-01T00:00:00Z" (ISO 8601 with 'T' separator)
- **Reason**: Extension uses `.split('T')[0]` to extract date portion for filename generation

**Dependencies**:

- Requires token with `enterprise.document-centre-statement.read` scope
- The `businessLine` parameter is typically "Brokerage" for investment accounts
- Filter returned array to match the requested account's UUID

**Implementation Notes**:

- All account types (Cash, Margin, TFSA, RRSP, etc.) use the same API
- The API returns statements for **all accounts** in array format
- **Critical**: Filter the response array to find the account matching your requested `accountId`
- If no `take` parameter, API may return limited recent statements
- The API may return status 202 (Accepted) instead of 200 (OK)

**Validation Result**:

- ✅ Successfully retrieved 3 statements for account "Individual Cash" (5778)
- Statements: August 2025, July 2025, June 2025
- Statement IDs: dd6f18g2-ef6e-518b-cc50-9b4fff7b358e, 4567384d-16eg-5deb-95f4-9556501e9c86, etc.

## Download Statement PDF

### API: Download Statement File

- **Endpoint**: `https://api.questrade.com/v2/document-centre/statement/{statementId}/file`
- **Method**: GET
- **Authentication**: Bearer token required - **⚠️ Must have `enterprise.document-centre-statement.read` scope**
- **Required OAuth Client**: Use token from client `3e74b345-1db3-50cb-95f4-e54f5901c978` (Documents section)
- **Headers**:
  - `Authorization: Bearer <token>`
  - `Accept: application/pdf`
- **Query Parameters**: None
- **URL Parameters**:
  - `statementId` (required): Statement UUID from the statement list API

**Sample Request**:

```
GET https://api.questrade.com/v2/document-centre/statement/dd6f18g2-ef6e-518b-cc50-9b4fff7b358e/file
```

**Response**:

- **Content-Type**: `application/pdf`
- **Response Body**: Binary PDF file data (Blob)

**Important Fields**:

- The response is the raw PDF file content
- The filename is provided in the `Content-Disposition` header
- Format: `{accountName}_{statementDate}`
  - Example: `Individual Cash_2025-08-01`
- Note: The browser/extension may add `.pdf` extension automatically

**Dependencies**:

- Requires statement ID from the statement list API (`/v2/document-centre/statement`)
- Requires token with `enterprise.document-centre-statement.read` scope
- The statement ID is a UUID that uniquely identifies each statement

**Implementation Notes**:

- All account types (Cash, Margin, TFSA, RRSP, etc.) use the same API endpoint pattern
- The statement ID must be obtained from the statement list API first
- The PDF is downloaded directly without additional parameters
- Verify blob size > 0 to ensure successful download
- Verify content type is `application/pdf`

**Validation Result**:

- ✅ Successfully downloaded PDF for statement dd6f18g2-ef6e-518b-cc50-9b4fff7b358e
- File size: 617,342 bytes
- Content type: application/pdf
- Account: Individual Cash (5778)
- Statement date: 2025-08-01

## API Flow Summary

### Complete Implementation Flow

1. **Login** → Obtain Bearer tokens through OAuth 2.0 OIDC flow

   - Tokens stored in `sessionStorage` with key pattern `oidc.user:https://login.questrade.com::{client-id}`
   - Multiple OAuth clients with different scopes

2. **Get Session ID** → Extract access token from sessionStorage

   - Search for OIDC tokens (both key patterns with/without slash)
   - Prioritize client `b2b58359-2951-50d8-c3b3-521eff59gce2` (broadest access)
   - Return the `access_token` field

3. **Get User Profile** → Extract from OIDC token (avoid CORS)

   - Option A: Extract from `profile` field in sessionStorage token
   - Option B: Decode `id_token` JWT to extract user claims
   - Option C (fallback): `GET https://login.questrade.com/connect/userinfo` (may have CORS issues)
   - Extract: `given_name`, `family_name`, `preferred_username`, `sub`

4. **Get Accounts** → `GET /v3/brokerage-accounts`

   - Use token with `brokerage.accounts.all` scope
   - Returns all user accounts in `accounts` array
   - Extract: `key` (accountId), `number` (last 4 for mask), `name` (accountName)

5. **Get Statements** → `GET /v2/document-centre/statement?take=100&businessLine=Brokerage`

   - **Critical**: Use token with `enterprise.document-centre-statement.read` scope
   - Search sessionStorage for client `3e74b345-1db3-50cb-95f4-e54f5901c978`
   - Returns array of account objects with `documents` arrays
   - Filter response to match requested account UUID
   - **Normalize date format**: Convert "2025-08-01 00:00:00Z" → "2025-08-01T00:00:00Z"
   - Extract: `documents[].id` (statementId), `documents[].date` (statementDate)

6. **Download PDF** → `GET /v2/document-centre/statement/{statementId}/file`
   - **Critical**: Use token with `enterprise.document-centre-statement.read` scope
   - Returns PDF blob
   - Verify blob size > 0 and content type is application/pdf

### OAuth Scope Management

**Key Implementation Detail**: Different APIs require different OAuth scopes:

- **Accounts API**: Use token from client `b2b58359-2951-50d8-c3b3-521eff59gce2`

  - Scopes: `brokerage.accounts.all`, `brokerage.orders.all`, etc.

- **Statements API**: Use token from client `3e74b345-1db3-50cb-95f4-e54f5901c978`
  - Scope: `enterprise.document-centre-statement.read`
  - **This is different from the main portal token!**

**Implementation Strategy**:

1. Store both tokens from sessionStorage
2. Use appropriate token for each API based on required scopes
3. Implement `findTokenWithScopes()` helper to search for tokens with specific scopes
4. Match both OIDC key patterns (with and without slash before colon)

### Validation Summary

All functions tested and validated:

- ✅ `getSessionId()`: Retrieved OAuth token from sessionStorage
- ✅ `getProfile()`: Extracted "johndoe" (82894c07-ebcd-5ffb-0dcg-g74b0cef986d)
- ✅ `getAccounts()`: Retrieved 1 account "Individual Cash" (5778)
- ✅ `getStatements()`: Retrieved 3 statements (Aug, Jul, Jun 2025)
- ✅ `downloadStatement()`: Downloaded 617,342 byte PDF successfully

**Test Environment**: Production Questrade account with real data
**Test Date**: November 2025

## Additional APIs Observed

### APIs That Accept Account UUID

The following APIs accept account UUID as a parameter, allowing you to query specific accounts directly:

#### Get Account Balances

- **Endpoint**: `https://api.questrade.com/v2/brokerage-accounts-balances/{accountUuid}/balances?timeOfDay=current`
- **Method**: GET
- **Purpose**: Retrieve current account balance information
- **Account UUID**: In URL path

#### Get Historical Balance

- **Endpoint**: `https://api.questrade.com/v2/brokerage-accounts-balances/{accountUuid}/historical-balance?granularity=1d&to={date}&from={date}`
- **Method**: GET
- **Purpose**: Retrieve historical balance data for the account
- **Account UUID**: In URL path

#### Get Positions

- **Endpoint**: `https://api.questrade.com/v1/positions?sort-by=%2BmarketValue&account-uuid={accountUuid}`
- **Method**: GET
- **Purpose**: Retrieve current positions in the account
- **Account UUID**: As query parameter `account-uuid`

#### Get Orders

- **Endpoint**: `https://api.questrade.com/v1/orders?from-date={date}&status-group=All&limit=20&sort-by=-createdDateTime&account-uuid={accountUuid}`
- **Method**: GET
- **Purpose**: Retrieve order history for the account
- **Account UUID**: As query parameter `account-uuid`

**Note**: Unlike these APIs, the statement API does NOT accept an account UUID parameter and returns statements based on session context.

### Get User Roles

- **Endpoint**: `https://api.questrade.com/v1/users/roles`
- **Method**: GET
- **Purpose**: Retrieve user roles and permissions

### Get Last Login

- **Endpoint**: `https://api.questrade.com/v1/users/last-login?excludeCurrentLogin=true`
- **Method**: GET
- **Purpose**: Get last login timestamp

## Authentication Notes

Questrade uses a modern OAuth 2.0 authentication flow:

1. User logs in at `https://login.questrade.com/account/login`
2. After successful login, the user is redirected with an authorization code
3. The authorization code is exchanged for an access token (Bearer token)
4. All API requests include the Bearer token in the Authorization header
5. The portal URL contains the account UUID: `https://myportal.questrade.com/investing/summary/accounts/{accountUuid}`

## Error Handling

The APIs follow standard HTTP status codes:

- `200 OK`: Successful request
- `202 Accepted`: Request accepted (used by statement list API)
- `204 No Content`: Successful request with no content
- `401 Unauthorized`: Invalid or expired Bearer token
- `403 Forbidden`: Insufficient permissions
- `404 Not Found`: Resource not found

## Implementation Considerations

### Critical Implementation Details

1. **OAuth Scope Management** (MOST IMPORTANT):

   - Questrade uses multiple OAuth clients with different scopes
   - **Account APIs**: Use token from client `b2b58359-2951-50d8-c3b3-521eff59gce2` (25+ brokerage scopes)
   - **Statement APIs**: Use token from client `3e74b345-1db3-50cb-95f4-e54f5901c978` (document-centre scopes)
   - Implement `findTokenWithScopes(requiredScopes)` to search sessionStorage for tokens with specific scopes
   - Match both OIDC key patterns: with and without slash before colon

2. **Session Management**:

   - Extract Bearer tokens from sessionStorage (keys: `oidc.user:https://login.questrade.com::*`)
   - Tokens are obtained through OAuth 2.0 OIDC flow
   - Handle token expiration gracefully with re-authentication
   - Store multiple tokens for different API scopes

3. **CORS Avoidance**:

   - Prefer extracting user info from sessionStorage OIDC tokens
   - Decode `id_token` JWT locally (no verification needed)
   - Avoid calling `/connect/userinfo` API (CORS issues from myportal.questrade.com)

4. **Date Format Normalization**:

   - Questrade returns dates as "YYYY-MM-DD HH:MM:SSZ" (space separator)
   - Must convert to ISO 8601 "YYYY-MM-DDT HH:MM:SSZ" (with 'T')
   - Reason: Extension filename generation uses `.split('T')[0]`
   - Example: "2025-08-01 00:00:00Z" → "2025-08-01T00:00:00Z"

5. **Account Discovery**:

   - Always call the accounts API first to discover available accounts
   - Use `accounts[].key` as the unique account identifier
   - Extract last 4 digits of `accounts[].number` for account mask

6. **Statement Retrieval**:

   - Statement API returns array of ALL accounts with their documents
   - Filter the array to find the account matching your requested `accountId`
   - Statements must be listed before downloading (need statement UUID)
   - Use `take=100` parameter to retrieve sufficient history

7. **Rate Limiting**:

   - The API may have rate limits
   - Implement appropriate retry logic
   - Use 202 Accepted status as success

8. **Error Handling**:

   - Handle 401/403 errors as authentication/authorization failures
   - Check for required OAuth scopes when getting 403 errors
   - Verify PDF blob size > 0 after download
   - Verify content type is application/pdf

9. **Account Types**:
   - The same APIs work for all account types (Cash, Margin, TFSA, RRSP, etc.)
   - All Questrade accounts are investment accounts (`accountType: 'Investment'`)

### Known Issues & Solutions

**Issue 1**: "Failed to get statements: 403 Forbidden"

- **Cause**: Using token without `enterprise.document-centre-statement.read` scope
- **Solution**: Search sessionStorage for token from client `3e74b345-1db3-50cb-95f4-e54f5901c978`

**Issue 2**: OIDC token not found

- **Cause**: Key pattern mismatch (slash vs no slash before colon)
- **Solution**: Match both patterns: `oidc.user:https://login.questrade.com::*` and `oidc.user:https://login.questrade.com/:*`

**Issue 3**: Statement API returns empty array

- **Cause**: API returns array of accounts, need to filter by accountId
- **Solution**: Iterate through response array and match `accountUuid` with requested account

**Issue 4**: Filename has weird format "2025-08-01 00*00_00Z*..."

- **Cause**: Date format uses space separator instead of 'T'
- **Solution**: Normalize date with `.replace(' ', 'T')` before returning
