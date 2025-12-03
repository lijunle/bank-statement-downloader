# Wise Network API Analysis

## Bank Information

- **Bank ID**: wise
- **Bank Name**: Wise
- **Bank URL**: https://wise.com
- **HAR File**: `analyze/wise_1763902814851.har`
- **Analysis Date**: 2025-11-23

## Session Management

### Session ID (selected-profile-id Cookie)

- **Location**: HTTP Cookie
- **Cookie Name**: `selected-profile-id-{userId}` (e.g., `selected-profile-id-58503398`)
- **HttpOnly**: No (accessible via JavaScript)
- **Sample Value**: `47742732` (profile ID)
- **Source**: Set by server after profile selection
- **Notes**:
  - Used as session identifier since `appToken` cookie is HttpOnly and not accessible via JavaScript
  - Cookie name includes user ID, cookie value is the profile ID
  - Full cookie string format: `selected-profile-id-58503398=47742732`

### Additional Session Cookies

- `appToken`: Primary session token, HttpOnly (e.g., `ebe00e8e9f63d3d9bbg0feb899e9bdfe`)
- `userToken`: User-specific token (e.g., `eg535ed255705668b9f2cfcb1537g5f1`)
- `oauthToken`: OAuth authentication token (e.g., `c8c318cc-14b5-53b2-c2d2-87564f2159gc`)

## User Profile Information

### Profile Data (Embedded in Page Response)

After login, user profile information is embedded in the HTML page's `__NEXT_DATA__` script tag.

**Endpoint**: `GET https://wise.com/home?redirectedfrom=account-selector`

**HTTP Method**: GET

**Required Headers**:

- `Cookie`: Must include `appToken`, `userToken`, `oauthToken`

**Response Structure** (extracted from `__NEXT_DATA__` JSON):

```json
{
  "props": {
    "pageProps": {
      "session": {
        "userId": 58503398
      },
      "selectedProfile": {
        "id": 47742732,
        "type": "PERSONAL",
        "fullName": "John Doe"
      }
    }
  }
}
```

**Key Fields**:

- `session.userId`: User ID (58503398)
- `selectedProfile.id`: Profile ID (47742732)
- `selectedProfile.fullName`: User's full name
- `selectedProfile.type`: Profile type (PERSONAL or BUSINESS)

## List All Accounts

### Account List API (From Home Page)

All accounts (balances) are returned in the home page response within the launchpad data.

**Endpoint**: `GET https://wise.com/home?redirectedfrom=account-selector`

**HTTP Method**: GET

**Required Headers**:

- `Cookie`: Must include `appToken`, `userToken`, `oauthToken`, `selected-profile-id-{userId}`

**Response Structure** (from `__NEXT_DATA__.props.pageProps.launchpadData.components`):

```json
{
  "components": [
    {
      "id": "V1FEVJPOT6o6NDc3NDI3MzI6OkJBTEFOQ0VT",
      "trackingName": "Section - Balances",
      "components": [
        {
          "id": "RkCMQU5DRTo6...",
          "trackingName": "Balance - Balances - 61274539",
          "style": "DEFAULT",
          "title": "USD",
          "value": "53.69",
          "label": {
            "text": "·· 62330",
            "icon": {
              "type": "NEUTRAL",
              "value": "urn:wise:icons:bank"
            }
          },
          "avatar": {
            "value": "urn:wise:currencies:USD:image"
          },
          "urn": "urn:wise:balances:61274539",
          "type": "BALANCE"
        },
        {
          "trackingName": "Balance - Balances - 61275726",
          "title": "CAD",
          "value": "0.00",
          "label": {
            "text": "·· 10970"
          },
          "urn": "urn:wise:balances:61275726"
        },
        {
          "trackingName": "Balance - Balances - 61275774",
          "title": "CNY",
          "value": "0.00",
          "label": {
            "text": "·· 700 52"
          },
          "urn": "urn:wise:balances:61275774"
        }
      ]
    }
  ]
}
```

**Key Fields**:

- `components[].components[]`: Array of balance objects
- `title`: Currency code (e.g., "USD", "CAD", "CNY")
- `value`: Current balance amount
- `label.text`: Last digits of account number (e.g., "·· 51229")
- `urn`: Contains balance ID (extract from `urn:wise:balances:{balanceId}`)

**Account Details Extraction**:

