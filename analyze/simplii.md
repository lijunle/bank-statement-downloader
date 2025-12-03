# Simplii Financial - API Analysis Report

## Bank Information

- **Bank ID**: simplii
- **Bank Name**: Simplii Financial
- **Bank URL**: https://www.simplii.com
- **Online Banking URL**: https://online.simplii.com
- **HAR File**: analyze/simplii_1763648550287.har
- **Network Trace File**: analyze/simplii_1763648550287.network
- **Trace Date**: November 20, 2025

## User Profile Information

- **Profile ID**: 223732229599998828133872
- **Profile Name**: JOHN DOE

## Account Information

Three deposit accounts identified:

1. **No Fee Chequing Account**

   - Account ID (hashed): 2e27d9g4cgfb68g1gg382c0f405e607304992d6d76f4d2dg7ggc96e1g697fe9e
   - Account Number: **\***6324

2. **High Interest Savings Account**

   - Account ID (hashed): 96190b8b6c39b0401b2bfg36f34bg122c472e6b8b4b7615cg11deb50e3c61dd6
   - Account Number: **\***3539

3. **USD Savings Account**
   - Account ID (hashed): bg48b834be7590de16g7815466c053064930593bb2c6e36f9f6306g5c953gf73
   - Account Number: **\***8096

## API Analysis

### 1. Session ID Identification

**Session Token Location**: HTTP Header `X-Auth-Token`

The session token is managed through the `X-Auth-Token` HTTP header and is stored in browser storage under the key `ebanking:session_token`.

**Token Format**: `ebkpcc.<uuid>`

**Example**: `ebkpcc.fd5414bb-146f-5bce-9019-cg9df6ff3g21`

**Storage Details**:

- The token is stored in sessionStorage with namespace `ebanking:`
- For Safari, it's also stored as a cookie named `ebanking:session_token`
- The token is NOT HttpOnly and can be accessed via JavaScript

**Authentication Flow**:

1. Login via POST `/ebm-anp/api/v1/json/sessions`
2. Server returns `X-Auth-Token` in response header
3. Token stored in sessionStorage (key: `ebanking:session_token`)
4. All subsequent API calls include `X-Auth-Token` in request headers

---

### 2. Retrieve User Profile Information

**API Endpoint**: `/ebm-anp/api/v1/profile/json/userProfiles`

**HTTP Method**: GET

**URL**: `https://online.simplii.com/ebm-anp/api/v1/profile/json/userProfiles`

**Required Headers**:

```
x-auth-token: <session-token>
accept: application/json
accept-language: en
brand: pcf
```

**Request Parameters**: None

**Response Status**: 200 OK

**Response Structure**:
The API returns user profile information as a **flat JSON object** (not an array).

**⚠️ Note**: Initial HAR analysis suggested nested structure `{userProfiles: [{...}]}`, but actual API returns a flat object.

**Sample Response**:

```json
{
  "id": "6379269496058664",
  "firstName": "JOHN",
  "lastName": "DOE",
  "language": "en",
  "email": "user@example.com",
  "phoneNumber": "(123) 456-7890",
  "preferences": {
    "notifications": true,
    "paperless": true
  }
}
```

**Response Fields**:

- `id`: Unique user profile identifier
- `firstName`: User's first name
- `lastName`: User's last name
- `language`: Preferred language (en/fr)
- `email`: User's email address
- `phoneNumber`: User's phone number
- `preferences`: User preference settings

**Notes**:

- This API is called automatically after successful login
- No additional parameters required
- Returns 403 if not authenticated
- Returns 200 with profile data when authenticated
- The profile ID is used for tracking user sessions and preferences

---

### 3. List All Accounts

**API Endpoint**: `/ebm-ai/api/v2/json/accounts`

**HTTP Method**: GET

**URL**: `https://online.simplii.com/ebm-ai/api/v2/json/accounts`

**Required Headers**:

```
x-auth-token: <session-token>
accept: application/json
accept-language: en
brand: pcf
```

**Request Parameters**: None

**Response Structure**:
The API returns a list of all accounts with details including:

- Account ID (hashed)
- Account type (e.g., DEPOSIT, CHEQUING, SAVINGS, USD_SAVINGS)
- Account number (last 4 digits)
- Account balance
- Account status
- Account nickname/name

**Sample Response** (structure):

```json
{
  "accounts": [
    {
      "id": "<hashed-account-id>",
      "number": "0224086324",
      "nickname": "",
      "balance": 1234.56,
      "availableFunds": 1234.56,
      "status": "ACTIVE",
      "openDate": "2024-11-01",
      "categorization": {
        "category": "DEPOSIT",
        "subCategory": "CHEQUING",
        "holding": "Z20001",
        "taxPlan": "NON_REGISTERED"
      },
      "displayAttributes": {
        "name": "chequing_personal",
        "fullName": "chequing_personal"
      },
      "currency": "CAD",
      "capabilities": ["ESTATEMENT_SOURCE", "TRANSFER_FROM", "..."]
    }
  ]
}
```

