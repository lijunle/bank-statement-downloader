# Disnat (Desjardins Online Brokerage) - Network API Analysis

**Bank ID**: disnat  
**Bank Name**: Disnat (Desjardins Courtage en ligne / Desjardins Online Brokerage)  
**Bank URL**: https://www.disnat.com/  
**Primary Domain**: https://tmw.secure.vmd.ca/  
**Analysis Date**: November 19, 2025

## Session ID

### Authentication Cookies

After successful login and 2FA verification, the following session cookies are set:

- **JSESSIONID**: Server session identifier

  - **HttpOnly**: Yes (accessible via JavaScript: No)
  - **Secure**: Yes
  - **Path**: /s9web
  - **SameSite**: Lax
  - **Example**: `JSESSIONID=7F4A2E91B8C63D5F09E1C7A8420B3D61`

- **XSRF-TOKEN**: Cross-Site Request Forgery protection token
  - **HttpOnly**: No (accessible via JavaScript: Yes)
  - **Secure**: Yes
  - **Path**: /s9web
  - **SameSite**: Lax
  - **Example**: `XSRF-TOKEN=a842f91e-6c38-4b72-9d1a-e58fc2b73d96`

### Additional Session Cookies

- **org.springframework.web.servlet.i18n.CookieLocaleResolver.LOCALE**: User language preference (en/fr)
- **referer**: Set to "disnat" to track referrer

**Note**: JSESSIONID is HttpOnly and cannot be accessed via JavaScript. Browser-based automation or cookie extraction from browser storage would be needed.

---

## 1. Retrieve User Profile Information

### API Endpoint

**URL**: `https://tmw.secure.vmd.ca/s9web/secure/demographics`

**Method**: GET

### Request Details

**Query Parameters**:

- `_`: Timestamp for cache busting (e.g., `1763550740786`)

**Required Headers**:

```
Cookie: JSESSIONID={session_id}; XSRF-TOKEN={xsrf_token}; org.springframework.web.servlet.i18n.CookieLocaleResolver.LOCALE=en
Accept: application/json, text/plain, */*
Accept-Language: en-US,en;q=0.9
```

**No additional parameters required** - Uses session cookies for authentication.

### Response Structure

**Status**: 200 OK

**Content-Type**: application/json

**Response Schema**:

```json
{
  "status": "OK",
  "payload": {
    "demographics": {
      "self": {
        "firstName": "JOHN",
        "lastName": "DOE",
        "language": "EN",
        "tradingPlatformAllowed": false
      },
      "emailAddress": "JOHN.DOE@EXAMPLE.COM",
      "homeAddress": {
        "addr1": "MR JOHN DOE",
        "addr2": "123 MAIN ST",
        "city": "ANYTOWN USA  12345"
      },
      "emergencyPhone": {
        "number": "123 456-7890",
        "ext": ""
      },
      "referenceClientDemographicsJson": {
        "clientType": "INDIVIDU",
        "sexCode": "M",
        "clientCode": "8K7NR",
        "businessLineCode": "DC",
        "age": 35,
        "accountRepresentativeCode": "ML01",
        "accountPrivilegePlan": "REGULIER",
        "remunerationClient": "COMMISSION"
      },
      "numberOfDependents": 0
    }
  }
}
```

**Important Fields**:

- `payload.demographics.self.firstName`: User's first name
- `payload.demographics.self.lastName`: User's last name
- `payload.demographics.emailAddress`: Email address
- `payload.demographics.referenceClientDemographicsJson.clientCode`: Client ID (e.g., "8K7NR")

---

## 2. List All Accounts

### API Endpoint

**URL**: `https://tmw.secure.vmd.ca/s9web/secure/web-api/v2/portfolio/group/{groupId}`

**Method**: GET

### Request Details

**Path Parameters**:

- `groupId`: Group/client identifier (e.g., `8K7NRDC`)
  - **Source**: Constructed from client code + "DC" suffix
  - **Example**: For client "8K7NR", groupId is "8K7NRDC"

**Required Headers**:

```
Cookie: JSESSIONID={session_id}; XSRF-TOKEN={xsrf_token}
Accept: application/json, text/plain, */*
X-Requested-With: XMLHttpRequest
```

**Dependency**: Requires `clientCode` from demographics API (step 1)

### Response Structure

**Status**: 200 OK

**Content-Type**: application/json