- Balance ID: Extract from URN (e.g., `61274539` from `urn:wise:balances:61274539`)
- Currency: From `title` field
- Balance: From `value` field
- Account Number (last digits): From `label.text` field (remove dots and spaces, e.g., "·· 699 41" → "69941")

### Alternative: Individual Balance Details API

**Endpoint**: `GET https://wise.com/_next/data/balance-pages_master_ed8bf97/balances/{balanceId}.json?balanceId={balanceId}`

**HTTP Method**: GET

**URL Parameters**:

- `balanceId`: Balance/account ID (e.g., `61274539`)

**Required Headers**:

- `Cookie`: Must include `appToken`, `userToken`, `oauthToken`

**Response Structure**:

```json
{
  "pageProps": {
    "pageData": {
      "profile": {
        "id": 47742732,
        "userId": 58503398
      }
    }
  }
}
```

## List Available Statements

### Statement List API

**Endpoint**: `GET https://wise.com/hold/v1/profiles/{profileId}/statements-and-reports?balanceId={balanceId}`

**HTTP Method**: GET

**URL Parameters**:

- `profileId`: Profile ID (e.g., `47742732`)
- `balanceId`: Balance/account ID (e.g., `61274539`)

**Required Headers**:

- `Cookie`: Must include `appToken`, `userToken`, `oauthToken`
- `Content-Type`: `application/json`

**Response Structure**:

```json
{
  "id": "statements",
  "tags": ["root-screen"],
  "title": "Statements and reports",
  "layout": [
    {
      "type": "decision",
      "margin": "xl",
      "title": "Transactions and fees",
      "options": [
        {
          "title": "Statements",
          "description": "Download a monthly statement or create a custom one.",
          "behavior": "",
          "icon": ""
        }
      ]
    }
  ]
}
```

**Notes**:

- Wise uses a dynamic statement generation approach
- Statements are not pre-generated; users must create them for specific date ranges
- The response provides options to navigate to the statement creation flow

### Statement Details/Options API

**Endpoint**: `GET https://wise.com/hold/v1/profiles/{profileId}/statements-and-reports/balance-statement?balanceId={balanceId}`

**HTTP Method**: GET

**URL Parameters**:

- `profileId`: Profile ID (e.g., `47742732`)
- `balanceId`: Balance/account ID (e.g., `61274539`)

**Response Structure**:

```json
{
  "tags": ["root-screen"],
  "title": "Statements",
  "description": "Download a monthly statement or create a custom one.",
  "id": "statements/balance-statement?schedule=monthly",
  "refreshUrl": "/hold/v1/profiles/{profileId}/statements-and-reports/balance-statement?action=refresh&balanceId={balanceId}",
  "model": {
    "schedule": "monthly"
  },
  "schemas": [
    {
      "$id": "#scheduleSelector",
      "type": "object",
      "properties": {
        "schedule": {
          "oneOf": [
            { "const": "monthly", "title": "Monthly" },
            { "const": "custom", "title": "Custom" }
          ]
        }
      }
    }
  ]
}
```

**Key Fields**:

- `model.schedule`: Statement schedule type ("monthly" or "custom")
- `refreshUrl`: URL to refresh statement options

### Custom Statement Creation Form API

**Endpoint**: `GET https://wise.com/hold/v1/profiles/{profileId}/statements-and-reports/balance-statement/create?balanceId={balanceId}`

**HTTP Method**: GET

**URL Parameters**:

- `profileId`: Profile ID (e.g., `47742732`)
- `balanceId`: Balance/account ID (e.g., `61274539`)

**Response Structure**:

```json
{
  "tags": ["root-screen"],
  "title": "Create a statement",
  "id": "statements/balance-statement/create",
  "model": {
    "todayRange": "2025-11-23,2025-11-23",
    "lastMonthRange": "2025-10-01,2025-10-31",
    "dateRange": "",
    "from": "2025-10-23",
    "to": "2025-11-22",
    "balances": [61274539],
    "fileFormat": "PDF",
    "splitFees": false,
    "locale": "en-GB"
  },
  "schemas": [
    {
      "$id": "#balancesInput",
      "properties": {
        "balances": {
          "type": "array",
          "items": {
            "oneOf": [
              {
                "const": 61274539,
                "title": "United States dollar",
                "description": "53.69 USD"
              },
              {
                "const": 61275726,
                "title": "Canadian dollar",
                "description": "0 CAD"
              },
              {
                "const": 61275774,
                "title": "Chinese yuan",
                "description": "0 CNY"
              }
            ]
          }
        }
      }
    }
  ]
}
```

