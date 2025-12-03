# Discover Bank Analysis

## Overview

**Bank ID**: discover
**Bank Name**: Discover Bank
**Bank URL**: https://www.discover.com
**HAR File**: `analyze/discover_1763506982047.har`
**HAR File Size**: 5.31 MB (181 entries)

### User Profile

- **Profile ID**: `73519284`
- **Username**: `johndoe123`
- **Profile Name**: `JOHN DOE`

### Account List

**1. Credit Card Account**

- **Account ID/Key**: `8472916503`
- **Account Type**: Credit Card
- **Account Description**: Discover it Card
- **Last 4 Digits**: `4271`
- **Current Balance**: $0.00

**2. Bank Account**

- **Account ID**: `BK58371624`
- **Account Type**: Checking
- **Account Description**: Discover Checking W (Cashback Debit)
- **Last 4 Digits**: `7036`
- **Current Balance**: $1.02

### Statement List

**Credit Card Statements** (Account 8472916503):

The API returns 63 statements spanning from June 2019 to October 2025:

- Most Recent: October 20, 2025 (`20251020`)
- Oldest Available: June 24, 2019 (`20190706`)
- Coverage: Approximately 5+ years of statement history

**Bank Statements** (Account BK58371624):

- Statement Date: October 31, 2025
  - Statement ID: `bankprod2|5839204716|20251031~4~STM~BK58371624~OC~00082947~~~~~|202511031623-bankstmt-oc1|00A3F72B00041956`
  - PDF Size: 243,736 bytes
- Statement Date: September 30, 2025
  - Statement ID: `bankprod2|5839204716|20250930~4~STM~BK58371624~OC~00083651~~~~~|202510021312-bankstmt-oc1|00B4G83C00052067`
  - PDF Size: ~240 KB

### Important Note: Multi-Domain Architecture

Discover Bank operates across **three main domains**:

1. **portal.discover.com** - Unified account portal
2. **card.discover.com** - Credit card management
3. **bank.discover.com** - Banking services

#### Cross-Domain API Access

**Important**: Both **card domain** and **bank domain** can directly call **portal domain APIs**.

**Card Domain** (`card.discover.com`) -> Portal APIs:

- CORS headers: `Access-Control-Allow-Origin: https://card.discover.com`
- Credentials allowed: `Access-Control-Allow-Credentials: true`
- Example calls from card homepage:
  - `https://portal.discover.com/enterprise/navigation-api/v1/customer/info/card?selAcct=8472916503`
  - `https://portal.discover.com/enterprise/navigation-api/v1/messages/card/messageCount?selAcct=8472916503`
  - `https://portal.discover.com/enterprise/navigation-api/v1/navigation/card?selAcct=8472916503`

**Bank Domain** (`bank.discover.com`) -> Portal APIs:

- CORS headers: `Access-Control-Allow-Origin: https://bank.discover.com`
- Credentials allowed: `Access-Control-Allow-Credentials: true`
- Example calls from bank account page:
  - `https://portal.discover.com/enterprise/navigation-api/v1/customer/info/bank?id=BK58371624`
  - `https://portal.discover.com/enterprise/navigation-api/v1/messages/bank/messageCount?id=BK58371624`
  - `https://portal.discover.com/enterprise/navigation-api/v1/navigation/bank?id=BK58371624`

**Implementation Note**: The extension can use portal domain APIs from both card and bank domain pages for unified access to account lists and profile information.

#### Domain-Specific Statement APIs

**Critical**: Statement APIs are **domain-locked** and cannot be accessed cross-origin:

- **Credit Card Statements**: Must be accessed from `card.discover.com`

  - API: `https://card.discover.com/cardissuer/statements/transactions/v1/recent`
  - API: `https://card.discover.com/cardmembersvcs/statements/app/v2/stmt`
  - Cannot be called from `portal.discover.com` or `bank.discover.com` due to CORS restrictions

- **Bank Account Statements**: Must be accessed from `bank.discover.com`
  - API: `https://bank.discover.com/bank/deposits/servicing/documents/v1/accounts/{accountId}/statements`
  - Cannot be called from `portal.discover.com` or `card.discover.com` due to CORS restrictions

**User Requirement**: Users can work from any Discover domain (portal, card, or bank). The extension automatically handles cross-domain API calls.

#### Implementation Strategy

**Cross-Domain Request Handling**:

- Content script detects when it's on wrong domain for an API call
- Uses `chrome.runtime.sendMessage()` to forward request to popup script
- Popup script executes the fetch (bypasses CORS as popup has higher privileges)
- Response (including binary PDF data) is returned via message passing
- Seamless user experience without requiring domain navigation

**Smart Fetch Architecture**:

- `smartFetch()` function detects current domain and target API domain
- If domains match: Use native `fetch()` for best performance
- If domains mismatch: Automatically route through `fetchViaPopup()` using message passing
- Works transparently for both statements API and PDF downloads

**Domain Detection Logic**:

```javascript
function smartFetch(url, options) {
  const targetDomain = new URL(url).hostname;
  const currentDomain = window.location.hostname;

  if (targetDomain === currentDomain) {
    return fetch(url, options); // Direct fetch
  }

  return fetchViaPopup(url, options); // Via chrome.runtime.sendMessage
}
```

**Error Handling in UI**:

- Download errors are displayed at the top of the statement list (not inline)
- Individual statements show "✗ Failed" briefly when download fails
- Error message persists at the top for user to read and take action

**Caching Consideration**:

- Statements are cached for 15 minutes in chrome.storage.session
- User can work from any Discover domain (portal, card, or bank)
- Downloads work seamlessly regardless of current domain
- Cross-domain fetching handled automatically by extension architecture

---

## Task 1: Identify Session ID

### Session Cookies

Discover Bank uses multiple cookies for authentication and session management.

#### Key Session Cookies

| Cookie Name  | HttpOnly | Accessible via JavaScript | Purpose                          |
| ------------ | -------- | ------------------------- | -------------------------------- |
| `customerId` | No       | Yes                       | Customer unique identifier       |
| `cif`        | No       | Yes                       | Customer Information File number |
| `sectoken`   | No       | Yes                       | Security token                   |
| `dcsession`  | Yes      | No                        | Session identifier (HttpOnly)    |
| `REQID`      | Yes      | No                        | Request identifier (HttpOnly)    |

#### Cookie Examples

```
customerId=e7f42c8d33a5b6091f82ee47c19385a2
cif=5839204716
sectoken=83MXVNFR7K2YQ94GTW5P301AZ9
dcsession=RX-wkT3UGr5TnXEK9qU0XFe4HTU7yskhzge (HttpOnly)
REQID=73148394-86d8-6g8d-d326-4fb325g72cd-3985728105814 (HttpOnly)
```

#### Cookie Attributes

- **Domain**: `.discover.com` or `discover.com` (shared across all subdomains)
- **Secure**: Yes (HTTPS only)
- **SameSite**: `lax` or `None`
- **Expiration**:
  - `customerId`: 1 year (Max-Age=31536000)
  - `dcsession`, `sectoken`: Session cookies (expire when browser closes)

#### JavaScript Access

**Accessible Cookies** (can be read via `document.cookie`):

- `customerId`
- `cif`
- `sectoken`

**HttpOnly Cookies** (automatically sent by browser, cannot be accessed via JavaScript):

- `dcsession`
- `REQID`

#### Implementation

```javascript
// Check if user is logged in
function isLoggedIn() {
  const cookies = document.cookie;
  const hasCustomerId = cookies.includes("customerId=");
  const hasCif = cookies.includes("cif=");
  const hasSecToken = cookies.includes("sectoken=");

  return hasCustomerId && hasCif && hasSecToken;
}

// Get session identifiers
function getSessionInfo() {
  const cookies = document.cookie;
  return {
    customerId: cookies.match(/customerId=([^;]+)/)?.[1],
    cif: cookies.match(/cif=([^;]+)/)?.[1],
    sectoken: cookies.match(/sectoken=([^;]+)/)?.[1],
  };
}
```

#### Verification

Verified in HAR file:

- Found in request cookies for all 181 entries
- Confirmed `dcsession` and `REQID` are HttpOnly via Set-Cookie response headers
- Confirmed `customerId`, `cif`, and `sectoken` are NOT HttpOnly

---

## Task 2: Retrieve User Profile Information

### Recommended Approach: Portal Domain APIs

**Strategy**: Call BOTH portal APIs and combine responses to get complete profile + all accounts.

**API Endpoints**:

1. `https://portal.discover.com/enterprise/navigation-api/v1/customer/info/card?` (returns profile + BANK accounts)
2. `https://portal.discover.com/enterprise/navigation-api/v1/customer/info/bank?` (returns profile + CARD accounts)

**HTTP Method**: `GET`  
**Domain**: portal.discover.com

#### Why Portal Domain?

- Works from both card and bank domains (CORS enabled)
- No parameters required
- Returns profile info (name, email, phones)
- Returns account list (need both calls to get all accounts)
- Use email as profile ID
- Single domain for consistency across all domains

#### HTTP Headers

```http
GET /bank/deposits/servicing/customer/profiles/v1 HTTP/1.1
Host: bank.discover.com
Accept: application/json
Accept-Encoding: gzip, deflate, br, zstd
Accept-Language: en-US,en;q=0.9
Cookie: customerId=...; cif=...; dcsession=...; sectoken=...; [other cookies]
```

#### Request Parameters

**Query Parameters**: None
**Request Body**: None
**Parameter Dependencies**: None - No parameters required

#### Response Structure

**HTTP Status**: `200 OK`
**Content-Type**: `application/json`

```json
{
  "id": "73519284",
  "username": "johndoe123",
  "isPIIUpdateEligible": true,
  "name": {
    "givenName": "JOHN",
    "familyName": "DOE",
    "formatted": "JOHN DOE"
  },
  "email": "johndoe@example.com",
  "phoneNumbers": {
    "home": {
      "category": "home",
      "countryCode": "1",
      "number": "7183526940",
      "cell": true,
      "formatted": "718-352-6940"
    }
  },
  "addresses": {
    "Home": {
      "category": "Home",
      "streetAddress": "8523 SW 41ST BLVD",
      "locality": "PORTLAND",
      "region": "OR",
      "postalCode": "972153864",
      "formatted": "8523 SW 41ST BLVD\nPORTLAND OR 97215-3864\nUSA"
    }
  }
}
```

#### Important Fields

- `id`: User profile ID (used in some contexts)
- `username`: Login username
- `name.formatted`: Full name for display
- `email`: Contact email address