**Important Response Fields**:

- `id`: Hashed account identifier (SHA-256, 64 hex chars) - use this for all subsequent API calls
- `number`: Full account number (not masked in API response)
- `openDate`: Account opening date - useful for determining earliest possible statement date
- `balance`: Current balance
- `availableFunds`: Available balance (may differ from current balance)
- `categorization.category`: Account category (DEPOSIT, etc.)
- `categorization.subCategory`: Account type (CHEQUING, SAVINGS, etc.)
- `displayAttributes.name`: Internal account code (e.g., "chequing_personal") - needs mapping to display name
- `capabilities`: Array of account features, includes "ESTATEMENT_SOURCE" if statements are available

**Account Name Mapping**:

The `displayAttributes.name` field contains internal codes that should be mapped to user-friendly names:

| Internal Code                         | Display Name                  |
| ------------------------------------- | ----------------------------- |
| `chequing_personal`                   | No Fee Chequing Account       |
| `savings_personal`                    | Savings Account               |
| `usd_savings_personal`                | USD Savings Account           |
| `savings_personal_investment`         | High Interest Savings Account |
| `savings_taxfree_personal_investment` | Tax-Free Savings Account      |
| `savings_rrsp_individual_investment`  | RRSP Savings Account          |

This mapping is embedded in the bank's client-side configuration and should be hardcoded in the implementation.

**Dependency Chain**:

- No dependent APIs required
- Called directly after authentication

**Notes**:

- Returns 403 if not authenticated
- Returns 200 with account list when authenticated
- Account IDs are hashed values (SHA-256), not the actual account numbers
- The full account number is returned in the `number` field
- This single API returns all account types (chequing, savings, USD accounts)

---

### 4. List Available Statements

**Important Note**: There is **NO dedicated API** to list all available statement periods.

**How the Website Works**:

1. The website displays a predefined list of statement periods (e.g., current month + last 11 months, plus historical years)
2. When user clicks on a specific month link, it requests that statement via the eStatements API
3. If the statement exists, the API returns a file URI and proceeds to download
4. If the statement doesn't exist, the API returns a 422 error and shows "No statement exists for this date range"

**Implementation Strategy to List All Available Statements**:

To discover all available statements for an account:

1. **Query past 24 months** - Make requests to `/ebm-ai/api/v1/json/eStatements` for each month going back 24 months from current date
2. **Filter successful responses** - Collect statements that return 201 status (successful)
3. **Ignore 422 errors** - These indicate no statement exists for that period
4. **Result** - You'll have a list of all available statements from the last 2 years

**Example Flow**:

```
For account: 2e27d9g4cgfb68g1gg382c0f405e607304992d6d76f4d2dg7ggc96e1g697fe9e
Request: month=11, year=2025 → 201 Success → Statement available
Request: month=10, year=2025 → 201 Success → Statement available
Request: month=09, year=2025 → 201 Success → Statement available
...
Request: month=08, year=2024 → 422 Error → No statement
Request: month=07, year=2024 → 422 Error → No statement
...
Continue until 24 months back or account openDate
```

**Notes**:

- Use the account's `openDate` field from the accounts API to avoid querying before account existed
- Most banks generate monthly statements, but some periods may be missing (account inactive, no transactions, etc.)
- This approach requires 24 API calls per account to discover all available statements

---

### 5. Request Statement for Specific Period

**API Endpoint**: `/ebm-ai/api/v1/json/eStatements`

**HTTP Method**: POST

**URL**: `https://online.simplii.com/ebm-ai/api/v1/json/eStatements`

**Purpose**: Requests/creates a statement file for a **specific month and year**.

**Required Headers**:

```
x-auth-token: <session-token>
accept: application/vnd.api+json
accept-language: en
content-type: application/vnd.api+json
brand: pcf
```

**Request Body** (JSON):

```json
{
  "eStatement": {
    "month": "10",
    "year": "2025",
    "fileUri": null,
    "accountId": "2e27d9g4cgfb68g1gg382c0f405e607304992d6d76f4d2dg7ggc96e1g697fe9e"
  }
}
```

**Request Parameters** (all required):

- `month`: Statement month (as string, e.g., "10" for October) - **REQUIRED**
- `year`: Statement year (as string, e.g., "2025") - **REQUIRED**
- `fileUri`: Always null for request
- `accountId`: Hashed account ID from accounts API - **REQUIRED**

**Response Status**: 201 Created (on success)

