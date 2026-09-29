# Discover Bank Analysis

**Analysis as of:** 2026-09-29

## Overview

**Bank ID**: discover
**Bank Name**: Discover Bank
**Bank URL**: https://www.discover.com

Historical examples below use placeholders or synthetic data. References to a
historical capture describe provenance only; no raw capture is stored or needed
to use this API reference.
## Current investigation scope and evidence

The authenticated portal returned a card and checking account from
`/enterprise/portal/customeraccountinfo/v1/summary`. Following the bank's **View
Activity** card link issued the documented recent-transactions API and
`/enterprise/navigation-api/v1/customer/info/card?selAcct=<account-key>`.
The latter includes the selected CARD account plus a BANK account in `accounts`;
do not ignore `selectedAccount` when interpreting the historical opposite-type
arrays.

The card UI's current statement and a selected historical statement used
`/cardmembersvcs/statements/app/v2/current` and
`/cardmembersvcs/statements/app/v2/stmt?stmtDate=<YYYYMMDD>` respectively. Both
returned a direct JSON object with `statements`, `quickLinks`, `quarterlyStatements`,
`summaryData`, and `postedTransactionData`. The sixty-nine entries in the observed
list have PDF availability. The historical requirement to unconditionally parse
`jsonResponse` a second time no longer describes these observed responses.

The bank's **Previous Statements > PDF** link opens `stmtPDF?view=true&date=...`
in Chrome's PDF viewer. Its HTTP-200 PDF was saved locally from that viewer.
The document's account suffix and printed `MM/DD/YYYY` closing date agree with
the bank's selected account and statement. This is card-side source evidence,
not a claim that the extension or checking flow has been validated.

After reauthentication, the bank's **Activity > Statements & Tax Documents**
page loaded normally. Its existing documents API returned thirty-nine checking
statements with `name`, offset-bearing `statementDate`, opaque `id`, and `links`
for `self`, `binary`, and `thumbnail`. The selected BANK account comes from
`customer/info/bank?id=<account-id>` and the opposite-type CARD remains in
`accounts`. The latest bank-UI PDF uses its exact `binary` link and prints the
month-end in `Mon DD, YYYY` form. The earlier bank technical-difficulty/login
redirect is not evidence of an extension defect.

The exercised extension requests from both card and bank pages returned the
wrapped card-list shape (`previousStatementInputVO` plus string `jsonResponse`),
while the bank UI requests described above returned the direct shape. Support
both envelopes rather than inferring one universal representation.

The banking statement response requested from the card page explicitly allowed
`https://card.discover.com` via CORS with credentials. Therefore the historical
claim that bank statement APIs are always domain-locked is not current evidence.
The extension's card cross-origin requests use its background worker; bank
requests remain direct. Full cross-domain download acceptance is still required
separately from these successful list requests.

Only the available credit card and checking products are in scope. Multiple
cards, savings, other products, cross-user switching, and retention guarantees
remain unverified. Do not treat every observed cookie/header as individually
required or a transport failure as proof that an account type is absent.

### Observed Account Types and History

The captured responses include credit card and checking accounts. The credit card
statement list contains entries from 2019 to 2025; this is observed coverage, not a
documented retention limit.

### Important Note: Multi-Domain Architecture

Discover Bank operates across **three main domains**:

1. **portal.discover.com** - Unified account portal
2. **card.discover.com** - Credit card management
3. **bank.discover.com** - Banking services

#### Cross-Domain API Access

The exercised card and bank pages can directly call portal APIs with credentials.
These observations do not establish a universal CORS policy for every endpoint.

**Card Domain** (`card.discover.com`) -> Portal APIs:

- CORS headers: `Access-Control-Allow-Origin: https://card.discover.com`
- Credentials allowed: `Access-Control-Allow-Credentials: true`
- Example calls from card homepage:
  - `https://portal.discover.com/enterprise/navigation-api/v1/customer/info/card?selAcct=<card-id>`
  - `https://portal.discover.com/enterprise/navigation-api/v1/messages/card/messageCount?selAcct=<card-id>`
  - `https://portal.discover.com/enterprise/navigation-api/v1/navigation/card?selAcct=<card-id>`

