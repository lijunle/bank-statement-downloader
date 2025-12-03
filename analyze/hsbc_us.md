# HSBC US Bank - API Analysis

## Bank Information

- **Bank ID**: hsbc_us
- **Bank Name**: HSBC Bank USA, N.A.
- **Bank URL**: https://www.us.hsbc.com/
- **API Base URL**: https://www.us.hsbc.com/api/

## Session Management

### Session ID

The session is maintained through multiple cookies and tokens:

1. **Primary Session Cookie**: `dspSession`
   - Example: `Xkp9Ywqzhmvce_jfn-Dqt-Np7rG.*BBKURVBDNEJBAlRMAByzWVkQnMOI7/Y4z8v38ETDFciqnJVI2AAU1zqMBBENURTBAlT2AAIxMg..*`
   - This cookie is HttpOnly and cannot be accessed via JavaScript directly
2. **DXP PEP Token**: `dxp-pep-token`

   - JWT token used for API authorization
   - Example: `eyJhbGciOiJQUzI1NiIsInR5cCI6IkpXVCIsImtpZCI6InVzLXdlc3QtMjphbGlhcy9keHAtcGVwLWp3dCJ9...`
   - Contains customer authentication and authorization information
   - Expires after a set period (typically 1 hour based on `exp` claim)

3. **HSBC Browser Cookie**: `HSBC_BROWSER_COOKIE`

   - Encrypted JWT containing browser identification information
   - Used for device fingerprinting and security

4. **Session/Client ID Cookie**: `scid` (Accessible, Primary)

   - Example: `294816537492183657829471635284`
   - Unique session/client identifier
   - This cookie is accessible via JavaScript and used as session ID in extension context

5. **Session Number Cookie**: `cdSNum` (Accessible, Fallback)

   - Example: `1847293618472-sjc0000847-a9f2c381-5e4a-7293-9b15-82da4cf7e912`
   - Contains timestamp and unique session identifier
   - Available in browser console context but may not be present in extension context

6. **Authorization Header**: `token_type: SESSION_TOKEN`
   - Custom header used in API requests

**Session Access**: While the primary session cookies (`dspSession`, `dxp-pep-token`, `HSBC_BROWSER_COOKIE`) are HttpOnly and cannot be accessed via JavaScript, the `scid` and `cdSNum` cookies are accessible and contain unique session identifiers.

**Implementation Note**: The `getSessionId()` function first attempts to extract the `scid` cookie (available in extension context), then falls back to `cdSNum` cookie (available in browser console). The actual authentication is handled automatically by the browser through HttpOnly cookies when making API requests with `credentials: 'include'`.

## User Profile Information

### API: Get Dashboard Data

- **Endpoint**: `/api/dcc-us-hbus-global-utilities-papi-prod-proxy/v2/dashboard-data`
- **Method**: GET
- **Query Parameters**:
  - `lastLoginFormat=ISO`

#### Required Headers

```
accept: application/json, text/plain, */*
content-type: application/json
token_type: SESSION_TOKEN
x-hsbc-channel-id: OHI
x-hsbc-chnl-countrycode: US
x-hsbc-chnl-group-member: HBUS
x-hsbc-jsc-data: <device fingerprint data>
x-hsbc-locale: en_US
cookie: <all session cookies>
```

#### Response Structure

```json
{
  "responseInfo": {
    "requestCorrelationId": "a7d29f38-4c81-52e7-b6a3-9e5d17fc82b4",
    "reasons": []
  },
  "dashboardData": {
    "greetingMessage": "MORNING",
    "customerName": {
      "firstName": "JOHN",
      "lastName": "DOE"
    },
    "entityDateTime": {
      "entityDate": "2025-11-20",
      "entityTime": "05:01:14-0500"
    },
    "lastLogonDate": "2025-11-20T04:35:19-05:00",
    "customerSegment": "premier"
  }
}
```

**Important Fields**:

- `dashboardData.customerName.firstName`: Customer's first name
- `dashboardData.customerName.lastName`: Customer's last name
- `dashboardData.lastLogonDate`: Last login timestamp in ISO format
- `dashboardData.customerSegment`: Customer segment (e.g., "premier")

## List All Accounts

### API: Get Domestic Accounts

- **Endpoint**: `/api/dcc-us-hbus-account-list-papi-prod-proxy/v3/accounts/domestic`
- **Method**: GET
- **Query Parameters**:
  - `eligibilityType=witheligibilityindicators` (for dashboard)
  - `eligibilityType=estatements` (for statements page)

#### Required Headers

```
accept: application/json, text/plain, */*
content-type: application/json
token_type: SESSION_TOKEN
x-hsbc-channel-id: OHI
x-hsbc-chnl-countrycode: US
x-hsbc-chnl-group-member: HBUS
x-hsbc-jsc-data: <device fingerprint data>
x-hsbc-locale: en_US
cookie: <all session cookies>
```