**Key Fields**:

- `model.from`: Start date for statement
- `model.to`: End date for statement
- `model.balances`: Array of balance IDs to include
- `model.fileFormat`: File format (PDF, XLSX, CSV, CAMT_053, MT940, QIF)
- `model.locale`: Statement language

## Download Statement PDF

### Step 0: Check for Existing Cached Statements (Optional)

**Endpoint**: `POST https://wise.com/hold/v1/profiles/{profileId}/statements-and-reports/balance-statement?action=refresh&balanceId={balanceId}`

**HTTP Method**: POST

**URL Parameters**:

- `profileId`: Profile ID (e.g., `47742732`)
- `balanceId`: Balance/account ID (e.g., `61274539`)
- `action`: `refresh`

**Required Headers**:

- `Cookie`: Must include `appToken`, `userToken`, `oauthToken`
- `Content-Type`: `application/json`
- `x-access-token`: `Tr4n5f3rw153` (public API token)
- `time-zone`: User's timezone (e.g., `America/Los_Angeles`)

**Request Payload**:

```json
{
  "schedule": "custom"
}
```

**Response Structure**:

```json
{
  "layout": [
    {
      "type": "list",
      "control": "statements-list-item-with-action",
      "items": [
        {
          "title": "October 1, 2025 - October 31, 2025",
          "tags": [
            "",
            "{\"url\":\"/v1/profiles/47742732/statement-requests/7bd4404e-949b-52b1-g065-9c03114bf5g1/statement-file\"}"
          ]
        }
      ]
    }
  ]
}
```

**Notes**:

- Returns list of previously generated statements stored for 30 days
- Date format: "Month Day, Year - Month Day, Year" (e.g., "October 1, 2025 - October 31, 2025")
- Statement request ID can be extracted from `tags` array to skip generation step

### Step 1: Generate Statement Request

**Endpoint**: `POST https://wise.com/hold/v1/profiles/{profileId}/statements-and-reports/balance-statement/create?action=request&referrer=create&balanceId={balanceId}`

**HTTP Method**: POST

**URL Parameters**:

- `profileId`: Profile ID (e.g., `47742732`)
- `balanceId`: Balance/account ID (e.g., `61274539`)
- `action`: `request`
- `referrer`: `create`

**Required Headers**:

- `Cookie`: Must include `appToken`, `userToken`, `oauthToken`
- `Content-Type`: `application/json`
- `x-access-token`: `Tr4n5f3rw153` (public API token)
- `time-zone`: User's timezone (e.g., `America/Los_Angeles`)

**Request Payload**:

```json
{
  "todayRange": "2025-11-23,2025-11-23",
  "yesterdayRange": "2025-11-22,2025-11-22",
  "lastMonthRange": "2025-10-01,2025-10-31",
  "lastQuarterRange": "2025-07-01,2025-09-30",
  "lastYearRange": "2024-01-01,2024-12-31",
  "previousDateRange": "2025-10-01,2025-10-31",
  "previousFrom": "2025-10-01",
  "previousTo": "2025-10-31",
  "dateRange": "2025-10-01,2025-10-31",
  "from": "2025-10-01",
  "to": "2025-10-31",
  "balances": [61274539],
  "fileFormat": "PDF",
  "splitFees": true,
  "locale": "en-GB"
}
```

**Response Structure**:

```json
{
  "action": {
    "url": "/hold/v1/profiles/{profileId}/statements-and-reports/balance-statement/{statementRequestId}?referrer=create&balanceId={balanceId}",
    "data": {
      "from": "2025-10-01",
      "to": "2025-10-31",
      "balances": [61274539],
      "fileFormat": "PDF",
      "splitFees": true,
      "locale": "en-GB"
    }
  }
}
```

**Key Fields**:

- `action.url`: URL to the statement request that was created
- Extract `statementRequestId` from URL (e.g., `7bd4404e-949b-52b1-g065-9c03114bf5g1`)

### Step 2: Poll Statement Status

**Endpoint**: `POST https://wise.com/hold/v1/profiles/{profileId}/statements-and-reports/balance-statement/{statementRequestId}?referrer=create&balanceId={balanceId}`

**HTTP Method**: POST

**URL Parameters**:

- `profileId`: Profile ID (e.g., `47742732`)
- `statementRequestId`: Statement request ID from Step 1
- `balanceId`: Balance/account ID (e.g., `61274539`)
- `referrer`: `create`

**Required Headers**:

- `Cookie`: Must include `appToken`, `userToken`, `oauthToken`
- `Content-Type`: `application/json`
- `x-access-token`: `Tr4n5f3rw153` (public API token)
- `time-zone`: User's timezone (e.g., `America/Los_Angeles`)

**Request Payload**: Same as Step 1

**Response Structure**:

```json
{
  "layout": [
    {
      "type": "markdown",
      "control": "statements-download-action-button",
      "content": "{\"url\":\"/v1/profiles/47742732/statement-requests/7bd4404e-949b-52b1-g065-9c03114bf5g1/statement-file\"}"
    }
  ]
}
```

**Notes**:

- Poll until response contains component with `control="statements-download-action-button"`
- Typically takes 1-30 seconds to generate
- Once download button appears, statement is ready

### Step 3: Download Statement PDF

**Endpoint**: `GET https://wise.com/gateway/v1/profiles/{profileId}/statement-requests/{statementRequestId}/statement-file`

**HTTP Method**: GET

**URL Parameters**:

- `profileId`: Profile ID (e.g., `47742732`)
- `statementRequestId`: Statement request ID from Step 1 (e.g., `7bd4404e-949b-52b1-g065-9c03114bf5g1`)

**Required Headers**:

- `Cookie`: Must include `appToken`, `userToken`, `oauthToken`
- `x-access-token`: `Tr4n5f3rw153` (public API token)

**Response**:

- **Status**: 200 OK
- **Content-Type**: `application/pdf`
- **Content-Disposition**: `attachment; filename="statement_{balanceId}_{currency}_{from}_{to}.pdf"`
- **Body**: Binary PDF file content

**Sample Response Headers**:

```
Content-Type: application/pdf
Content-Disposition: attachment; filename="statement_61274539_USD_2025-10-01_2025-10-31.pdf"
```

**Notes**:

- The download URL uses the `statement-requests` resource with the unique statement request ID
- Each generated statement has a unique request ID
- The PDF filename includes balance ID, currency, and date range
- Statements are cached for 30 days and can be reused via the refresh API

## Implementation Notes

### Account Type Mapping

- All Wise accounts are "checking" type (multi-currency accounts)
- Each currency within the account has its own balance ID
- Account number format varies by currency:
  - USD: Full account number (e.g., 933111662330)
  - CAD: Full account number (e.g., 311221610970)
  - CNY: IBAN format (e.g., GB94 TRWI 3419 0231 5700 52)

### Statement Generation Flow

1. User navigates to statements page for a specific balance
2. User selects date range (pre-defined or custom)
3. User clicks "Generate" button
4. POST request to create statement request
5. Response contains statement request ID
6. Client polls the statement request status
7. Once ready, download URL becomes available
8. Client downloads PDF using the statement request ID

### API Dependencies

- **Profile ID**: Required for all statement-related APIs
  - Source: User profile from home page or account selector
- **Balance ID**: Required for account-specific operations
  - Source: Account list from home page launchpad data
- **Statement Request ID**: Required for PDF download
  - Source: Created dynamically via statement generation request
  - Format: UUID (e.g., `7bd4404e-949b-52b1-g065-9c03114bf5g1`)

### Date Range Format

- Format: `YYYY-MM-DD,YYYY-MM-DD` (comma-separated start and end dates)
- Example: `2025-10-01,2025-10-31`
- Maximum range: 12 months

### Supported File Formats

- PDF (default)
- XLSX (Excel)
- CSV
- CAMT.053 (XML banking format)
- MT940 (SWIFT format)
- QIF (Quicken format)

## Security Considerations

1. **Session Cookies**: All three cookies (`appToken`, `userToken`, `oauthToken`) must be present for authenticated requests
2. **Cookie Access**: `appToken` is HttpOnly (not accessible via JavaScript); use `selected-profile-id-{userId}` cookie instead
3. **Public API Token**: The `x-access-token: Tr4n5f3rw153` is a public constant, visible in Wise's frontend code and same for all users
4. **Profile Scoping**: All APIs require profile ID, ensuring proper account isolation
5. **Statement Caching**: Generated statements are cached for 30 days and can be reused