**Response Schema**:

**Note**: The response is returned directly without `status` and `payload` wrapper fields.

```json
{
  "referenceClientId": "8K7NR",
  "clients": [
    {
      "clientId": "8K7NR",
      "accounts": [
        {
          "accountId": "8K7NRA2",
          "accountType": "CASH",
          "primaryCurrency": "CAD",
          "accountStatusCode": "OPEN",
          "isRegistered": false,
          "accountBundleCode": "CSH_CAD",
          "constituentAccountIds": ["8K7NRA2"],
          "balances": [
            {
              "accountNumber": "8K7NRA2",
              "currency": "CAD",
              "summary": {
                "cash": 4843.35,
                "securities": 3728.4,
                "total": 8571.75,
                "marginSOD": 2609.88,
                "marginRT": 0,
                "change": 0.0,
                "reserve": 0
              }
            }
            ],
            "positionBundles": [
              {
                "primaryCurrency": "CAD",
                "assetType": "EQUITY",
                "positions": [
                  {
                    "symbol": "ZST.L-C",
                    "accountId": "8K7NRA2",
                    "quantity": 60.0,
                    "averagePrice": 62.063,
                    "marketValue": 3728.4
                  }
                ]
              }
            ]
          },
          {
            "accountId": "8K7NRB0",
            "accountType": "CASH",
            "primaryCurrency": "USD",
            "accountStatusCode": "OPEN",
            "balances": [
              {
                "accountNumber": "8K7NRB0",
                "currency": "USD",
                "summary": {
                  "cash": 8.8,
                  "securities": 0,
                  "total": 8.8
                }
              }
            ]
          }
        ]
      }
    ]
  }
}
```

**Important Fields**:

- `referenceClientId`: Reference client identifier
- `clients[].clientId`: Client identifier
- `clients[].accounts[]`: Array of account objects
- `clients[].accounts[].accountId`: Account identifier (e.g., "8K7NRA2")
- `clients[].accounts[].accountType`: Account type (CASH, MARGIN, etc.)
- `clients[].accounts[].primaryCurrency`: Account currency (CAD, USD)
- `clients[].accounts[].balances[].accountNumber`: Account number (may be empty for some account types)
- `clients[].accounts[].balances[].summary`: Account balance details

**Implementation Note**: Unlike the demographics API, this endpoint returns data directly without `status` and `payload` wrapper. Access the data via `response.clients` instead of `response.payload.clients`.

---

## 3. List Available Statements

### API Endpoint

**URL**: `https://tmw.secure.vmd.ca/s9web/secure/web-api/v2/documents/info/clients`

**Method**: GET

### Request Details

**Query Parameters**:

- `clientCodes`: Client code (e.g., `8K7NR`)
  - **Source**: From demographics API response (`referenceClientDemographicsJson.clientCode`)
- `fromDate`: Start date in YYYY-MM-DD format (e.g., `2024-11-19`)
  - **Source**: Calculate as 1 year before current date
- `toDate`: End date in YYYY-MM-DD format (e.g., `2025-11-19`)
  - **Source**: Current date
- `documentTypes`: Document type filter (can be repeated)
  - `ETATCOMPTE` - Account Statement
  - `RAP_PERF` - Performance Report
  - `RAP_FRAIS` - Charges and Other Compensation
  - `RPFEE_AM` - Fee Report

**Example URL**:

```
https://tmw.secure.vmd.ca/s9web/secure/web-api/v2/documents/info/clients?clientCodes=8K7NR&fromDate=2024-11-19&toDate=2025-11-19&documentTypes=ETATCOMPTE&documentTypes=RAP_PERF&documentTypes=RAP_FRAIS&documentTypes=RPFEE_AM
```

**Required Headers**:

```
Cookie: JSESSIONID={session_id}; XSRF-TOKEN={xsrf_token}
Accept: application/json, text/plain, */*
X-Requested-With: XMLHttpRequest
```

**Dependency**: Requires `clientCode` from demographics API

### Response Structure

**Status**: 200 OK

**Content-Type**: application/json

**Response Schema**:

```json
[
  {
    "date": "2025-10-31",
    "descriptions": ["DOE JOHN"],
    "id": "738264915",
    "token": "c729a4e1-8d53-4f16-ab82-7c96e1d34f58",
    "type": "ETATCOMPTE",
    "clientId": "8K7NR",
    "accountId": "",
    "version": "ORIGINAL"
  },
  {
    "date": "2025-09-30",
    "descriptions": ["DOE JOHN"],
    "id": "452917683",
    "token": "3b81d7a6-9e25-4c83-a617-52d8f9c40a73",
    "type": "ETATCOMPTE",
    "clientId": "8K7NR",
    "accountId": "",
    "version": "ORIGINAL"
  }
]
```

**Important Fields**:

- `date`: Statement date (YYYY-MM-DD format)
- `id`: Document ID (numeric, not used for download)
- `token`: Download token (UUID format, ephemeral, required for PDF download)
- `type`: Document type (ETATCOMPTE for account statements)
- `clientId`: Client identifier
- `accountId`: Account identifier (empty for client-level statements)

**Critical Implementation Notes**:

1. **Token Usage**: The `token` field (UUID format) must be used for downloading PDFs, not the `id` field.
2. **Token Lifespan**: Tokens are ephemeral and generated per API request. A fresh call to this endpoint is required before each download.
3. **Statement Identification**: Use the `token` as the `statementId` in the implementation since it's the required parameter for download.
4. **Validation**: Always verify that `doc.token` exists before processing a statement entry.

**Note**: This API returns statements for all account types under the client. The `accountId` field is empty for client-level consolidated statements.

---

## 4. Download Statement PDF

### API Endpoint

**URL**: `https://tmw.secure.vmd.ca/s9web/secure/web-api/v2/documents`

**Method**: GET

### Request Details

**Query Parameters**:

- `token`: Download token from statement list API
  - **Source**: From documents/info/clients response (`.token` field)
  - **Example**: `c729a4e1-8d53-4f16-ab82-7c96e1d34f58`

**Example URL**:

```
https://tmw.secure.vmd.ca/s9web/secure/web-api/v2/documents?token=c729a4e1-8d53-4f16-ab82-7c96e1d34f58
```

**Required Headers**:

```
Cookie: JSESSIONID={session_id}; XSRF-TOKEN={xsrf_token}
Accept: text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8
```

**Dependency**: Requires `token` from statement list API

### Response Structure

**Status**: 200 OK

**Content-Type**: application/pdf;charset=UTF-8

**Response Headers**:

```
Content-Disposition: inline;filename=8K7NR_ETATCOMPTE_2025-10-31.pdf
Content-Type: application/pdf;charset=UTF-8
Cache-Control: no-cache, no-store, max-age=0, must-revalidate
```

**Response Body**: Binary PDF file content

**Filename Pattern**: `{clientId}_ETATCOMPTE_{date}.pdf`

- Example: `8K7NR_ETATCOMPTE_2025-10-31.pdf`

**Important Response Headers**:

- `Content-Disposition`: Contains the suggested filename
- `Content-Type`: Always `application/pdf;charset=UTF-8`

**Note**: The download token is single-use and time-limited. Each statement requires fetching a fresh token from the list API before downloading.

---

## API Flow Summary

### Complete Workflow

1. **Authentication** → Obtain `JSESSIONID` and `XSRF-TOKEN` cookies
2. **Get User Profile** → `/s9web/secure/demographics` → Extract `clientCode`
3. **Calculate Group ID** → `groupId = clientCode + "DC"` (e.g., "8K7NR" → "8K7NRDC")
4. **List Accounts** → `/s9web/secure/web-api/v2/portfolio/group/{groupId}` → Get account details
5. **List Statements** → `/s9web/secure/web-api/v2/documents/info/clients` → Get statement list with tokens
6. **Download PDF** → `/s9web/secure/web-api/v2/documents?token={token}` → Download each statement

### Key Dependencies

```
Login → JSESSIONID, XSRF-TOKEN
  ↓
Demographics API → clientCode (e.g., "8K7NR")
  ↓
  ├→ Portfolio API (groupId = clientCode + "DC")
  └→ Documents List API (clientCodes parameter)
       ↓
       Download API (token from statement list)
```

### Important Notes