#### Response Structure

**Note**: The API returns `accountList` as the root array field, not `accounts`.

```json
{
  "accountList": [
    {
      "accountIdentifier": {
        "accountIdentifier": "RWxY...",
        "productCategoryCode": "DDA",
        "productCode": "CA9",
        "normalisedProductCategoryCode": "CHQ",
        "accountIdentifierIndex": "RWxY..."
      },
      "accountDisplay": "739284651",
      "accountNickname": "",
      "productDescription": "HSBC Premier",
      "accountStatus": "ACTIVE",
      "ledgerBalance": {
        "currency": "USD",
        "amount": "1.00"
      },
      "availableBalance": {
        "currency": "USD",
        "amount": "1.00"
      }
    },
    {
      "accountIdentifier": {
        "accountIdentifier": "RWxY...",
        "productCategoryCode": "SDA",
        "productCode": "SSF",
        "normalisedProductCategoryCode": "SAV",
        "accountIdentifierIndex": "RWxY..."
      },
      "accountDisplay": "739284668",
      "accountNickname": "",
      "productDescription": "HSBC Premier Relationship Savings",
      "accountStatus": "ACTIVE",
      "ledgerBalance": {
        "currency": "USD",
        "amount": "1074.89"
      },
      "availableBalance": {
        "currency": "USD",
        "amount": "1074.89"
      }
    }
  ]
}
```

**Important Fields**:

- `accountIdentifier.accountIdentifierIndex`: Encrypted account identifier token (required for statement APIs)
- `accountDisplay`: Last 9 digits of account number (displayed as account number)
- `productDescription`: Account type/name
- `normalisedProductCategoryCode`: Account category (CHQ=Checking, SAV=Savings)
- `ledgerBalance.amount`: Ledger balance
- `availableBalance.amount`: Available balance
- `ledgerBalance.currency`: Currency code

**Parameter Sources**: No additional parameters needed - uses session cookies for authentication.

## List Available Statements

### API: Get Customer Account Statements

- **Endpoint**: `/api/mmf-files-statements--us-hbus-prod-proxy/v1/customer-accounts/{accountIdentifierIndex}/statements`
- **Method**: GET
- **Path Parameters**:
  - `accountIdentifierIndex`: Encrypted account identifier from account list API
- **Query Parameters**:
  - `documentType=BOTH`

#### Required Headers

**Critical**: The statements API requires three additional headers beyond the basic authentication headers:

```
accept: application/json, text/plain, */*
content-type: application/json
token_type: SESSION_TOKEN
x-hsbc-channel-id: OHI
x-hsbc-chnl-countrycode: US
x-hsbc-chnl-group-member: HBUS
x-hsbc-jsc-data: <device fingerprint data>
x-hsbc-locale: en_US
x-hsbc-client-id: 8c29df47a6e18b35c94720e63fa18d5b
x-hsbc-global-channel-id: WEB
x-hsbc-source-system-id: 7382915
cookie: <all session cookies>
```

**Missing Headers**: Without these headers, the API returns 400 errors:

- Missing `x-hsbc-client-id`: "Invalid/Missing header: X-HSBC-Client-Id"
- Missing `x-hsbc-global-channel-id`: "Invalid/Missing header: X-HSBC-Global-Channel-Id"
- Missing `x-hsbc-source-system-id`: "Invalid/Missing header: X-HSBC-Source-System-Id"

#### Response Structure

```json
{
  "statements": [
    {
      "statementDate": "2025-10-29",
      "accountNumber": "739284651",
      "statementType": "REGULAR",
      "statementIdentifier": "RWxYSk5DU0hTQkpIZ2VB7d..."
    }
  ]
}
```

**Important Fields**:

- `statementDate`: Statement date in YYYY-MM-DD format
- `accountNumber`: Account number (last 9 digits)
- `statementType`: Type of statement (REGULAR, etc.)
- `statementIdentifier`: Encrypted statement identifier (required for download API)

**Account Types**: This API works for all account types (Checking, Savings, Credit Card, Loan). The same endpoint format is used.

**Parameter Sources**:

- `accountIdentifierIndex`: From account list API response (`accountIdentifier.accountIdentifierIndex` field)

## Download Statement PDF

### API: Get Statement File

- **Endpoint**: `/api/mmf-files-statements--us-hbus-prod-proxy/v1/statements/{statementIdentifier}/statement-files`
- **Method**: GET
- **Path Parameters**:
  - `statementIdentifier`: Encrypted statement identifier from statement list API

#### Required Headers

**Note**: Same headers as statements API are required:

```
accept: application/json, text/plain, */*
content-type: application/json
token_type: SESSION_TOKEN
x-hsbc-channel-id: OHI
x-hsbc-chnl-countrycode: US
x-hsbc-chnl-group-member: HBUS
x-hsbc-jsc-data: <device fingerprint data>
x-hsbc-locale: en_US
x-hsbc-client-id: 8c29df47a6e18b35c94720e63fa18d5b
x-hsbc-global-channel-id: WEB
x-hsbc-source-system-id: 7382915
cookie: <all session cookies>
```

#### Response Structure

The response is a direct PDF file download with `Content-Type: application/pdf`.

**Account Types**: This API works for all account types (Checking, Savings). The same endpoint format is used regardless of account type.

**Parameter Sources**:

- `statementIdentifier`: From statement list API response (`statementIdentifier` field)

### API Call Flow for Statement Download

1. Call account list API → get `accountIdentifierIndex`
2. Call statement list API with `accountIdentifierIndex` → get `statementIdentifier`
3. Call statement file API with `statementIdentifier` → download PDF

## Important Notes

### Device Fingerprinting

HSBC uses device fingerprinting through the `x-hsbc-jsc-data` header. This header contains:

- Browser information
- Device characteristics
- Session-specific data

The value changes with each request and appears to be generated client-side by JavaScript.

### Token Expiration

- The `dxp-pep-token` JWT includes `exp` (expiration) claim
- Session timeout is typically 600 seconds (10 minutes) of inactivity based on `session-idle-hint` cookie
- Total session duration is typically around 10 minutes based on `session-expiry-hint` cookie

### Security Considerations

- All cookies use `Secure` and `HttpOnly` flags
- Cross-Site Request Forgery (CSRF) protection through custom headers
- Device fingerprinting for additional security layer
- Encrypted identifiers prevent direct account/statement access

### API Error Handling

All APIs return standard HTTP status codes:

- 200: Success
- 401: Unauthorized (session expired)
- 403: Forbidden (insufficient permissions)
- 404: Not Found
- 500: Internal Server Error

## Sample Request/Response

### Account List API

**Request**:

```http
GET /api/dcc-us-hbus-account-list-papi-prod-proxy/v3/accounts/domestic?eligibilityType=estatements HTTP/2.0
Host: www.us.hsbc.com
accept: application/json, text/plain, */*
content-type: application/json
token_type: SESSION_TOKEN
x-hsbc-channel-id: OHI
x-hsbc-chnl-countrycode: US
x-hsbc-chnl-group-member: HBUS
x-hsbc-locale: en_US
cookie: dspSession=...; dxp-pep-token=...; HSBC_BROWSER_COOKIE=...
```

**Response**:

```json
{
  "accounts": [
    {
      "accountIdentifier": {
        "accountIdentifierIndex": "RWxYSk5DU0hTQkpIZ12Wt8MYFzT5fhXfb5v...",
        "normalisedProductCategoryCode": "CHQ"
      },
      "accountDisplay": "739284651",
      "productDescription": "HSBC Premier",
      "availableBalance": {
        "currency": "USD",
        "amount": "1.00"
      }
    }
  ]
}
```

### Statement List API

**Request**:

```http
GET /api/mmf-files-statements--us-hbus-prod-proxy/v1/customer-accounts/RWxYSk5DU0hTQkpIZ12Wt8MYFzT5fhXfb5v.../statements?documentType=BOTH HTTP/2.0
Host: www.us.hsbc.com
accept: application/json, text/plain, */*
content-type: application/json
token_type: SESSION_TOKEN
x-hsbc-channel-id: OHI
x-hsbc-chnl-countrycode: US
x-hsbc-chnl-group-member: HBUS
x-hsbc-locale: en_US
cookie: dspSession=...; dxp-pep-token=...; HSBC_BROWSER_COOKIE=...
```

**Response**:

```json
{
  "statements": [
    {
      "statementDate": "2025-10-29",
      "accountNumber": "739284651",
      "statementType": "REGULAR",
      "statementIdentifier": "RWxYSk5DU0hTQkpIZ2VB7dKDYx0MlF5Y7wZYFS8UH3KZ2X__..."
    }
  ]
}
```

### Statement Download API

**Request**:

```http
GET /api/mmf-files-statements--us-hbus-prod-proxy/v1/statements/RWxYSk5DU0hTQkpIZ2VB7dKDYx0MlF5Y7wZYFS8UH3KZ2X__... /statement-files HTTP/2.0
Host: www.us.hsbc.com
accept: application/json, text/plain, */*
token_type: SESSION_TOKEN
x-hsbc-channel-id: OHI
x-hsbc-chnl-countrycode: US
x-hsbc-chnl-group-member: HBUS
x-hsbc-locale: en_US
cookie: dspSession=...; dxp-pep-token=...; HSBC_BROWSER_COOKIE=...
```

**Response**: Binary PDF file with `Content-Type: application/pdf`
