# PayPal Statement API Analysis

## Overview

This document analyzes the PayPal APIs used to retrieve user profile information, list accounts, retrieve statements, and download statement PDFs. PayPal uses a mix of REST APIs and GraphQL endpoints, with some data embedded in server-side rendered HTML. The system supports both PayPal balance account statements and PayPal credit card statements through different API endpoints.

**Validation Status**: ✅ **Fully Validated** (November 20, 2025)

All APIs have been successfully validated in browser testing with complete end-to-end functionality confirmed.

## Base URLs

- **Main Site**: `https://www.paypal.com/`
- **My Account**: `https://www.paypal.com/myaccount/`
- **Statements API**: `https://www.paypal.com/myaccount/statements/api/`
- **Credit Card GraphQL**: `https://www.paypal.com/myaccount/credit/rewards-card/graphql/`
- **Smart Chat**: `https://www.paypal.com/smartchat/`

## API Authentication

### Session ID Location

**Primary**: `localStorage.getItem('vf')` - Contains session token that works across all APIs  
**Fallback**: `sessionStorage.getItem('PP_NC')` - Alternative session identifier  
**Last Resort**: `TLTSID` cookie - Can be extracted from `document.cookie`

**Validation Result**: ✅ Successfully extracted session ID from localStorage 'vf'  
**Sample Session**: `bXRgqCN_jdOf4PKZ4IeMXac-LIqPwq6UQxtefOiq0uUu1ysnXzf3iylki_8wrl8A1oS6nGowXQ_LHiBU`

### Cookie Authentication

All APIs require authentication via session cookies. PayPal uses a complex multi-cookie authentication system. Key authentication cookies include:

- `nsid`: Primary session identifier (HttpOnly - not accessible via JavaScript)
- `x-pp-s`: Secondary session token for API access and request validation
- `id_token`: JWT identity token containing user claims and authentication data
- `cookie_check`: Cookie validation token (value: "yes") to verify cookie support
- `enforce_policy`: Security policy enforcement flag for additional security checks
- `login_email`: User's registered email address stored for session context
- `ts_c`: Session creation timestamp used for session expiration tracking
- `ts`: Current timestamp for request validation and replay attack prevention
- `l7_az`: Availability zone routing identifier for load balancing
- `LANG`: User language preference (e.g., "en_US") for localization

All API requests automatically include these cookies when using `credentials: 'include'`. Session expires after period of inactivity, typically requiring re-authentication through the PayPal login flow.

### CSRF Token (Credit Card APIs Only)

**Location**: Embedded in HTML at `/myaccount/credit/rewards-card/?source=FINANCIAL_SNAPSHOT`  
**Pattern**: `"_csrf":"<token_with_unicode_escapes>"`  
**Decoding Required**: Token contains unicode escapes (e.g., `\u002F` → `/`, `\u002B` → `+`)  
**Header**: Must be included as `x-csrf-token` in GraphQL requests  
**Validation Result**: ✅ Unicode decoding working correctly, CSRF token successfully used

## 1. User Profile Information

### API: Get User Profile from Chat Metadata

**Endpoint**: `GET /smartchat/chat-meta`

**HTTP Method**: GET

**Purpose**: Retrieves user profile information including first name. This is the only REST API endpoint that returns the user's name directly in JSON format. The endpoint is primarily used by PayPal's smart chat feature but provides useful profile data for account identification.

**Validation Result**: ✅ **PASS** - Successfully retrieved profile name "John"

**Request Headers**:

```
Accept: application/json
```

**Request Parameters**:

- `pageURI=/myaccount/summary` (optional, indicates current page context)
- `isNativeEnabled=undefined` (optional)

**Response Structure**:

```json
{
  "userInfo": {
    "firstName": "John"
  }
}
```

**Important Fields**:

- `userInfo.firstName`: User's first name as registered in PayPal account

**Notes**:

- This endpoint is used by the smart chat feature but contains useful profile data
- Uses automatic cookie authentication with `credentials: 'include'`
- Returns JSON response without requiring CSRF token
- The firstName value is useful for personalizing the user interface

## 2. List All Accounts

### API: Account List (Server-Side Rendered)

**Endpoint**: `GET /myaccount/summary`

**HTTP Method**: GET

**Purpose**: Displays all PayPal accounts, balances, and linked payment methods. Account data is server-side rendered in HTML, not provided via separate JSON API. The page includes JavaScript-embedded data that can be extracted.