**Bank Domain** (`bank.discover.com`) -> Portal APIs:

- CORS headers: `Access-Control-Allow-Origin: https://bank.discover.com`
- Credentials allowed: `Access-Control-Allow-Credentials: true`
- Example calls from bank account page:
  - `https://portal.discover.com/enterprise/navigation-api/v1/customer/info/bank?id=<bank-id>`
  - `https://portal.discover.com/enterprise/navigation-api/v1/messages/bank/messageCount?id=<bank-id>`
  - `https://portal.discover.com/enterprise/navigation-api/v1/navigation/bank?id=<bank-id>`

**Implementation Note**: The extension can use portal domain APIs from both card and bank domain pages for unified access to account lists and profile information.

#### Domain-Specific Statement APIs

Use the observed routing for each API rather than assuming all statement APIs are
domain-locked:

- **Credit Card Statements**: Must be accessed from `card.discover.com`

  - API: `https://card.discover.com/cardissuer/statements/transactions/v1/recent`
  - API: `https://card.discover.com/cardmembersvcs/statements/app/v2/stmt`
  - The extension routes cross-origin card requests through its background worker.

- **Bank Account Statements**: Hosted on `bank.discover.com`
  - API: `https://bank.discover.com/bank/deposits/servicing/documents/v1/accounts/{accountId}/statements`
  - The current response explicitly allows credentialed requests from the card origin.

Only the scoped card and checking flows establish current behavior; other origins,
products and lifecycle transitions require separate verification.

#### Implementation Strategy

**Cross-Domain Request Handling**:

- Content script detects when it's on wrong domain for an API call
- Uses `chrome.runtime.sendMessage()` to forward card requests to the background worker
- The background worker executes the fetch using the extension's existing permissions
- Response (including binary PDF data) is returned via message passing
- A worker/transport failure is surfaced, not retried silently from the page

**Smart Fetch Architecture**:

- `smartFetch()` function detects current domain and target API domain
- If domains match: Use native `fetch()` for best performance
- For card-domain mismatch: Route through `fetchViaPopup()` using message passing
- Works transparently for both statements API and PDF downloads

**Routing summary**:

```javascript
// Card APIs use smartFetch: same-domain fetch or background requestFetch.
// Bank APIs use credentialed native fetch, including from the tested card origin.
```

**Error Handling in UI**:

- Download errors are displayed at the top of the statement list (not inline)
- Individual statements show "✗ Failed" briefly when download fails
- Error message persists at the top for user to read and take action

**Caching Consideration**:

- Statements are cached for 15 minutes in chrome.storage.session
- User can work from any Discover domain (portal, card, or bank)
- A cached list does not prove a new cross-origin download works
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
customerId=<customer-id>
cif=<cif>
sectoken=<security-token>
dcsession=<http-only-session> (HttpOnly)
REQID=<request-id> (HttpOnly)
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

#### Captured Evidence

Observed in the referenced HAR:

- The cookies appear in captured requests
- Set-Cookie response headers mark `dcsession` and `REQID` as HttpOnly
- `customerId`, `cif`, and `sectoken` are NOT HttpOnly

---

## Task 2: Retrieve User Profile Information

### Recommended Approach: Portal Domain APIs

**Strategy**: The module calls both portal APIs and combines selected and other
accounts. Both were available in the exercised two-product session.

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
  "id": "<profile-id>",
  "username": "<username>",
  "isPIIUpdateEligible": true,
  "name": {
    "givenName": "TEST",
    "familyName": "USER",
    "formatted": "TEST USER"
  },
  "email": "user@example.test",
  "phoneNumbers": {
    "home": {
      "category": "home",
      "countryCode": "1",
      "number": "<phone-number>",
      "cell": true,
      "formatted": "<formatted-phone>"
    }
  },
  "addresses": {
    "Home": {
      "category": "Home",
      "streetAddress": "<street-address>",
      "locality": "<city>",
      "region": "OR",
      "postalCode": "<postal-code>",
      "formatted": "<street-address>\n<city> OR <formatted-postal-code>\nUSA"
    }
  }
}
```

#### Important Fields

- `id`: User profile ID (used in some contexts)
- `username`: Login username
- `name.formatted`: Full name for display
- `email`: Contact email address

#### Captured Evidence

Observed in the referenced HAR:

- HTTP Method: GET
- Headers: Accept: application/json
- Response: 200 OK with JSON payload
- Response includes profile ID and username

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
    "name": "USER,TEST",
    "email": "user@example.test",
    "homePhoneNumber": "<phone-number>",
    "workPhoneNumber": "0000000000",
    "mobilePhoneNumber": null
  },
  "hasClosedBankAccount": false,
  "accounts": [
    {
      "accountId": "<bank-id>",
      "accountType": "BANK",
      "accountDesc": "Synthetic Checking",
      "lastFourAccountNumber": "5678",
      "currentBalance": "1.02"
    }
  ]
}
```