1. **Session Cookies**: `JSESSIONID` is HttpOnly (cannot be accessed via JavaScript directly)
2. **CSRF Protection**: `XSRF-TOKEN` must be included in request cookies
3. **Client Code Format**: Client codes appear to follow pattern like "5M2JZ" (5 alphanumeric characters)
4. **Group ID Construction**: Group ID is client code + "DC" suffix
5. **Statement Tokens**: Download tokens are ephemeral and obtained from the list API
6. **Date Format**: All dates use YYYY-MM-DD format
7. **Account Types**: Primarily CASH accounts, may also have MARGIN, RRSP, TFSA, etc.
8. **Document Types**:
   - `ETATCOMPTE` - Account Statement
   - `RAP_PERF` - Performance Report
   - `RAP_FRAIS` - Fee/Charges Report
   - `RPFEE_AM` - Annual Management Fee Report

---

## Sample Request/Response Examples

### Example 1: Get User Profile

**Request**:

```http
GET /s9web/secure/demographics?_=1763550740786 HTTP/1.1
Host: tmw.secure.vmd.ca
Cookie: JSESSIONID=7F4A2E91B8C63D5F09E1C7A8420B3D61; XSRF-TOKEN=a842f91e-6c38-4b72-9d1a-e58fc2b73d96
Accept: application/json
```

**Response**:

```json
{
  "status": "OK",
  "payload": {
    "demographics": {
      "self": {
        "firstName": "JOHN",
        "lastName": "DOE"
      },
      "referenceClientDemographicsJson": {
        "clientCode": "8K7NR"
      }
    }
  }
}
```

### Example 2: List Statements

**Request**:

```http
GET /s9web/secure/web-api/v2/documents/info/clients?clientCodes=8K7NR&fromDate=2024-11-19&toDate=2025-11-19&documentTypes=ETATCOMPTE HTTP/1.1
Host: tmw.secure.vmd.ca
Cookie: JSESSIONID=7F4A2E91B8C63D5F09E1C7A8420B3D61
Accept: application/json
```

**Response**:

```json
[
  {
    "date": "2025-10-31",
    "id": "738264915",
    "token": "c729a4e1-8d53-4f16-ab82-7c96e1d34f58",
    "type": "ETATCOMPTE",
    "clientId": "8K7NR"
  }
]
```

### Example 3: Download Statement PDF

**Request**:

```http
GET /s9web/secure/web-api/v2/documents?token=c729a4e1-8d53-4f16-ab82-7c96e1d34f58 HTTP/1.1
Host: tmw.secure.vmd.ca
Cookie: JSESSIONID=7F4A2E91B8C63D5F09E1C7A8420B3D61
Accept: application/pdf
```

**Response**:

```
HTTP/1.1 200 OK
Content-Type: application/pdf;charset=UTF-8
Content-Disposition: inline;filename=8K7NR_ETATCOMPTE_2025-10-31.pdf

[Binary PDF content]
```

---

## Verification Status

✅ **Session ID**: Confirmed - JSESSIONID and XSRF-TOKEN cookies in HAR  
✅ **User Profile API**: Confirmed - demographics endpoint returns user details  
✅ **Account List API**: Confirmed - portfolio/group endpoint returns accounts with balances  
✅ **Statement List API**: Confirmed - documents/info/clients returns statement list with tokens  
✅ **Download PDF API**: Confirmed - documents endpoint with token returns PDF file

All APIs have been verified against the network trace captured on November 19, 2025.

---

## Browser Extension Validation

**Validation Date**: November 19, 2025  
**Test User**: JOHN DOE (8K7NR)  
**Test Accounts**: 8K7NRA2 (CAD CASH), 8K7NRB0 (USD CASH)

### API Function Tests

✅ **getSessionId()** - Successfully retrieved XSRF-TOKEN cookie  
✅ **getProfile()** - Retrieved profile with clientCode 8K7NR and name "JOHN DOE"  
✅ **getAccounts()** - Retrieved 2 accounts (CAD and USD cash accounts)  
✅ **getStatements()** - Retrieved 5 monthly statements (June-October 2025)  
✅ **downloadStatement()** - Successfully downloaded PDF statements (144.37 KB)

### Implementation Notes

1. **Portfolio API Response Structure**: The portfolio API returns data directly without `status` and `payload` wrapper fields, unlike the demographics API.

2. **Statement Token Handling**: The download token from the documents API must be used as the `statementId` since tokens are ephemeral and required for PDF download.

3. **Account Identification**: Account numbers may be empty in balances array for some account types. Use `accountId` as fallback.

4. **Statement Date Range**: The implementation uses 1-year lookback period for statement retrieval.

All functions validated successfully in Chrome browser extension context.