**Validation Result**: ✅ **PASS** - Successfully detected 2 accounts:

1. **Balance Account**: "PayPal Balance (USD)" with mask "USD"
2. **Credit Card**: "PayPal Cashback World Mastercard" with mask "7324"

**Request Headers**:

```
Accept: text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8
```

**Response**: HTML page with embedded JavaScript containing account data

**Account Extraction Patterns**:

1. **Balance Account**: Always present, uses static ID `paypal_balance_usd`

2. **Credit Card Account ID** (try both patterns):

   - Pattern 1 (UUID format): `creditAccountId["\s:]+([0-9A-F-]{36})`
     - Example: `22FE-ED53-B5D4177B-8C52-FFCEG75E1E3E`
   - Pattern 2 (short format): `encryptedAccountNumber["\s:]+([A-Z0-9]+)`
     - Example: `TD03BGLFLFLY5`

3. **Credit Card Mask**: `••(\d{4})`

   - Example: `••7324` → mask "7324"

4. **Credit Card Name**: `"header"\s*:\s*"([^"]*PayPal[^"]*(?:Cashback|Credit)[^"]*)"`
   - Example: `"header":"PayPal Cashback World Mastercard ••7324"`
   - Result: "PayPal Cashback World Mastercard" (mask stripped)

**Available Account Types**:

1. **PayPal Balance Accounts**

   - Primary USD balance
   - Additional currency balances (CAD, EUR, GBP, AUD, etc.)
   - Business accounts (if applicable)
   - Each currency has separate balance tracking

2. **PayPal Credit Cards**
   - PayPal Cashback World Mastercard
   - Other PayPal-branded credit products
   - Includes credit limit, available credit, current balance

**Account Information Available**:

- Account names and types
- Current balances
- Available credit (for credit products)
- Last four digits of account/card numbers
- Account status (active, inactive, pending)

**Notes**:

- Account information must be extracted from HTML using regex patterns
- Credit card account IDs can be in UUID or short encrypted format - both must be supported
- Balance account is always present for logged-in users
- Credit card detection: check if `/myaccount/credit/rewards-card/` link exists in HTML

## 3. List Available Statements (PayPal Balance)

### API: Get Transaction Statement List

**Endpoint**: `GET /myaccount/statements/api/statements`

**HTTP Method**: GET

**Purpose**: Lists available monthly transaction statements for PayPal balance account for the past 3 years. These statements show all transactions, fees, and balance changes for the user's PayPal account.

**Validation Result**: ✅ **PASS** - Retrieved 25 statements (October 2023 to October 2025)

**Request Headers**:

```
Accept: application/json
```

**Request Parameters**: None required

**Response Structure**:

```json
{
  "data": {
    "statements": [
      {
        "year": "2025",
        "details": [
          {
            "month": "October",
            "date": "20251001",
            "title": "October",
            "monthNumber": 10,
            "year": "2025"
          },
          {
            "month": "September",
            "date": "20250901",
            "title": "September",
            "monthNumber": 9,
            "year": "2025"
          },
          {
            "month": "August",
            "date": "20250801",
            "title": "August",
            "monthNumber": 8,
            "year": "2025"
          }
        ]
      },
      {
        "year": "2024",
        "details": [
          {
            "month": "December",
            "date": "20241201",
            "title": "December",
            "monthNumber": 12,
            "year": "2024"
          }
        ]
      },
      {
        "year": "2023",
        "details": [...]
      }
    ]
  }
}
```

**Important Fields**:

- `data.statements[]`: Array of statement years
- `year`: Statement year (string format)
- `details[]`: Array of available statements for that year
- `date`: Statement identifier in format YYYYMMDD (used for download API)
- `month`: Month name (e.g., "October")
- `monthNumber`: Numeric month 1-12
- `title`: Display title (typically same as month name)

**Notes**:

- Statements available for up to 3 years of transaction history
- Each month has one statement if there was any account activity
- The `date` field is used as the identifier when downloading statements
- Months without activity may not have statements available

## 4. List Available Statements (Credit Card)

### API: Get Credit Card Statement Headers (GraphQL)

**Endpoint**: `POST /myaccount/credit/rewards-card/graphql/Web_CONSUMER_REWARDS_US_Hub_StatementHeaders`

**HTTP Method**: POST

**Purpose**: Lists available billing statements for PayPal Cashback World Mastercard or other PayPal-branded credit cards. Returns statement headers with dates and balances.