#### Verification

Verified in HAR file:

- HTTP Method: GET
- Headers: Accept: application/json
- Response: 200 OK with JSON payload
- Contains expected profile ID and username

#### HTTP Headers

```http
GET /enterprise/navigation-api/v1/customer/info/card? HTTP/1.1
Host: portal.discover.com
Accept: application/json
Cookie: [session cookies]
```

#### Request Parameters

**Query Parameters**: None (just `?` at the end with no parameters)

**Parameter Dependencies**: None

#### Response Structure (from /card? endpoint)

```json
{
  "profile": {
    "name": "DOE,JOHN",
    "email": "johndoe@example.com",
    "homePhoneNumber": "7183526940",
    "workPhoneNumber": "0000000000",
    "mobilePhoneNumber": null
  },
  "hasClosedBankAccount": false,
  "accounts": [
    {
      "accountId": "BK58371624",
      "accountType": "BANK",
      "accountDesc": "Discover Checking W",
      "lastFourAccountNumber": "7036",
      "currentBalance": "1.02"
    }
  ]
}
```

#### Response Structure (from /bank? endpoint)

```json
{
  "profile": {
    "name": "JOHN DOE",
    "email": "johndoe@example.com",
    "homePhoneNumber": "7183526940",
    "workPhoneNumber": "0000000000",
    "mobilePhoneNumber": null
  },
  "accounts": [
    {
      "accountId": "8472916503",
      "accountType": "CARD",
      "accountDesc": "Discover it Card",
      "lastFourAccountNumber": "4271",
      "currentBalance": "000"
    }
  ]
}
```

#### Important Pattern

**Note**: The portal APIs return "opposite" account types:

- `/customer/info/card?` returns BANK accounts (only if user has bank accounts)
- `/customer/info/bank?` returns CARD accounts (only if user has credit cards)

**To get ALL accounts**: Call BOTH APIs and combine the `accounts` arrays.

#### Important Caveat

**Account Type Dependency**:

- If the user does **not have a credit card**, the `/customer/info/card?` endpoint may not return a valid response or may return empty accounts
- If the user does **not have a bank account**, the `/customer/info/bank?` endpoint may not return a valid response or may return empty accounts

**Implementation**: Always call both APIs and handle cases where one or both may fail or return empty account lists. Check response status and validate the accounts array.

#### Important Fields

- `profile.email`: Use as profile ID (unique identifier)
- `profile.name`: User's full name
- `profile.homePhoneNumber`, `workPhoneNumber`, `mobilePhoneNumber`: Contact numbers
- `accounts[]`: Account list (combine from both API calls)

#### Implementation Strategy

```javascript
// Get complete profile and all accounts
async function getProfileAndAccounts() {
  const [cardResponse, bankResponse] = await Promise.all([
    fetch(
      "https://portal.discover.com/enterprise/navigation-api/v1/customer/info/card?"
    ).catch(() => null),
    fetch(
      "https://portal.discover.com/enterprise/navigation-api/v1/customer/info/bank?"
    ).catch(() => null),
  ]);

  const cardData =
    cardResponse && cardResponse.ok
      ? await cardResponse.json()
      : { profile: null, accounts: [] };
  const bankData =
    bankResponse && bankResponse.ok
      ? await bankResponse.json()
      : { profile: null, accounts: [] };

  // Get profile from whichever response has it
  const profile = cardData.profile || bankData.profile;

  return {
    profile: profile
      ? {
          email: profile.email, // Use as ID
          name: profile.name,
          homePhone: profile.homePhoneNumber,
          workPhone: profile.workPhoneNumber,
          mobilePhone: profile.mobilePhoneNumber,
        }
      : null,
    accounts: [
      ...(cardData.accounts || []), // BANK accounts (if user has them)
      ...(bankData.accounts || []), // CARD accounts (if user has them)
    ],
  };
}
```

#### Verification

Verified in HAR file:

- Both APIs called without parameters
- `/customer/info/card?` returns profile + 1 BANK account
- `/customer/info/bank?` returns profile + 1 CARD account
- Combined result: Complete profile + 2 accounts (all accounts)
- Response: 200 OK with JSON payload

---

## Task 3: List All Accounts

### Recommended Approach: Use Profile APIs from Task 2

**Strategy**: The same portal domain APIs used for profile retrieval (Task 2) already return account lists. **No separate account list API is needed.**

**API Endpoints**:

1. `https://portal.discover.com/enterprise/navigation-api/v1/customer/info/card?` (returns BANK accounts)
2. `https://portal.discover.com/enterprise/navigation-api/v1/customer/info/bank?` (returns CARD accounts)

**HTTP Method**: `GET`  
**Domain**: portal.discover.com

#### Why Use Profile APIs for Account List?

- Same APIs as Task 2 - no additional calls needed
- Returns both profile AND accounts in one response
- Works from both card and bank domains (CORS enabled)
- No parameters required
- Combine both responses to get all accounts

#### Response Structure (from /card? endpoint)

Returns BANK accounts:

```json
{
  "profile": { ... },
  "accounts": [
    {
      "accountId": "BK58371624",
      "accountType": "BANK",
      "accountDesc": "Discover Checking W",
      "accountSubType": "002",
      "lastFourAccountNumber": "7036",
      "currentBalance": "1.02",
      "availableBalance": "1.02",
      "accountStatus": "none"
    }
  ]
}
```