#### Response Structure (from /bank? endpoint)

```json
{
  "profile": {
    "name": "TEST USER",
    "email": "user@example.test",
    "homePhoneNumber": "<phone-number>",
    "workPhoneNumber": "0000000000",
    "mobilePhoneNumber": null
  },
  "accounts": [
    {
      "accountId": "<card-id>",
      "accountType": "CARD",
      "accountDesc": "Discover it Card",
      "lastFourAccountNumber": "1234",
      "currentBalance": "000"
    }
  ]
}
```

#### Important Pattern

**Note**: The portal APIs return "opposite" account types:

- `/customer/info/card?` returns BANK accounts (only if user has bank accounts)
- `/customer/info/bank?` returns CARD accounts (only if user has credit cards)

Combine both `selectedAccount` and `accounts` from successful responses and
deduplicate by account ID. The opposite-type arrays alone omit the selected
account in a single-response view.

#### Important Caveat

**Account Type Dependency**:

- If the user does **not have a credit card**, the `/customer/info/card?` endpoint may not return a valid response or may return empty accounts
- If the user does **not have a bank account**, the `/customer/info/bank?` endpoint may not return a valid response or may return empty accounts

The existing implementation tolerates one failed portal request if the other
returns usable information. That historical compatibility behavior is not proof
that a failed request means an absent product; completeness under a partial outage
has not been established.

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
      ...(cardData.selectedAccount ? [cardData.selectedAccount] : []),
      ...(bankData.selectedAccount ? [bankData.selectedAccount] : []),
      ...(cardData.accounts || []), // BANK accounts (if user has them)
      ...(bankData.accounts || []), // CARD accounts (if user has them)
    ], // Deduplicate by accountId before returning the shared account list.
  };
}
```

#### Captured Evidence

Observed in the referenced HAR:

- Both APIs called without parameters
- `/customer/info/card?` returns profile and BANK accounts
- `/customer/info/bank?` returns profile and CARD accounts
- Combine both responses for profile and account information
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
  "profile": { "name": "TEST USER", "email": "user@example.test" },
  "selectedAccount": {
    "accountId": "<card-id>",
    "accountType": "CARD",
    "accountDesc": "Synthetic Card",
    "lastFourAccountNumber": "1234"
  },
  "accounts": [
    {
      "accountId": "<bank-id>",
      "accountType": "BANK",
      "accountDesc": "Synthetic Checking",
      "accountSubType": "002",
      "lastFourAccountNumber": "5678",
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
  "profile": { "name": "TEST USER", "email": "user@example.test" },
  "selectedAccount": {
    "accountId": "<bank-id>",
    "accountType": "BANK",
    "accountDesc": "Synthetic Checking",
    "accountSubType": "002",
    "lastFourAccountNumber": "5678"
  },
  "accounts": [
    {
      "accountId": "<card-id>",
      "accountType": "CARD",
      "accountDesc": "Discover it Card",
      "lastFourAccountNumber": "1234",
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
    ...(cardData.selectedAccount ? [cardData.selectedAccount] : []),
    ...(bankData.selectedAccount ? [bankData.selectedAccount] : []),
    ...(cardData.accounts || []), // BANK accounts (if user has them)
    ...(bankData.accounts || []), // CARD accounts (if user has them)
  ]; // Deduplicate by accountId before returning the shared account list.
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

#### Captured Evidence

Observed in the referenced HAR:

- Both APIs called without parameters
- `/customer/info/card?` returns BANK accounts
- `/customer/info/bank?` returns CARD accounts
- Query both endpoints to collect BANK and CARD accounts

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
      "id": "<bank-id>",
      "accountNumber": "5678",
      "nickname": "Synthetic Checking",
      "type": "checking",
      "balance": {
        "current": 1.02,
        "available": 1.02
      },
      "links": {
        "activity": {
          "href": "https://bank.discover.com/api/accounts/<bank-id>/activity"
        },
        "statements": {
          "href": "https://bank.discover.com/api/accounts/<bank-id>/statements"
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
GET /cardissuer/statements/transactions/v1/recent?source=achome&transOnly=Y&selAcct=<card-id> HTTP/1.1
Host: card.discover.com
Accept: application/json
Cookie: [session cookies]
```