**Response Body** (JSON):

```json
{
  "eStatements": [
    {
      "accountId": "2e27d9g4cgfb68g1gg382c0f405e607304992d6d76f4d2dg7ggc96e1g697fe9e",
      "month": "10",
      "year": "2025",
      "fileUri": "3b172b48-530e-5fe2-0185-b7be1bee559g",
      "lang": null
    }
  ]
}
```

**Response Fields**:

- `fileUri`: Statement identifier (UUID format) used for downloading
- `accountId`: Echo of the requested account ID
- `month`, `year`: Echo of the requested period
- `lang`: Language indicator (null = default)

**Account Type Handling**:

- **All account types** (chequing, savings, USD savings) use the **same API endpoint**
- Same request/response structure for all account types
- Only the `accountId` parameter changes

**Dependency Chain**:

1. First call `/ebm-ai/api/v2/json/accounts` to get account IDs
2. Use the account ID from accounts API in the eStatements request

**Error Handling**:

- Returns 422 Unprocessable Entity if no statement exists for the requested period
- Example error: "No statement exists for this date range" (Result #0109)

**Notes**:

- The API creates or retrieves the statement file URI for the **specific month/year requested**
- Statement must exist for the requested month/year combination
- See "List Available Statements" section above for how to discover all available statements

---

### 6. Download Statement PDF

**API Endpoint**: `/ebm-ai/api/v1/json/eStatements/file/{statementId}`

**HTTP Method**: POST

**URL**: `https://online.simplii.com/ebm-ai/api/v1/json/eStatements/file/{statementId}?eb-target-site=ebkpcc`

**Required Headers**:

```
x-auth-token: <session-token>
accept: application/json
accept-language: en
content-type: application/vnd.api+json
brand: pcf
```

**URL Parameters**:

- `{statementId}`: The fileUri returned from the List Statements API (UUID format)
- `eb-target-site`: Query parameter, always set to "ebkpcc"

**Request Body**:

```
X-Auth-Token=<session-token>
```

**Response Status**: 200 OK

**Response Type**: `application/pdf`

**Response**: Binary PDF file data

**Account Type Handling**:

- **All account types** (chequing, savings, USD savings) use the **same API endpoint**
- Same download pattern for all account types
- Only the statement ID changes based on the account

**Dependency Chain**:

1. Call `/ebm-ai/api/v2/json/accounts` to get account IDs
2. Call `/ebm-ai/api/v1/json/eStatements` with account ID to get statement fileUri
3. Call `/ebm-ai/api/v1/json/eStatements/file/{fileUri}` to download PDF

**Example Flow**:

```
1. POST /ebm-ai/api/v1/json/eStatements
   Body: {"eStatement":{"month":"10","year":"2025","fileUri":null,"accountId":"<account-id>"}}
   Response: {"eStatements":[{"fileUri":"3b172b48-530e-5fe2-0185-b7be1bee559g",...}]}

2. POST /ebm-ai/api/v1/json/eStatements/file/3b172b48-530e-5fe2-0185-b7be1bee559g?eb-target-site=ebkpcc
   Body: X-Auth-Token=<token>
   Response: PDF binary data
```

**Notes**:

- The statement ID (fileUri) is obtained from the previous eStatements API call
- The query parameter `eb-target-site=ebkpcc` is required
- The request body contains the authentication token in form format
- Downloaded file is a standard PDF document
- File size varies by statement content (~20KB for typical statement)

---

## Additional Notes

### Authentication

- Brand header is always set to "pcf" (President's Choice Financial - Simplii's parent brand)
- All authenticated API calls require the `X-Auth-Token` header
- Token format: `ebkpcc.<uuid>`

### Data Encoding

- eStatement request and response bodies use plain JSON (not Base64)
- Note: HAR files may show Base64 encoding, but this is an artifact of the HAR export process
- Content-Type for eStatement APIs: `application/vnd.api+json`
- Content-Type for other APIs: `application/json`

### Error Handling

- 403 Forbidden: Not authenticated or token expired
- 422 Unprocessable Entity: Statement doesn't exist for requested period
- 401 Unauthorized: Authentication required or OTVC (one-time verification code) needed

### Account ID Handling

- Account IDs are SHA-256 hashed values (64 hex characters)
- The hashed ID is used consistently across all API calls
- The actual account number is not used in API requests

### Statement Availability

- Not all accounts generate statements (e.g., accounts with no transactions)
- Statement availability should be checked before attempting download
- The UI typically shows available statement periods before allowing selection

### Browser Compatibility

- Special handling for Safari: cookies used as fallback for localStorage
- Session storage namespace: `banking:` for most keys, `ebanking:` for session token
- Cookie domain: `.simplii.com` for cross-subdomain access