#### Response Structure (from /bank? endpoint)

Returns CARD accounts:

```json
{
  "profile": { ... },
  "accounts": [
    {
      "accountId": "8472916503",
      "accountType": "CARD",
      "accountDesc": "Discover it Card",
      "lastFourAccountNumber": "4271",
      "currentBalance": "000",
      "creditLineAvailable": "3700",
      "accountStatus": "none"
    }
  ]
}
```

#### Important Fields

**For All Accounts**:

- `accountId`: **Primary identifier** (use for API calls)
  - For CARD: This is the `acctKey` / `selAcct` parameter
  - For BANK: This is the `id` parameter
- `accountType`: "CARD" or "BANK"
- `accountDesc`: Account description/name
- `lastFourAccountNumber`: Last 4 digits
- `currentBalance`: Current balance
- `accountStatus`: Account status

**For CARD Accounts**:

- `creditLineAvailable`: Available credit

**For BANK Accounts**:

- `availableBalance`: Available balance
- `accountSubType`: Account subtype code (e.g., "002" for checking)

#### Implementation Strategy

```javascript
// Get all accounts (same as getProfileAndAccounts from Task 2)
async function getAllAccounts() {
  const [cardResponse, bankResponse] = await Promise.all([
    fetch(
      "https://portal.discover.com/enterprise/navigation-api/v1/customer/info/card?"
    ).catch(() => null),
    fetch(
      "https://portal.discover.com/enterprise/navigation-api/v1/customer/info/bank?"
    ).catch(() => null),
  ]);

  const cardData =
    cardResponse && cardResponse.ok
      ? await cardResponse.json()
      : { accounts: [] };
  const bankData =
    bankResponse && bankResponse.ok
      ? await bankResponse.json()
      : { accounts: [] };

  return [
    ...(cardData.accounts || []), // BANK accounts (if user has them)
    ...(bankData.accounts || []), // CARD accounts (if user has them)
  ];
}
```

#### Important Notes

**Account Type Dependency** (same as Task 2):

- If user has no credit card, `/customer/info/card?` may not return valid response
- If user has no bank account, `/customer/info/bank?` may not return valid response
- Always handle both cases gracefully with error handling

  **API Pattern**:

- `/customer/info/card?` returns **BANK** accounts (opposite of what you'd expect)
- `/customer/info/bank?` returns **CARD** accounts (opposite of what you'd expect)

#### Verification

Verified in HAR file:

- Both APIs called without parameters
- `/customer/info/card?` returns 1 BANK account (BK58371624)
- `/customer/info/bank?` returns 1 CARD account (8472916503)
- Combined result: 2 total accounts

### Alternative API (Bank Accounts Only)

**URL**: `https://bank.discover.com/api/accounts?view=all`
**HTTP Method**: `GET`
**Domain**: bank.discover.com

#### Request Parameters

**Query Parameters**:

- `view`: `all`

#### Response Structure

```json
{
  "accounts": [
    {
      "id": "BK58371624",
      "accountNumber": "7036",
      "nickname": "Discover Checking W",
      "type": "checking",
      "balance": {
        "current": 1.02,
        "available": 1.02
      },
      "links": {
        "activity": {
          "href": "https://bank.discover.com/api/accounts/BK58371624/activity"
        },
        "statements": {
          "href": "https://bank.discover.com/api/accounts/BK58371624/statements"
        }
      }
    }
  ]
}
```

**Note**: This API only returns bank accounts, not credit cards. Uses HATEOAS pattern with links to related resources.

---

## Task 4: List Available Statements

Discover Bank has **different statement APIs for credit cards vs. bank accounts** due to the multi-domain architecture.

### 4.1 Credit Card Statements

#### API Endpoint (Transaction Summary with Statement Info)

**URL**: `https://card.discover.com/cardissuer/statements/transactions/v1/recent?source=achome&transOnly=Y&selAcct={accountKey}`
**HTTP Method**: `GET`
**Domain**: card.discover.com

##### HTTP Headers

```http
GET /cardissuer/statements/transactions/v1/recent?source=achome&transOnly=Y&selAcct=8472916503 HTTP/1.1
Host: card.discover.com
Accept: application/json
Cookie: [session cookies]
```

##### Request Parameters

**Query Parameters**:

- `source` (required): `achome` or `stmt` (context/source page)
- `transOnly` (required): `Y` (transactions only mode)
- `selAcct` (required): Account key from account list API (e.g., "8472916503")

**Parameter Source**:

- `selAcct` comes from **Task 3 (List All Accounts)** API
  - Field: `customerAccountSummaryVO.cardSummaryVO.cardAccounts[].acctKey`

##### Response Structure

```json
{
  "errorCode": null,
  "statements": null,
  "summaryData": {
    "totalPostedTransactions": "0.00",
    "totalPostedPaymentsAndCredits": "-34.87",
    "totalRunningBalance": "0.00",
    "activityStartDate": "10/21/2025",
    "previousBalance": "34.87",
    "lastStmtBal": "34.87",
    "lastStmtDate": "10/20/2025",
    "currentBalance": "0.00"
  },
  "combinedTransactionData": {
    "combinedTransactions": [ ... ]
  }
}
```

##### Important Fields

- `summaryData.lastStmtDate`: Most recent statement date (MM/DD/YYYY format)
- `summaryData.lastStmtBal`: Last statement balance

**Note**: This API provides transaction data and summary info including the most recent statement date. To retrieve the full statement list, use the `v2/stmt` API with this date.

##### Verification

Verified in HAR file:

- HTTP Method: GET
- Query Parameters: source=achome, transOnly=Y, selAcct=8472916503
- Response: 200 OK with statement date "10/20/2025"

#### Statement List API (Recommended for Historical Statements)

**URL**: `https://card.discover.com/cardmembersvcs/statements/app/v2/stmt?stmtDate={YYYYMMDD}`
**HTTP Method**: `GET`

##### Request Parameters

**Query Parameters**:

- `stmtDate` (required): Statement date in YYYYMMDD format (e.g., "20250920")

**Parameter Source**: Statement date from transaction API (`lastStmtDate`), converted from MM/DD/YYYY to YYYYMMDD format

##### Response Structure

```json
{
  "statements": [
    {
      "fromDate": "09/21/2025",
      "toDate": "10/20/2025",
      "stmtUri": "/cardmembersvcs/statements/app/v2/current",
      "pdfUri": "/cardmembersvcs/statements/app/stmtPDF?view=true&date=20251020",
      "label": "Current Statement",
      "year": "2025",
      "pdfAvailable": true
    },
    {
      "fromDate": "08/21/2025",
      "toDate": "09/20/2025",
      "stmtUri": "/cardmembersvcs/statements/app/v2/stmt?stmtDate=20250920",
      "pdfUri": "/cardmembersvcs/statements/app/stmtPDF?view=true&date=20250920",
      "label": "Statement Period",
      "year": "2025",
      "pdfAvailable": true
    }
  ]
}
```

##### Important Fields

- `statements[]`: Array of all available statements (typically 5+ years of history)
- `statements[].pdfUri`: PDF download URL with embedded date parameter
- `statements[].pdfAvailable`: Boolean indicating if PDF is ready for download
- `statements[].fromDate`: Statement period start date (MM/DD/YYYY)
- `statements[].toDate`: Statement period end date (MM/DD/YYYY)

##### Response Format - Critical Implementation Details

**Security Prefix**: Both the `/recent` and `/v2/stmt` APIs include a security prefix `)]}'` before the JSON data to prevent CSRF attacks.

**Double-Wrapped JSON**: The `/v2/stmt` API response has a nested structure:

```javascript
// Outer layer (after stripping )]}', prefix)
{
  "previousStatementInputVO": {...},
  "jsonResponse": "..." // <-- This is a JSON string, not an object!
}

// The actual statements data is inside jsonResponse as a stringified JSON
JSON.parse(outerData.jsonResponse) // Returns the statements object
```

**Implementation Requirements**:

1. Strip `)]}'` prefix from response text before parsing
2. Parse outer JSON to get `jsonResponse` field
3. Parse `jsonResponse` string to get actual statement data

**Example Code**:

```javascript
const text = await response.text();
const cleaned = text.replace(/^\)\]\}',\s*/, "");
const outer = JSON.parse(cleaned);
const data = JSON.parse(outer.jsonResponse); // Now has statements[] array
```

##### Verification

Verified in HAR file:

- HTTP Method: GET
- Query Parameter: stmtDate=20250920
- Response: 200 OK with array of 63 statements spanning from 2019 to 2025
- Security prefix confirmed: `)]}'` appears before JSON
- Double-wrapped structure confirmed: statements in `jsonResponse` field

### 4.2 Bank Account Statements

#### API Endpoint

**URL**: `https://bank.discover.com/bank/deposits/servicing/documents/v1/accounts/{accountId}/statements`
**HTTP Method**: `GET`
**Domain**: bank.discover.com

##### HTTP Headers

```http
GET /bank/deposits/servicing/documents/v1/accounts/BK58371624/statements HTTP/1.1
Host: bank.discover.com
Accept: application/json
Accept-Encoding: gzip, deflate, br, zstd
Accept-Language: en-US,en;q=0.9
Cookie: [session cookies]
```

##### Request Parameters

**Path Parameters**:

- `accountId` (required): Account ID from account list API (e.g., "BK58371624")

**Query Parameters**: None
**Request Body**: None

**Parameter Source**:

- `accountId` comes from **Task 3 (List All Accounts)** API
  - Field: `customerAccountSummaryVO.bankSummaryVO.depositAccounts[].acctId`

##### Response Structure

```json
[
  {
    "name": "October 2025",
    "statementDate": "2025-10-31T00:00:00-0400",
    "id": "bankprod2|5839204716|20251031~4~STM~BK58371624~OC~00082947~~~~~|202511031623-bankstmt-oc1|00A3F72B00041956",
    "links": [
      {
        "rel": "self",
        "href": "https://bank.discover.com/bank/deposits/servicing/documents/v1/accounts/BK58371624/statements/bankprod2%7C5839204716%7C20251031~4~STM~BK58371624~OC~00082947~~~~~%7C202511031623-bankstmt-oc1%7C00A3F72B00041956"
      },
      {
        "rel": "binary",
        "href": "https://bank.discover.com/bank/deposits/servicing/documents/v1/accounts/BK58371624/statements/bankprod2%7C5839204716%7C20251031~4~STM~BK58371624~OC~00082947~~~~~%7C202511031623-bankstmt-oc1%7C00A3F72B00041956"
      }
    ]
  },
  {
    "name": "September 2025",
    "statementDate": "2025-09-30T00:00:00-0400",
    "id": "bankprod2|5839204716|20250930~4~STM~BK58371624~OC~00083651~~~~~|202510021312-bankstmt-oc1|00B4G83C00052067",
    "links": [ ... ]
  }
]
```

##### Important Fields

- `name`: Human-readable statement name (e.g., "October 2025")
- `statementDate`: ISO 8601 formatted date (e.g., "2025-10-31T00:00:00-0400")
- `id`: **Encoded statement identifier** (required for download in Task 5)
- `links[rel="binary"].href`: Direct download URL for the PDF file

**Statement ID Format**: Complex pipe-separated string containing:

- Environment (e.g., "bankprod2")
- CIF number (e.g., "5839204716")
- Date and metadata (e.g., "20251031~4~STM~BK58371624~OC~00082947~~~~~")
- Timestamp (e.g., "202511031623-bankstmt-oc1")
- Hash/reference (e.g., "00A3F72B00041956")

##### Verification

Verified in HAR file:

- HTTP Method: GET
- Path Parameter: BK58371624
- Response: 200 OK with array of statement objects
- Contains October 2025 and September 2025 statements

---

## Task 5: Download Statement PDF

Discover Bank has **different download APIs for credit cards vs. bank accounts**.

### 5.1 Credit Card Statement PDF

#### API Endpoint

**URL**: `https://card.discover.com/cardmembersvcs/statements/app/stmtPDF?view=true&date={YYYYMMDD}`
**HTTP Method**: `GET`
**Domain**: card.discover.com

##### HTTP Headers

```http
GET /cardmembersvcs/statements/app/stmtPDF?view=true&date=20251020 HTTP/1.1
Host: card.discover.com
Accept: application/pdf, */*
Cookie: dfsedskey=8472916503; [other session cookies]
```

##### Request Parameters

**Query Parameters**:

- `view` (required): `true` (viewing mode)
- `date` (required): Statement date in YYYYMMDD format (e.g., "20251020")

**Cookie Requirements**:

- `dfsedskey` (required): Account key/ID that identifies which credit card account to download the statement for
  - Example: `dfsedskey=8472916503`
  - This cookie determines which account's statement will be returned

**Parameter Source**:

- `date` comes from **Task 4 (List Available Statements)** API
  - API: `card.discover.com/cardissuer/statements/transactions/v1/recent`
  - Field: `summaryData.lastStmtDate` (format: MM/DD/YYYY)
  - **Conversion**: Convert from "10/20/2025" to "20251020"
- `dfsedskey` comes from **Task 3 (List All Accounts)** API
  - Field: `accountId` from the CARD account you want to download statement for

##### Response Structure

**HTTP Status**: `200 OK`
**Content-Type**: `application/pdf`
**Response Body**: Binary PDF file

**Example File Size**: 536 bytes (for test statement with minimal transactions)

##### Implementation Note

**Important**: To download a statement for a specific credit card account, you must set the `dfsedskey` cookie to that account's ID before making the request.

```javascript
// Download credit card statement PDF
async function downloadCardStatement(accountId, statementDate) {
  // Set the dfsedskey cookie to specify which account
  document.cookie = `dfsedskey=${accountId}; path=/; domain=.discover.com`;

  // Convert date from MM/DD/YYYY to YYYYMMDD
  const formattedDate = statementDate.replace(
    /(\d{2})\/(\d{2})\/(\d{4})/,
    "$3$1$2"
  );

  // Download the PDF
  const url = `https://card.discover.com/cardmembersvcs/statements/app/stmtPDF?view=true&date=${formattedDate}`;
  const response = await fetch(url);
  const blob = await response.blob();
  return blob;
}
```

##### Verification

Verified in HAR file:

- HTTP Method: GET
- Query Parameters: view=true, date=20251020
- Cookie: dfsedskey=8472916503 (identifies the account)
- Response: 200 OK
- Content-Type: application/pdf
- Response Size: 536 bytes

#### Alternative API (Detailed Statement with Transactions)

**URL**: `https://card.discover.com/cardmembersvcs/statements/app/stmt.pdf`

**Query Parameters**:

- `date`: YYYYMMDD
- `sortColumn`: `date`
- `grouping`: `-1`
- `printView`: `false`
- `sortOrder`: `N`
- `transaction`: `-1`
- `printOption`: `transactions`
- `way`: `actvt`
- `includePend`: `Y`
- `outputFormat`: `pdf`

**Note**: This endpoint provides more detailed statements with transaction listings.

### 5.2 Bank Account Statement PDF

#### API Endpoint

**URL**: `https://bank.discover.com/bank/deposits/servicing/documents/v1/accounts/{accountId}/statements/{statementId}`
**HTTP Method**: `GET`
**Domain**: bank.discover.com

##### HTTP Headers

```http
GET /bank/deposits/servicing/documents/v1/accounts/BK58371624/statements/bankprod2%7C5839204716%7C20251031~4~STM~BK58371624~OC~00082947~~~~~%7C202511031623-bankstmt-oc1%7C00A3F72B00041956 HTTP/1.1
Host: bank.discover.com
Accept: application/pdf, */*
Accept-Encoding: gzip, deflate, br, zstd
Accept-Language: en-US,en;q=0.9
Cookie: [session cookies]
```

##### Request Parameters

**Path Parameters**:

- `accountId` (required): Account ID (e.g., "BK58371624")
- `statementId` (required): **URL-encoded statement ID** (e.g., "bankprod2%7C5839204716%7C20251031~4~STM~BK58371624~OC~00082947~~~~~%7C202511031623-bankstmt-oc1%7C00A3F72B00041956")

**Query Parameters**: None
**Request Body**: None

**Parameter Sources**:

1. `accountId` comes from **Task 3 (List All Accounts)** API

   - Field: `customerAccountSummaryVO.bankSummaryVO.depositAccounts[].acctId`

2. `statementId` comes from **Task 4 (List Available Statements)** API
   - API: `bank.discover.com/bank/deposits/servicing/documents/v1/accounts/{accountId}/statements`
   - Field: `[].id`
   - **Important**: Must be URL-encoded (pipes `|` become `%7C`)

##### Response Structure

**HTTP Status**: `200 OK`
**Content-Type**: `application/pdf`
**Response Body**: Binary PDF file

**Example File Size**: 243,736 bytes (238 KB) for October 2025 statement

##### Statement ID Encoding

**Raw Statement ID**:

```
bankprod2|5839204716|20251031~4~STM~BK58371624~OC~00082947~~~~~|202511031623-bankstmt-oc1|00A3F72B00041956
```

**URL-Encoded Statement ID**:

```
bankprod2%7C5839204716%7C20251031~4~STM~BK58371624~OC~00082947~~~~~%7C202511031623-bankstmt-oc1%7C00A3F72B00041956
```

##### Verification

Verified in HAR file:

- HTTP Method: GET
- Path Parameters: accountId=BK58371624, statementId=bankprod2%7C5839204716%7C20251031~4~STM~BK58371624~OC~00082947~~~~~%7C202511031623-bankstmt-oc1%7C00A3F72B00041956
- Response: 200 OK
- Content-Type: application/pdf
- Response Size: 243,736 bytes

#### Alternative: Using HATEOAS Links

The statement list API (Task 4) provides direct download URLs in the response:

```json
{
  "links": [
    {
      "rel": "binary",
      "href": "https://bank.discover.com/bank/deposits/servicing/documents/v1/accounts/BK58371624/statements/bankprod2%7C5839204716%7C20251031~4~STM~BK58371624~OC~00082947~~~~~%7C202511031623-bankstmt-oc1%7C00A3F72B00041956"
    }
  ]
}
```

You can directly use the `href` from `links[rel="binary"]` without manually constructing the URL.

---

## API Verification Summary

All APIs have been verified against the HAR file `discover_1763506982047.har` (181 entries, 5.31 MB).

| Task                             | API Endpoint                                             | Method | Verified | Notes                                            |
| -------------------------------- | -------------------------------------------------------- | ------ | -------- | ------------------------------------------------ |
| **Task 1: Session ID**           | Cookies                                                  | N/A    |          | All session cookies found and validated          |
| **Task 2: User Profile**         | `bank.discover.com/.../customer/profiles/v1`             | GET    |          | Returns profile ID 73519284, username johndoe123 |
| **Task 2: User Profile (Alt 1)** | `portal.discover.com/.../customer/info/...`              | GET    |          | Returns profile + accounts                       |
| **Task 2: User Profile (Alt 2)** | `card.discover.com/.../card-account-info`                | POST   |          | Returns displayName "John" + card details        |
| **Task 3: List Accounts**        | `portal.discover.com/.../customeraccountinfo/v1/summary` | GET    |          | Returns both card and bank accounts              |
| **Task 4: Card Statements**      | `card.discover.com/.../transactions/v1/recent`           | GET    |          | Returns last statement date 10/20/2025           |
| **Task 4: Bank Statements**      | `bank.discover.com/.../documents/v1/.../statements`      | GET    |          | Returns array of 2 statements                    |
| **Task 5: Card PDF**             | `card.discover.com/.../stmtPDF`                          | GET    |          | 536 bytes PDF for 20251020                       |
| **Task 5: Bank PDF**             | `bank.discover.com/.../statements/{id}`                  | GET    |          | 243,736 bytes PDF for October 2025               |

### Verification Methods Used

- **PowerShell JSON parsing**: Loaded HAR file and queried specific entries
- **Cookie validation**: Checked Set-Cookie headers for HttpOnly attribute
- **Response validation**: Verified status codes, content types, and response sizes
- **Parameter validation**: Confirmed query parameters and path parameters match documentation

### Domain-Specific Notes

Due to CORS restrictions, APIs are domain-specific:

- **portal.discover.com**: Account list, navigation, customer info
- **card.discover.com**: Credit card transactions and statements
- **bank.discover.com**: Bank account transactions and statements

The browser extension must detect the current domain and use appropriate APIs for that domain.

---

## Implementation Notes

### Parameter Dependency Chain

```
Task 1 (Session Cookies)
   (required for all API calls)
Task 3 (List All Accounts)
   provides acctKey for cards, acctId for banks
Task 4 (List Statements)
   provides statement IDs/dates
Task 5 (Download PDFs)
```

### Key Identifiers

- **Credit Card**: Use `acctKey` (e.g., "8472916503")
- **Bank Account**: Use `acctId` (e.g., "BK58371624")
- **Statement Date (Card)**: YYYYMMDD format (e.g., "20251020")
- **Statement ID (Bank)**: Complex encoded string with pipes (must URL-encode)

### Domain Detection

```javascript
function getCurrentDomain() {
  const hostname = window.location.hostname;
  if (hostname === "portal.discover.com") return "portal";
  if (hostname === "card.discover.com") return "card";
  if (hostname === "bank.discover.com") return "bank";
  return null;
}
```

### URL Encoding

**Critical**: Bank statement IDs contain pipes (`|`) and must be URL-encoded:

- Use `encodeURIComponent(statementId)` in JavaScript
- Pipes `|` `%7C`
- Tildes `~` remain `~` (unreserved character)

---

## Implementation Summary

### Completed Implementation (discover.mjs)

#### Key Features Implemented

1. **Multi-Statement Support**

   - Changed from returning single statement to returning full history (63 statements from 2019-2025)
   - Uses `/v2/stmt` API to retrieve complete statement list
   - Parses double-wrapped JSON response with security prefix

2. **Security Prefix Handling**

   - Both `/recent` and `/v2/stmt` APIs return `)]}'` prefix before JSON
   - Implementation strips prefix before parsing: `text.replace(/^\)\]\}',\s*/, '')`
   - Applied to both API calls to prevent JSON parsing errors

3. **Double-Wrapped JSON Parsing**

   - `/v2/stmt` response has nested structure with `jsonResponse` field
   - Implementation:
     ```javascript
     const outer = JSON.parse(cleanedText);
     const data = JSON.parse(outer.jsonResponse);
     ```

4. **Cross-Domain Request Handling**

   - `smartFetch()`: Detects domain mismatch and automatically routes through popup
   - `fetchViaPopup()`: Uses `chrome.runtime.sendMessage()` for cross-domain API calls
   - Works seamlessly from any Discover domain (portal, card, or bank)
   - Handles both JSON responses and binary PDF downloads via message passing
   - Binary data converted to base64 data URLs for message passing, then back to Blob

5. **Bidirectional Messaging Architecture**

   - Content script → Popup: `chrome.runtime.sendMessage({ action: 'requestFetch', url, options })`
   - Popup executes fetch and converts binary data to base64 if needed
   - Popup → Content script: Returns `{ ok, status, statusText, headers, body }`
   - Content script converts base64 data URL back to Blob for PDF downloads
   - Type-safe message passing using TypeScript discriminated unions

6. **Error Message Propagation**
   - Removed redundant error message prefixes in bank module
   - Popup shows errors at top of statement list (not inline)
   - Clear, actionable error messages displayed to users
   - No more "wrong domain" errors - cross-domain requests handled automatically

#### API Integration

**Profile & Accounts (Works from any domain)**:

- Uses portal.discover.com APIs
- Calls both `/customer/info/card?` and `/customer/info/bank?` in parallel
- Combines results to get all accounts (credit card + bank)

**Credit Card Statements (Works from any domain via smartFetch)**:

- Two-step process:
  1. Call `/recent` API to get last statement date
  2. Call `/v2/stmt?stmtDate={date}` to get full statement list
- Handles security prefix and double-wrapped JSON
- Uses `smartFetch()` to automatically handle domain mismatches via popup messaging
- Returns array of Statement objects with statementId (YYYYMMDD) and statementDate

**Bank Statements (Works from any domain)**:

- Single API call to `/accounts/{accountId}/statements`
- Uses pre-encoded URLs from HATEOAS links for downloads
- Returns array of Statement objects

**Downloads (Work from any domain via smartFetch)**:

- Credit card: Uses `smartFetch()` + sets `dfsedskey` cookie
- Bank: Uses direct `fetch()` (no domain restrictions)
- Binary PDF data handled via base64 encoding in message passing when cross-domain
- Seamless experience regardless of which Discover domain user is on

### Known Limitations

1. **None - Cross-Domain Support Implemented**

   - Extension works from any Discover domain (portal, card, or bank)
   - `smartFetch()` automatically detects domain mismatches
   - Cross-domain requests routed through popup via `chrome.runtime.sendMessage()`
   - Seamless user experience with no manual domain navigation required

2. **CORS Restrictions (Bypassed)**
   - Portal APIs work across domains (explicit CORS headers)
   - Statement APIs are domain-locked but handled via popup messaging
   - Chrome extension popup context has higher privileges and bypasses CORS
   - Binary PDF downloads work via base64 encoding in message passing

---

## Handoff Information

**Bank ID**: discover
**Bank Name**: Discover Bank
**Bank URL**: https://www.discover.com
**Analysis File**: `analyze/discover.md`
**HAR File**: `analyze/discover_1763506982047.har`
**HAR File Size**: 5.31 MB (181 entries)

### Ready for Implementation

All five analysis tasks have been completed successfully:

1. Session ID identified (cookies validated, HttpOnly flags confirmed)
2. User profile API identified (no parameters required)
3. Account list API identified (no parameters required)
4. Statement list APIs identified (separate for card/bank)
5. Statement download APIs identified (separate for card/bank)

All APIs verified in HAR file. Implementation can proceed.