##### Request Parameters

**Query Parameters**:

- `source` (required): `achome` or `stmt` (context/source page)
- `transOnly` (required): `Y` (transactions only mode)
- `selAcct` (required): Account key from account list API (e.g., "<card-id>")

**Parameter Source**:

- `selAcct` comes from **Task 3 (List All Accounts)** API
  - Field: portal `selectedAccount.accountId` or `accounts[].accountId` for CARD.
    The dashboard summary's `cardSummaryVO.cardAccounts[].acctKey` is the
    corresponding account selector.

##### Response Structure

```json
{
  "errorCode": null,
  "statements": null,
  "summaryData": {
    "totalPostedTransactions": "0.00",
    "totalPostedPaymentsAndCredits": "-10.00",
    "totalRunningBalance": "0.00",
    "activityStartDate": "10/21/2025",
    "previousBalance": "10.00",
    "lastStmtBal": "10.00",
    "lastStmtDate": "10/20/2025",
    "currentBalance": "0.00"
  },
  "combinedTransactionData": {
    "combinedTransactions": []
  }
}
```

##### Important Fields

- `summaryData.lastStmtDate`: Most recent statement date (MM/DD/YYYY format)
- `summaryData.lastStmtBal`: Last statement balance

**Note**: This API provides transaction data and summary info including the most recent statement date. To retrieve the full statement list, use the `v2/stmt` API with this date.

##### Captured Evidence

Observed in the referenced HAR:

- HTTP Method: GET
- Query Parameters: source=achome, transOnly=Y, selAcct=<card-id>
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

**Security Prefix**: Historical and current responses may include an anti-JSON-
hijacking prefix `)]}'` with an optional comma before the JSON. This is not a
substitute for session authentication or a general CSRF protection guarantee.

**Response Variants**: The extension request's `/v2/stmt` response can be nested:

```javascript
// Outer layer (after stripping )]}', prefix)
{
  "previousStatementInputVO": {...},
  "jsonResponse": "..." // <-- This is a JSON string, not an object!
}

// The actual statements data is inside jsonResponse as a stringified JSON
JSON.parse(outerData.jsonResponse) // Returns the statements object
```

**Parsing Requirements**:

1. Strip `)]}'` prefix from response text before parsing
2. Parse the JSON object and reject explicit business errors
3. If `jsonResponse` is present, require a string and parse its object; otherwise
   use the direct object. Require an explicit `statements` array.

**Example Code**:

```javascript
const text = await response.text();
const cleaned = text.replace(/^\)\]\}',?\s*/, "");
const outer = JSON.parse(cleaned);
const data = Object.prototype.hasOwnProperty.call(outer, "jsonResponse")
  ? JSON.parse(outer.jsonResponse)
  : outer;
// Validate both envelopes, business error fields, and the statements array.
```

##### Captured Evidence

Observed in the referenced HAR:

- HTTP Method: GET
- Query Parameter: stmtDate=20250920
- Response: 200 OK with a statement array
- Security prefix: `)]}'` appears before JSON
- Double-wrapped structure: statements in `jsonResponse` field

### 4.2 Bank Account Statements

#### API Endpoint

**URL**: `https://bank.discover.com/bank/deposits/servicing/documents/v1/accounts/{accountId}/statements`
**HTTP Method**: `GET`
**Domain**: bank.discover.com

##### HTTP Headers