**Validation Result**: ✅ **PASS** - Retrieved 20 statements (November 2023 to September 2025)

**Request Headers**:

```
Content-Type: application/json
Accept: application/json
x-csrf-token: <decoded_csrf_token>
```

**IMPORTANT**: The `x-csrf-token` header is **required** and must contain a unicode-decoded CSRF token extracted from the credit card page HTML.

**Request Body**:

```json
{
  "operationName": "Web_CONSUMER_REWARDS_US_Hub_StatementHeaders",
  "variables": {
    "creditAccountId": "22FE-ED53-B5D4177B-8C52-FFCEG75E1E3E",
    "creditProductIdentifier": "CREDIT_CARD_PAYPAL_CONSUMER_REWARDS_US"
  },
  "query": "query Web_CONSUMER_REWARDS_US_Hub_StatementHeaders($creditAccountId: CreditAccountId!, $creditProductIdentifier: CreditProductIdentifier!) {\n  revolvingCreditStatementHeaders(\n    creditProductIdentifier: $creditProductIdentifier\n    creditAccountId: $creditAccountId\n  ) {\n    statementHeaders {\n      statementId\n      formattedStartDate {\n        formattedDateString\n        formattedDateStringLong\n        formattedDateYear\n        formattedDateMonthDayShort\n        __typename\n      }\n      formattedClosingDate {\n        formattedDateString\n        formattedDateStringLong\n        formattedDateYear\n        formattedDateMonthDayShort\n        __typename\n      }\n      formattedTotalBalance {\n        formattedCurrency\n        __typename\n      }\n      changeInTerms\n      __typename\n    }\n    __typename\n  }\n}\n"
}
```

**Parameter Sources**:

- `creditAccountId`: Retrieved from page context when viewing credit card details at `/myaccount/credit/rewards-card/hub`. This is a UUID-format identifier specific to the user's credit card account.
- `creditProductIdentifier`: Static value `CREDIT_CARD_PAYPAL_CONSUMER_REWARDS_US` for PayPal Cashback Mastercard. May differ for other credit products.

**Response Structure**:

```json
{
  "data": {
    "revolvingCreditStatementHeaders": {
      "statementHeaders": [
        {
          "statementId": "2025-09-09",
          "formattedStartDate": {
            "formattedDateString": "8/11/2025",
            "formattedDateStringLong": "August 11, 2025",
            "formattedDateYear": "2025",
            "formattedDateMonthDayShort": "Aug 11",
            "__typename": "FormattedDate"
          },
          "formattedClosingDate": {
            "formattedDateString": "9/9/2025",
            "formattedDateStringLong": "September 9, 2025",
            "formattedDateYear": "2025",
            "formattedDateMonthDayShort": "Sep 9",
            "__typename": "FormattedDate"
          },
          "formattedTotalBalance": {
            "formattedCurrency": "$0.47",
            "__typename": "FormattedCurrency"
          },
          "changeInTerms": false,
          "__typename": "RevolvingCreditStatementHeader"
        },
        {
          "statementId": "2025-08-11",
          "formattedStartDate": {
            "formattedDateString": "7/10/2025",
            "formattedDateStringLong": "July 10, 2025",
            "formattedDateYear": "2025",
            "formattedDateMonthDayShort": "Jul 10",
            "__typename": "FormattedDate"
          },
          "formattedClosingDate": {
            "formattedDateString": "8/11/2025",
            "formattedDateStringLong": "August 11, 2025",
            "formattedDateYear": "2025",
            "formattedDateMonthDayShort": "Aug 11",
            "__typename": "FormattedDate"
          },
          "formattedTotalBalance": {
            "formattedCurrency": "$125.83",
            "__typename": "FormattedCurrency"
          },
          "changeInTerms": false,
          "__typename": "RevolvingCreditStatementHeader"
        }
      ],
      "__typename": "RevolvingCreditStatementHeaders"
    }
  }
}
```

**Important Fields**:

- `statementHeaders[]`: Array of available statement headers
- `statementId`: Statement identifier in format YYYY-MM-DD (closing date, used for download)
- `formattedStartDate`: Statement billing period start date
- `formattedClosingDate`: Statement billing period end date
- `formattedTotalBalance.formattedCurrency`: Statement balance (e.g., "$0.47")
- `changeInTerms`: Boolean indicating if credit terms changed in this statement period

**Notes**:

- GraphQL API requires specific operation name in request
- The `statementId` uses the closing date and is required for downloading the statement PDF
- Credit account ID must be obtained from page context before calling this API
- Different credit products may require different `creditProductIdentifier` values

## 5. Download Statement (PayPal Balance)

### API: Download Transaction Statement PDF

**Endpoint**: `GET /myaccount/statements/download`

**HTTP Method**: GET

**Purpose**: Downloads monthly transaction statement as PDF file. The statement includes all PayPal balance account transactions, fees, and balance changes for the specified month.

**Validation Result**: ✅ **PASS** - Downloaded 267,999 bytes PDF for October 2025

**Request Headers**:

```
Accept: application/octet-stream, application/pdf
```

**Query Parameters**:

- `monthList`: Statement date identifier in format YYYYMMDD (e.g., `20251001` for October 2025)
- `reportType`: Statement type, use `standard` for regular monthly statements

**Example URL**:

```
https://www.paypal.com/myaccount/statements/download?monthList=20251001&reportType=standard
```

**Response**:

- Content-Type: `application/pdf`
- Content-Disposition: `attachment; filename="statement-Oct-2025.pdf"`
- Binary PDF file content
- File size: Typically 100-500 KB depending on transaction volume

**Parameter Sources**:

- `monthList`: Obtained from statement list API response (`data.statements[].details[].date` field)
- `reportType`: Static value `standard` for regular statements (other types like `csv` may be available)

**Response Example**:

```
HTTP/1.1 200 OK
Content-Type: application/pdf
Content-Disposition: attachment; filename="statement-Oct-2025.pdf"
Content-Length: 267999

%PDF-1.4
[binary PDF content]
```

**Notes**:

- The downloaded PDF contains detailed transaction history for the month
- File naming convention: `statement-{Month}-{Year}.pdf`
- Must have valid session cookies to download
- Downloads typically complete quickly (< 5 seconds for most statements)

## 6. Download Statement (Credit Card)

### API: Download Credit Card Statement PDF

**Endpoint**: `POST /myaccount/credit/rewards-card/statement/download`

**HTTP Method**: POST

**Purpose**: Downloads credit card billing statement as PDF file. The statement includes all credit card transactions, payments, fees, and interest charges for the billing period.

**Validation Result**: ✅ **PASS** - Downloaded 1,071,018 bytes PDF for September 9, 2025

**Request Headers**:

```
Content-Type: application/json
Accept: application/octet-stream, application/pdf
x-csrf-token: <decoded_csrf_token>
```

**IMPORTANT**: The `x-csrf-token` header is **required** and must contain a unicode-decoded CSRF token extracted from the credit card page HTML.

**Request Body**:

```json
{
  "variables": {
    "statementId": "2025-09-09",
    "creditAccountId": "22FE-ED53-B5D4177B-8C52-FFCEG75E1E3E"
  }
}
```

**Parameter Sources**:

- `statementId`: From credit card statement headers API (`statementHeaders[].statementId` field)
- `creditAccountId`: From page context when viewing credit card (same as used in statement headers query)

**Response**:

- Content-Type: `application/octet-stream` or `application/pdf`
- Content-Disposition: `attachment; filename="statement-2025-09-09.pdf"`
- Binary PDF file content
- File size: Typically 500 KB - 2 MB depending on transaction volume

**Response Example**:

```
HTTP/1.1 200 OK
Content-Type: application/octet-stream
Content-Disposition: attachment; filename="statement-2025-09-09.pdf"
Content-Length: 1071018

%PDF-1.4
[binary PDF content]
```

**Notes**:

- POST request unlike the GET-based transaction statement download
- Requires valid credit account ID matching the statement
- File naming convention: `statement-{statementId}.pdf` where statementId is YYYY-MM-DD format
- Larger file sizes than transaction statements due to more detailed credit card information
- Must have active credit card account to download statements

## 7. Credit Card Account Details (Optional)

### API: Get Credit Card Servicing Overview (GraphQL)

**Endpoint**: `POST /myaccount/credit/rewards-card/graphql/Web_CONSUMER_REWARDS_US_Hub_ServicingOverview`

**HTTP Method**: POST

**Purpose**: Retrieves comprehensive credit card account details including balances, credit limits, payment information, and rewards. This is useful for displaying current account status.

**Request Headers**:

```
Cookie: nsid=<session_id>; x-pp-s=<session_token>; [other cookies]
Content-Type: application/json
Accept: application/json
```

**Request Body**:

```json
{
  "operationName": "Web_CONSUMER_REWARDS_US_Hub_ServicingOverview",
  "variables": {
    "creditAccountId": "22FE-ED53-B5D4177B-8C52-FFCEG75E1E3E",
    "creditProductIdentifier": "CREDIT_CARD_PAYPAL_CONSUMER_REWARDS_US"
  },
  "query": "query Web_CONSUMER_REWARDS_US_Hub_ServicingOverview($creditAccountId: CreditAccountId!, $creditProductIdentifier: CreditProductIdentifier!) { ... }"
}
```

**Response Structure** (abbreviated):

```json
{
  "data": {
    "revolvingCreditServicingOverview": {
      "currentBalance": {
        "formattedCurrency": "$0.47"
      },
      "creditLimit": {
        "formattedCurrency": "$5,000.00"
      },
      "availableCredit": {
        "formattedCurrency": "$4,999.53"
      },
      "minimumPaymentDue": {
        "formattedCurrency": "$0.00"
      },
      "nextPaymentDueDate": {
        "formattedDateString": "10/9/2025"
      }
    }
  }
}
```

**Important Fields**:

- `currentBalance`: Current outstanding balance
- `creditLimit`: Total credit limit
- `availableCredit`: Available credit remaining
- `minimumPaymentDue`: Minimum payment amount due
- `nextPaymentDueDate`: Next payment due date

**Notes**:

- This API is optional for statement download but useful for context
- Provides current account status beyond what's in historical statements
- Uses same authentication and GraphQL structure as other credit card APIs

## Account Types

PayPal supports multiple account types with different statement access methods:

### 1. PayPal Balance Account

**Characteristics**:

- Primary USD balance account for all users
- Additional currency balances (CAD, EUR, GBP, AUD, etc.)
- Business accounts (for business users)
- Tracks all PayPal transactions, payments sent/received, fees

**Statement Access**:

- REST API: `GET /myaccount/statements/api/statements`
- Download: `GET /myaccount/statements/download?monthList=YYYYMMDD&reportType=standard`
- Available for 3 years of history
- Monthly statements generated automatically

### 2. PayPal Credit Cards

**Characteristics**:

- PayPal Cashback World Mastercard (most common)
- Other PayPal-branded credit products
- Separate credit line with credit limit
- Billing cycle-based statements

**Statement Access**:

- GraphQL API: `POST /myaccount/credit/rewards-card/graphql/Web_CONSUMER_REWARDS_US_Hub_StatementHeaders`
- Download: `POST /myaccount/credit/rewards-card/statement/download`
- Requires credit account ID from page context
- Billing statements by cycle period (not calendar month)

### 3. Linked External Accounts

**Characteristics**:

- Bank accounts (checking, savings)
- External credit/debit cards
- Other payment methods (Venmo, etc.)

**Statement Access**:

- No direct statement download through PayPal
- Transactions visible in PayPal activity but full statements from source institution
- Used for funding PayPal transactions

## Notes

### Authentication & Session Management

- PayPal uses complex multi-cookie session management with primary cookies `nsid` and `x-pp-s`
- Sessions expire after period of inactivity (typically 15-30 minutes)
- All cookies must be included in requests for successful authentication
- Re-authentication required if session expires

### Credit Account ID

- Required for all credit card-related operations
- Must be extracted from page HTML or JavaScript context when accessing credit card pages
- Format: UUID style identifier (e.g., "11ED-DC42-A4C3066A-9B41-EEBDF64D0D2D")
- Specific to each user's credit card account

### API Architecture

- Mixed REST and GraphQL architecture
- Transaction statements use simple REST GET APIs
- Credit card operations use GraphQL POST with specific operation names
- Some data (accounts, profile) embedded in HTML rather than available via API

### Statement Availability

- Transaction statements: Available for 3 years, monthly generation
- Credit card statements: Available by billing cycle, typically 7+ years retained
- Statements only generated for periods with account activity

### Error Handling

- Session expiration returns HTTP 401 or redirects to login
- Invalid credit account ID returns GraphQL errors
- Missing parameters return HTTP 400 Bad Request
- Rate limiting may apply to download endpoints

## Implementation Considerations

### 1. Session Management

Store and maintain multiple session cookies:

```javascript
const cookies = {
  nsid: "session_id_value",
  "x-pp-s": "session_token_value",
  id_token: "jwt_token_value",
  cookie_check: "yes",
  enforce_policy: "ccpasupported",
  login_email: "user@example.com",
  // ... additional cookies
};
```

Include all cookies in every authenticated request.

### 2. Credit Account ID Extraction

Extract credit account ID from page context:

```javascript
// Navigate to credit card hub page
await page.goto("https://www.paypal.com/myaccount/credit/rewards-card/hub");

// Extract creditAccountId from page JavaScript
const creditAccountId = await page.evaluate(() => {
  // Look for creditAccountId in window.__INITIAL_STATE__ or similar
  return window.__INITIAL_STATE__?.creditAccountId;
});
```

### 3. Statement Type Detection

Determine which statement APIs to use:

```javascript
async function getStatements(accountType) {
  if (accountType === "balance") {
    // Use REST API for transaction statements
    return await fetch(
      "https://www.paypal.com/myaccount/statements/api/statements"
    );
  } else if (accountType === "credit_card") {
    // Use GraphQL API for credit card statements
    return await fetch(
      "https://www.paypal.com/myaccount/credit/rewards-card/graphql/Web_CONSUMER_REWARDS_US_Hub_StatementHeaders",
      {
        method: "POST",
        body: JSON.stringify({
          operationName: "Web_CONSUMER_REWARDS_US_Hub_StatementHeaders",
          variables: { creditAccountId, creditProductIdentifier },
        }),
      }
    );
  }
}
```

### 4. Error Handling & Retry Logic

Implement robust error handling:

```javascript
async function downloadStatementWithRetry(url, options, maxRetries = 3) {
  for (let i = 0; i < maxRetries; i++) {
    try {
      const response = await fetch(url, options);

      if (response.status === 401) {
        // Session expired - need to re-authenticate
        await reAuthenticate();
        continue;
      }

      if (response.ok) {
        return await response.arrayBuffer();
      }

      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    } catch (error) {
      if (i === maxRetries - 1) throw error;
      await sleep(1000 * (i + 1)); // Exponential backoff
    }
  }
}
```

### 5. Account Type Detection

Parse HTML to identify available account types:

```javascript
async function detectAccountTypes(page) {
  const accountTypes = [];

  // Check for balance account
  const hasBalance = (await page.locator('[data-test="balance"]').count()) > 0;
  if (hasBalance) accountTypes.push("balance");

  // Check for credit card
  const hasCreditCard =
    (await page.locator('[href*="credit/rewards-card"]').count()) > 0;
  if (hasCreditCard) accountTypes.push("credit_card");

  return accountTypes;
}
```

### 6. Rate Limiting

Implement delays between requests:

```javascript
async function downloadMultipleStatements(statements) {
  const pdfs = [];

  for (const statement of statements) {
    const pdf = await downloadStatement(statement);
    pdfs.push(pdf);

    // Wait 2 seconds between downloads to avoid rate limiting
    await sleep(2000);
  }

  return pdfs;
}
```

### 7. PDF Validation

Verify downloaded PDFs are valid:

```javascript
function isValidPDF(buffer) {
  // Check PDF header
  const header = buffer.slice(0, 5).toString();
  if (!header.startsWith("%PDF-")) {
    return false;
  }

  // Check minimum size (should be at least 10KB for valid statement)
  if (buffer.length < 10240) {
    return false;
  }

  return true;
}
```

## Summary

PayPal provides comprehensive APIs for accessing both PayPal balance account statements and PayPal credit card statements, though they use different architectures:

**Transaction Statements** (PayPal Balance):

- Simple REST GET APIs
- List: `GET /myaccount/statements/api/statements`
- Download: `GET /myaccount/statements/download?monthList=YYYYMMDD&reportType=standard`
- Available for 3 years
- Uses automatic cookie authentication

**Credit Card Statements**:

- GraphQL POST APIs with specific operation names
- List: `POST .../graphql/Web_CONSUMER_REWARDS_US_Hub_StatementHeaders`
- Download: `POST .../statement/download` with JSON body
- Requires credit account ID from page context
- **Requires CSRF token with unicode decoding**

**Key Implementation Requirements**:

1. ✅ Use `localStorage.getItem('vf')` for session ID with fallbacks
2. ✅ Extract and decode CSRF token from HTML for credit card APIs
3. ✅ Support both UUID and short encrypted account ID formats
4. ✅ Extract credit card mask from `••\d{4}` pattern
5. ✅ Handle both REST and GraphQL API patterns
6. ✅ Validate PDF downloads before saving (>10KB size check)
7. ✅ Use `credentials: 'include'` for automatic cookie authentication