```http
GET /bank/deposits/servicing/documents/v1/accounts/<bank-id>/statements HTTP/1.1
Host: bank.discover.com
Accept: application/json
Accept-Encoding: gzip, deflate, br, zstd
Accept-Language: en-US,en;q=0.9
Cookie: [session cookies]
```

##### Request Parameters

**Path Parameters**:

- `accountId` (required): Account ID from account list API (e.g., "<bank-id>")

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
    "id": "bankprod2|<cif>|20251031~4~STM~<bank-id>~OC~<document-sequence>~~~~~|<document-batch>|<document-reference>",
    "links": [
      {
        "rel": "self",
        "href": "https://bank.discover.com/bank/deposits/servicing/documents/v1/accounts/<bank-id>/statements/bankprod2%7C<cif>%7C20251031~4~STM~<bank-id>~OC~<document-sequence>~~~~~%7C<document-batch>%7C<document-reference>"
      },
      {
        "rel": "binary",
        "href": "https://bank.discover.com/bank/deposits/servicing/documents/v1/accounts/<bank-id>/statements/bankprod2%7C<cif>%7C20251031~4~STM~<bank-id>~OC~<document-sequence>~~~~~%7C<document-batch>%7C<document-reference>"
      }
    ]
  },
  {
    "name": "September 2025",
    "statementDate": "2025-09-30T00:00:00-0400",
    "id": "bankprod2|<cif>|20250930~4~STM~<bank-id>~OC~<document-sequence>~~~~~|<document-batch>|<document-reference>",
    "links": []
  }
]
```

##### Important Fields

- `name`: Human-readable statement name (e.g., "October 2025")
- `statementDate`: ISO 8601 formatted date (e.g., "2025-10-31T00:00:00-0400")
- `id`: Opaque statement identifier (encode once when constructing a download URL)
- `links[rel="binary"].href`: Direct download URL for the PDF file

**Statement ID Format**: Complex pipe-separated string containing:

- Environment (e.g., "bankprod2")
- CIF number (e.g., "<cif>")
- Date and metadata (e.g., "20251031~4~STM~<bank-id>~OC~<document-sequence>~~~~~")
- Timestamp (e.g., "<document-batch>")
- Hash/reference (e.g., "<document-reference>")

##### Captured Evidence

Observed in the referenced HAR:

- HTTP Method: GET
- Path Parameter: <bank-id>
- Response: 200 OK with array of statement objects

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
Cookie: dfsedskey=<card-id>; [other session cookies]
```

##### Request Parameters

**Query Parameters**:

- `view` (required): `true` (viewing mode)
- `date` (required): Statement date in YYYYMMDD format (e.g., "20251020")

**Cookie Requirements**:

- `dfsedskey` (required): Account key/ID that identifies which credit card account to download the statement for
  - Example: `dfsedskey=<card-id>`
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

##### Captured Evidence

Observed in the referenced HAR:

- HTTP Method: GET
- Query Parameters: view=true, date=20251020
- Cookie: dfsedskey=<card-id> (identifies the account)
- Response: 200 OK
- Content-Type: application/pdf

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
GET /bank/deposits/servicing/documents/v1/accounts/<bank-id>/statements/bankprod2%7C<cif>%7C20251031~4~STM~<bank-id>~OC~<document-sequence>~~~~~%7C<document-batch>%7C<document-reference> HTTP/1.1
Host: bank.discover.com
Accept: application/pdf, */*
Accept-Encoding: gzip, deflate, br, zstd
Accept-Language: en-US,en;q=0.9
Cookie: [session cookies]
```

##### Request Parameters

**Path Parameters**:

- `accountId` (required): Account ID (e.g., "<bank-id>")
- `statementId` (required): **URL-encoded statement ID** (e.g., "bankprod2%7C<cif>%7C20251031~4~STM~<bank-id>~OC~<document-sequence>~~~~~%7C<document-batch>%7C<document-reference>")

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

##### Statement ID Encoding

**Raw Statement ID**:

```
bankprod2|<cif>|20251031~4~STM~<bank-id>~OC~<document-sequence>~~~~~|<document-batch>|<document-reference>
```

**URL-Encoded Statement ID**:

```
bankprod2%7C<cif>%7C20251031~4~STM~<bank-id>~OC~<document-sequence>~~~~~%7C<document-batch>%7C<document-reference>
```

##### Captured Evidence

Observed in the referenced HAR:

- HTTP Method: GET
- Path Parameters: accountId=<bank-id>, statementId=bankprod2%7C<cif>%7C20251031~4~STM~<bank-id>~OC~<document-sequence>~~~~~%7C<document-batch>%7C<document-reference>
- Response: 200 OK
- Content-Type: application/pdf

#### Alternative: Using HATEOAS Links

The statement list API (Task 4) provides direct download URLs in the response:

```json
{
  "links": [
    {
      "rel": "binary",
      "href": "https://bank.discover.com/bank/deposits/servicing/documents/v1/accounts/<bank-id>/statements/bankprod2%7C<cif>%7C20251031~4~STM~<bank-id>~OC~<document-sequence>~~~~~%7C<document-batch>%7C<document-reference>"
    }
  ]
}
```

You can directly use the `href` from `links[rel="binary"]` without manually constructing the URL.

---

## API Endpoint Summary

Endpoints observed in the HAR file `<private-historical-capture>`:

| Task | API Endpoint | Method | Response |
| ---- | ------------ | ------ | -------- |
| Session ID | Cookies | N/A | Session cookies and their HttpOnly attributes |
| User Profile | `bank.discover.com/.../customer/profiles/v1` | GET | Profile ID and username |
| User Profile (Alt 1) | `portal.discover.com/.../customer/info/...` | GET | Profile and accounts |
| User Profile (Alt 2) | `card.discover.com/.../card-account-info` | POST | Display name and card details |
| List Accounts | `portal.discover.com/.../customeraccountinfo/v1/summary` | GET | Card and bank accounts |
| Card Statements | `card.discover.com/.../transactions/v1/recent` | GET | Most recent statement date |
| Bank Statements | `bank.discover.com/.../documents/v1/.../statements` | GET | Statement array |
| Card PDF | `card.discover.com/.../stmtPDF` | GET | PDF document |
| Bank PDF | `bank.discover.com/.../statements/{id}` | GET | PDF document |

### Domain-Specific Notes

API hosts and the currently exercised routing are:

- **portal.discover.com**: Account list, navigation, customer info
- **card.discover.com**: Credit card transactions and statements
- **bank.discover.com**: Bank account transactions and statements

The module uses a background request for cross-origin card calls and direct fetch
for bank calls. The current card-to-bank list response explicitly allows that
origin; do not infer a blanket CORS restriction from the endpoint host.

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

- **Credit Card**: Use `acctKey` (e.g., "<card-id>")
- **Bank Account**: Use `acctId` (e.g., "<bank-id>")
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

## Shared contract and failure handling

- Profile identity/display remain `profile.email` and `profile.name` from the
  portal responses. The existing cookie/session and partial portal-response
  behavior is unchanged; a transport failure does not prove a product is absent.
- Accounts include `selectedAccount` and `accounts` from both responses,
  deduplicated by `accountId`. The current checking subtype is `002`; other
  mappings remain historical compatibility behavior.
- Card statement IDs are validated `YYYYMMDD` values from `pdfUri`; dates use UTC
  midnight. Keep explicit `pdfAvailable: false` exclusions, but reject malformed
  available rows, invalid dates, missing arrays, or explicit business failures.
- Bank statement IDs retain the exact encoded binary link when provided,
  otherwise the opaque ID is encoded for download. Reject incomplete rows and
  invalid calendar components instead of silently returning a partial list.
- The background message response is reconstructed as a real `Response`; PDF
  data URLs are decoded locally without another network request. Worker failures
  propagate rather than silently falling back to native cross-origin fetch.
- Both downloads require `application/pdf` and a `%PDF-` prefix. These runtime
  guards do not replace full parsing, rendering and identity/period checks.

## Remaining scope limits

The observed session has one card and one checking account. Savings, multiple
cards, tax/year-end/transaction exports, retention guarantees, and authentication
or cross-user lifecycle behavior remain unverified. In particular, do not claim
that setting the card-selection cookie is safe for concurrent requests across
multiple cards without separate evidence.
