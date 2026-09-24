# American Express API Analysis

**Analysis as of:** 2026-09-24

This document describes the API endpoints and requirements for accessing American Express account and statement data.

## Scope and evidence

Bank identifier: `american_express`. The current investigation covered the
authenticated overview, one consumer credit card's statements, and Rewards
Checking financial statements. The credit-card REST and checking GraphQL
sequences below were observed through the bank's own UI. Both returned PDF
documents corresponding to the selected account and period.

Supplemental extension requests covered a Business Gold card and an Additional
Platinum card. The business card used the same REST sequence and provided a PDF.
The additional card returned transaction-export links without a statement PDF;
this does not establish that all additional-card accounts have the same
eligibility.

Savings, loans, accessible PDFs, transaction exports, and tax-document downloads
remain outside this scope. The module only exposes credit-card and Rewards
Checking statement PDFs, not savings accounts or tax documents. Historical
descriptions below are not evidence that other variants currently work.

## Quick Start

To download statements programmatically:

1. **Authenticate**: Log in via browser to get session cookies (`aat`, `pflt`, `amexsessioncookie`, etc.)
2. **Get Accounts**: Navigate to `https://global.americanexpress.com/overview` and extract account data from `window.__INITIAL_STATE__`
3. **List Statements**: Call `ReadAccountActivity.web.v1` with `view: "STATEMENTS"` to get download URLs
4. **Download PDFs**: Use the URLs from `downloadOptions.STATEMENT_PDF` to download files

**Key Point**: The `ReadAccountActivity.web.v1` API provides complete download URLs - you don't need to construct them manually.

**Important**: `__INITIAL_STATE__` is a JSON-encoded string containing Transit
JSON. The example expressions below operate on the string after `JSON.parse()`;
the implementation instead matches escaped quotes in the original JSON string
literal. Do not mix these representations. Deduplicate repeated account tokens.

## Base URLs

**Servicing APIs**:

```
https://global.americanexpress.com/api/servicing
```

**Functions/Activity APIs**:

```
https://functions.americanexpress.com
```

**Web Pages**:

```
https://global.americanexpress.com
```

## Authentication Requirements

Requests use the browser's authenticated cookies with `credentials: "include"`.
The following cookie and header names come from historical captures; their
presence does not establish that every one is necessary.

### Session cookies

- `aat`: JWT access token (contains user authentication and session information)
- `pflt`: Platform token (JWT with long expiry)
- `amexsessioncookie`: Session cookie containing encrypted session data
- `JSESSIONID`: Java session identifier (used as stable session ID for caching)
- `gatekeeper`: Security/fraud detection token
- `blueboxvalues`: Device fingerprint identifier
- `device-id`: Unique device identifier
- `agent-id`: User agent identifier

`JSESSIONID` remained readable through `document.cookie` on the authenticated
Amex page and supplies the extension's session identifier. Do not copy cookie
values into the report or manually reproduce them in headers. Reopening the
site can require login and two-step verification again; token expiry timing was
not measured in this investigation.

### Request headers

Varies by endpoint. Common headers include:

- `Accept`: `application/json` or `text/html` depending on endpoint
- `Content-Type`: `application/json` for POST requests
- `User-Agent`: Standard browser user agent string
- `one-data-correlation-id`: Unique request ID for ReadAccountActivity API (format: `CSR-<UUID>`)

## API Endpoints

### 1. Get Account Data

**Purpose**: Retrieve all credit cards and accounts with balances, details, and metadata.

**Source used by the integration**: Account data is embedded in the overview
HTML. The UI also calls `POST /ReadCustomerOverviewSecondary.web.v1` on the
functions domain; that observation does not establish a replacement account-list
contract.

**Method**: Navigate to the overview/dashboard page and extract `window.__INITIAL_STATE__` from the HTML.

**Full URL**:

```
https://global.americanexpress.com/overview
```

**HTTP Method**: `GET`

**Headers**:

- All standard authentication cookies (aat, pflt, amexsessioncookie, JSESSIONID, gatekeeper)
- `Accept`: `text/html`
- `User-Agent`: Browser user agent

**Response**: Returns HTML page with embedded JavaScript containing account data.

**Data Location**:

- Embedded in `<script>` tag as: `window.__INITIAL_STATE__ = "..."`
- Format: Transit JSON encoding, including `~#iM` maps
- Contains: All accounts, balances, card details, rewards points, recent activity, etc.

The captured `GET /overview` returned HTTP 200 with `text/html`. A fresh
authenticated fetch still contained the expected assignment and account fields,
while the hydrated page no longer exposed the state script through
`document.scripts`. Fetch the HTML rather than assuming the live DOM retains it.

**Accessing Account Data**:

The account information is embedded in Transit-encoded format within `window.__INITIAL_STATE__`. To extract accounts:

1. **Extract and parse the state string** from HTML:

   ```javascript
   const stateMatch = html.match(
     /window\.__INITIAL_STATE__\s*=\s*(.+?);\s*window\.__holocron/s
   );
   // Important: The matched string is JSON-encoded and must be parsed
   const stateString = JSON.parse(stateMatch[1]);
   ```

2. **Extract account tokens** (first section of state):

   - Location: Early in state under `"axp-consumer-context-switcher"` → `"registry"` → `"CARD_PRODUCT"`
   - Pattern: `["^ ","type","CARD_PRODUCT","accountToken","XXX","accountKey","YYY"]`

3. **Extract account details** (second section of state):

   - Location: Later in state under `"details"` → `"productsList"` → `"TOKEN"`
   - Each account has:
     - `display_account_number`: Last 5 digits (e.g., "91001")
     - `product.description`: Card name (e.g., "Platinum Card®")

4. **Complete extraction code** (with deduplication):

   ```javascript
   // Step 1: Get account tokens (using Map for deduplication)
   const tokenPattern =
     /"type","CARD_PRODUCT","accountToken","([A-Z0-9]+)","accountKey","([A-F0-9]+)"/g;
   const accountsMap = new Map();
   let match;
   while ((match = tokenPattern.exec(stateString))) {
     const accountToken = match[1];
     const accountKey = match[2];

     // Deduplicate by accountToken
     if (!accountsMap.has(accountToken)) {
       accountsMap.set(accountToken, {
         accountToken,
         accountKey,
       });
     }
   }

   // Step 2: Get account details (name and last digits)
   for (const account of accountsMap.values()) {
     const detailPattern = new RegExp(
       `"${account.accountToken}".*?"display_account_number","(\\d+)".*?"description","([^"]+)"`,
       "s"
     );
     const detailMatch = stateString.match(detailPattern);
     if (detailMatch) {
       account.lastFiveDigits = detailMatch[1]; // e.g., "91001"
       account.cardName = detailMatch[2]; // e.g., "Platinum Card®"
     }
   }

   const accounts = Array.from(accountsMap.values());
   ```

5. **Example result**:

   ```javascript
   [
     {
       accountToken: "A1BCDEF2GHI3JKL",
       accountKey: "12AB3C4D56EF7G8H9I01J234K567LM89",
       lastFiveDigits: "91001",
       cardName: "Platinum Card®",
     },
   ];
   ```

6. **Use the tokens**:
   - `accountToken` is used in the request body when calling `ReadAccountActivity.web.v1`
   - `accountKey` identifies the selected card in page URLs. For PDF downloads,
     retain the `account_key` already supplied in the complete download URL.

---

### 2. List Statements and Get Download URLs

**Purpose**: Retrieve all available billing statements with download URLs for PDF, Excel, CSV, and other formats.

**Observed UI action**: Open "Go to PDF Statements" at
`https://global.americanexpress.com/activity/statements`. In this session, the
activity page's client-side link initially left the recent-activity view visible;
normal navigation to that same link URL loaded the statements page. This is
separate from the extension's API flow.

**Endpoint**: `POST https://functions.americanexpress.com/ReadAccountActivity.web.v1`

**HTTP Method**: `POST`

**Headers**:

- All standard authentication cookies
- `Content-Type`: `application/json`
- `one-data-correlation-id`: Unique request ID (format: `CSR-<UUID>`)

**Request Body**:

```json
{
  "accountToken": "A1BCDEF2GHI3JKL",
  "axplocale": "en-US",
  "view": "STATEMENTS"
}
```

**Required Parameters**:

- `accountToken`: The account token obtained from the overview page
- `axplocale`: Locale code (e.g., `en-US`)
- `view`: Must be `"STATEMENTS"` to get billing statements

**Response Structure**:

The observed response was HTTP 200 with `application/json`. Its first recent
statement had `statementEndDate: "2026-09-20"` and the download formats shown
below. "Recent Statements" and "Older Statements" are separate UI groups backed
by the response arrays, not a guarantee of one statement for every calendar
month.

The business-card response contained `billingStatements.recentStatements` with
one entry and omitted `olderStatements`; an omitted group is not an API failure.
The additional-card response contained the same dated entry structure but offered
only `EXCEL`, `CSV`, `QUICKBOOKS`, and `QUICKEN` in `downloadOptions`:

```json
{
  "statementEndDate": "2026-09-20",
  "downloadOptions": {
    "EXCEL": "<transaction-export-url>",
    "CSV": "<transaction-export-url>",
    "QUICKBOOKS": "<transaction-export-url>",
    "QUICKEN": "<transaction-export-url>"
  }
}
```

Such export-only entries are valid activity periods, not downloadable billing
PDFs. Exclude them from the PDF statement list rather than inventing a PDF URL or
failing the account. If no PDF entries remain, the extension displays its normal
"No statements available" message. A malformed or empty `STATEMENT_PDF` value,
when actually supplied, is still an error.

```json
{
  "member": {
    /* member info */
  },
  "billingStatements": {
    "recentStatements": [
      {
        "statementEndDate": "2025-10-21",
        "downloadOptions": {
          "STATEMENT_PDF": "https://global.americanexpress.com/api/servicing/v1/documents/statements/{ENCRYPTED_ID}?account_key={KEY}&client_id=OneAmex",
          "ACCESSIBLE_STATEMENT_PDF": "https://...",
          "EXCEL": "https://global.americanexpress.com/api/servicing/v1/financials/documents?account_key={KEY}&file_format=excel&statement_end_date=2025-10-21...",
          "CSV": "https://...",
          "QUICKBOOKS": "https://...",
          "QUICKEN": "https://..."
        }
      }
    ],
    "olderStatements": [
      /* same structure */
    ]
  },
  "usefulLinks": {
    /* links */
  }
}
```

**Key Response Fields**:

- `billingStatements.recentStatements[]`: Array of recent statements (typically last 6)
- `billingStatements.olderStatements[]`: Array of older statements
- `statementEndDate`: Statement end date (YYYY-MM-DD)
- `downloadOptions.STATEMENT_PDF`: Full URL with encrypted statement ID for PDF download
- `downloadOptions.EXCEL/CSV/QUICKBOOKS/QUICKEN`: Transaction export URLs by format

**Extracting Statement Information**:

```javascript
const response = await fetch(
  "https://functions.americanexpress.com/ReadAccountActivity.web.v1",
  {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "one-data-correlation-id": `CSR-${crypto.randomUUID()}`,
      /* other auth headers */
    },
    body: JSON.stringify({
      accountToken: "A1BCDEF2GHI3JKL",
      axplocale: "en-US",
      view: "STATEMENTS",
    }),
  }
);
const data = await response.json();

// Get all statements with download URLs
const allStatements = [
  ...data.billingStatements.recentStatements,
  ...data.billingStatements.olderStatements,
];

// Process statements
const statements = allStatements.map((stmt) => {
  const pdfUrl = stmt.downloadOptions.STATEMENT_PDF;

  return {
    date: stmt.statementEndDate,
    pdfUrl: stmt.downloadOptions.STATEMENT_PDF,
    excelUrl: stmt.downloadOptions.EXCEL,
    csvUrl: stmt.downloadOptions.CSV,
    quickbooksUrl: stmt.downloadOptions.QUICKBOOKS,
    quickenUrl: stmt.downloadOptions.QUICKEN,
  };
});
```

---

### 3. Download PDF Statement

**Purpose**: Download a specific billing statement as PDF file.

**Endpoint**: Use the complete URL from `ReadAccountActivity.web.v1` response

**URL Pattern**:

```
https://global.americanexpress.com/api/servicing/v1/documents/statements/{ENCRYPTED_ID}?account_key={ACCOUNT_KEY}&client_id=OneAmex
```

**HTTP Method**: `GET`

**Important**: The complete download URL is provided in the `downloadOptions.STATEMENT_PDF` field from the ReadAccountActivity response. You don't need to construct it manually.

**URL Components**:

- `{encrypted_statement_id}`: 200+ character hex string uniquely identifying the statement
- `account_key`: Encrypted account identifier matching the `accountKey` from overview page
- `client_id`: Always `OneAmex`

**Headers**:

- All standard authentication cookies
- `Accept`: `text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8`
- `User-Agent`: Browser user agent

**Response**:

- Content-Type: `application/pdf`
- Content-Disposition: `attachment; filename=2025-10-21.pdf`
- Binary PDF file data

The bank's Download button opens a file-type dialog. Selecting "Billing
Statement (PDF)" and confirming issued a GET to the URL supplied by the list
response and returned HTTP 200 with `application/pdf`. No secondary download
domain was observed in this flow.

---

## Additional API Endpoints

### Financial Eligibilities

**Endpoint**: `GET /v1/financials/eligibilities`
**Purpose**: Check user's eligibility for various financial products and services

### Prefetch Data

**Endpoint**: `GET /v2/prefetch?inav=iNavLnkLog`
**Purpose**: Preload user data for faster page rendering (called on login)

---

## Authentication and error boundaries

- Historical notes attributed device-management roles to cookies such as
  `blueboxvalues`, `MATFSI`, `_abck`, and `bm_sz`. Their exact necessity, token
  lifetimes, and CSRF roles were not isolated by this investigation.
- Use the existing browser session over HTTPS. No minimum TLS version, required
  retry delay, or rate-limit threshold was established.
- Login redirects or authentication errors are not empty statement lists.
  Missing response structures, malformed statement dates, and missing download
  references should be surfaced as errors rather than replaced with today's date
  or a fabricated identifier.
- HTTP 200 alone does not establish a successful PDF download. A login page or
  JSON error must not be saved as a statement.

---

## Authentication Flow

1. User logs in through web browser to `https://www.americanexpress.com`
2. After successful authentication, cookies are set including `aat`, `pflt`, `amexsessioncookie`, `JSESSIONID`
3. The implementation uses the readable `JSESSIONID` cookie as its session cache identifier; comparative cookie stability was not measured
4. Navigate to `/overview` page and extract `accountToken` and `accountKey` from `window.__INITIAL_STATE__`
5. Call `ReadAccountActivity.web.v1` with `view: "STATEMENTS"` to get all statements with download URLs
6. Download statement PDFs directly using the URLs from `downloadOptions.STATEMENT_PDF`

---

## Implementation Notes

- **Authentication**: All API calls require valid session cookies obtained from browser login
- **Browser controls**: Complete login and any verification through the bank UI; do not conceal automation signals or bypass fraud controls
- **Opaque values**: Account keys, proxies, and document references come from the bank. Do not infer their lifetime or encoding requirements from their appearance
- **Download URLs**: Always use the complete URLs from `ReadAccountActivity.web.v1` response - don't construct manually
- **File Format**: PDFs use Content-Disposition header with filename format `YYYY-MM-DD.pdf`
- **Transit JSON**: The existing extraction matched this overview. Its assumptions about field order and nearby account details remain format dependencies, not a general Transit decoder
- **Alternative Formats**: Excel, CSV, QuickBooks, and Quicken formats available via `downloadOptions`

---

## Checking Accounts (Rewards Checking)

American Express checking accounts use a different API architecture than credit cards. While credit cards use REST APIs at `functions.americanexpress.com`, checking accounts use GraphQL at `graph.americanexpress.com`.

### Overview

**Base URL**: `https://graph.americanexpress.com/graphql`

**Authentication**: Same session cookies as credit cards (`aat`, `pflt`, `amexsessioncookie`, etc.)

**API Type**: GraphQL (all operations via POST to `/graphql` endpoint)

**Account Identification**:

- **Parameter Name**: `accountNumberProxy` (in API requests) or `opaqueAccountId` (in page URLs)
- **Format**: Opaque URL-safe string (e.g., `YZ_8mnopqRSTU3vw_x45AbCdEfGhIjKl67Mn89OpQrS`); do not decode it or use its shape to infer the account type
- **Product Class**: `PERSONAL_CHECKING_ACCOUNT`
- **Page URL Path**: `/banking/*` (vs `/activity/*` for the observed credit-card statement pages)

### GraphQL Operations

All checking account operations use `POST https://graph.americanexpress.com/graphql` with different GraphQL queries.

#### 1. Get Account Information

**Operation**: `checkingAccountDataQuery`

**Purpose**: Retrieves basic checking account information including status, product name, and account details.

**Request Body**:

```json
{
  "operationName": "checkingAccountDataQuery",
  "variables": {
    "filter": {
      "productClass": "PERSONAL_CHECKING_ACCOUNT",
      "accountNumberProxy": "YZ_8mnopqRSTU3vw_x45AbCdEfGhIjKl67Mn89OpQrS"
    }
  },
  "query": "query checkingAccountDataQuery($filter: ProductAccountByAccountNumberProxyInput!) {\n  productAccountByAccountNumberProxy(filter: $filter) {\n    __typename\n    ... on CheckingAccount {\n      lastDigits\n      isRestricted\n      status\n      product {\n        name\n        __typename\n      }\n      fundingStatus\n      openDate\n      __typename\n    }\n  }\n}\n"
}
```

**Response Fields**:

- `lastDigits`: Last 4 digits of account number (e.g., "5725")
- `isRestricted`: Whether account has restrictions (boolean)
- `status`: Account status (e.g., "ACTIVE")
- `product.name`: Product name (e.g., "American Express Rewards Checking")
- `fundingStatus`: Funding status (e.g., "FUNDED")
- `openDate`: Account opening date (e.g., "2023-10-05")

#### 2. Get Account Statements List

**Operation**: `bankingAccountDocuments`

**Purpose**: Retrieves available statements for the checking account.

**Request Body**:

```json
{
  "operationName": "bankingAccountDocuments",
  "variables": {
    "accountFilter": {
      "productClass": "PERSONAL_CHECKING_ACCOUNT",
      "accountNumberProxy": "YZ_8mnopqRSTU3vw_x45AbCdEfGhIjKl67Mn89OpQrS"
    },
    "documentFilter": {
      "type": "FINANCIAL"
    }
  },
  "query": "query bankingAccountDocuments($accountFilter: ProductAccountByAccountNumberProxyInput!, $documentFilter: CheckingAccountStatementInput) {\n  productAccountByAccountNumberProxy(filter: $accountFilter) {\n    ... on CheckingAccount {\n      statements(filter: $documentFilter) {\n        document\n        identifier\n        type\n        year\n        month\n        __typename\n      }\n      __typename\n    }\n    __typename\n  }\n}\n"
}
```

**Response Fields**:

- `document`: Type (e.g., "MONTHLY_STATEMENT")
- `identifier`: Document URN (e.g., "URN:AXP:SCS:BANKING_STATEMENTS:DOC:BS:bb3c45de-f67g-89hi-0j12-3456k78901l2-3456")
- `type`: "FINANCIAL" or "TAX"
- `year`: Statement year
- `month`: Statement month (null for tax documents)

The observed `FINANCIAL` request returned HTTP 200 with 33 monthly statements.
The latest entry was:

```json
{
  "document": "MONTHLY_STATEMENT",
  "identifier": "<checking-document-urn>",
  "type": "FINANCIAL",
  "year": "2026",
  "month": "08",
  "__typename": "CheckingAccountStatement"
}
```

The UI grouped these documents by year, with an "August 2026" link. No pagination
arguments were used for this list. A separate request with `type: "TAX"` returned
a tax-document entry whose `month` was null; the integration intentionally requests
only `FINANCIAL`, and tax downloads were not exercised.

#### 3. Download Statement PDF

**Operation**: `accountDocument`

**Purpose**: Retrieves the PDF content of a specific statement as base64-encoded data.

**Request Body**:

```json
{
  "operationName": "accountDocument",
  "variables": {
    "filter": {
      "identifier": "URN:AXP:SCS:BANKING_STATEMENTS:DOC:BS:bb3c45de-f67g-89hi-0j12-3456k78901l2-3456",
      "accountNumberProxy": "YZ_8mnopqRSTU3vw_x45AbCdEfGhIjKl67Mn89OpQrS"
    }
  },
  "query": "query accountDocument($filter: CheckingAccountStatementFilterInput!) {\n  checkingAccountStatement(filter: $filter) {\n    name\n    contentType\n    content\n    __typename\n  }\n}\n"
}
```

**Response Fields**:

- `name`: Filename (e.g., "statement.pdf")
- `contentType`: MIME type ("application/pdf")
- `content`: Base64-encoded PDF content

**Notes**:

- The `identifier` must be obtained from the statements list API
- PDF content is embedded as base64-encoded string in the JSON response
- Decode the base64 `content` field to get the PDF file
- Response size is typically 500KB-1MB per statement

Clicking "August 2026" issued this operation and returned HTTP 200 with
`checkingAccountStatement.contentType: "application/pdf"`. The bank decoded
`content` and opened a Blob URL in a PDF viewer. This is not a second PDF GET to
an Amex REST endpoint. The captured document content decoded to a readable PDF;
do not treat the historical typical response-size range as a validity check.

### Checking Account Usage Flow

1. **Get account information**: Use `checkingAccountDataQuery` operation to retrieve account status, product name, and basic details
2. **List statements**: Use `bankingAccountDocuments` operation with `type: "FINANCIAL"` to get available statements
3. **Download statement**: Use `accountDocument` operation with the statement `identifier` from step 2 to get base64-encoded PDF content

### Differences Between Credit Cards and Checking Accounts

| Feature            | Credit Cards                         | Checking Accounts                   |
| ------------------ | ------------------------------------ | ----------------------------------- |
| API Type           | REST (functions.americanexpress.com) | GraphQL (graph.americanexpress.com) |
| Account ID         | `accountToken` from overview         | `opaqueAccountId` / `accountNumberProxy` |
| Account Info       | Overview HTML; secondary UI requests | `checkingAccountDataQuery` operation |
| Statements List    | `ReadAccountActivity.web.v1`, `view: "STATEMENTS"` | `bankingAccountDocuments` operation |
| Statement Download | Complete `downloadOptions.STATEMENT_PDF` URL | `accountDocument` operation (base64) |
| Download Format    | Direct PDF download (binary)         | Base64-encoded in JSON response     |
| Page URL Path      | /activity/\*                         | /banking/\*                         |
| Product Class      | CARD_PRODUCT                         | PERSONAL_CHECKING_ACCOUNT           |

## Shared contract mapping

These mappings implement the [shared bank contract](../bank/bank.types.ts).

- **Profile:** `sessionId` and `profileId` use the readable `JSESSIONID` cookie.
  `profileName` comes from `embossed_name` in the fetched overview state, with
  `American Express` as the existing display fallback when no name is present.
- **Credit-card account:** `accountToken` maps to `accountId`,
  `product.description` to `accountName`, and `display_account_number` to the
  five-digit `accountMask`. `accountType` is `CreditCard`.
- **Checking account:** the overview's `opaqueAccountId` maps to `accountId` and
  supplies GraphQL's `accountNumberProxy`. `productDisplayName` and
  `displayAccountNumber` supply the name and four-digit mask. `accountType` is
  `Checking`; API routing uses this type, not the opaque ID's length or alphabet.
- **Credit-card statement:** the complete `STATEMENT_PDF` URL is retained as
  `statementId`, preserving its query parameters. `statementEndDate` must be a
  valid `YYYY-MM-DD` and becomes a UTC ISO timestamp. Downloads use that URL
  directly; no additional overview request or reconstructed account key is needed.
  Entries that only offer transaction exports are omitted.
- **Checking statement:** `identifier` maps to `statementId`. Valid `year` and
  `month` values become the last calendar day of that month at UTC midnight,
  independent of the machine's time zone. The source provides a month, not a
  precise statement-closing timestamp.
- **Downloaded Blob:** REST returns the PDF body; GraphQL returns base64 that is
  decoded into bytes. Both paths reject empty or non-PDF-looking payloads. MIME
  type and a PDF signature are only runtime guards, not proof of readability.

The credit-card statement identifier previously retained only a hex substring
and rebuilt the URL. Reload the extension and refresh accounts when moving to
the full-URL representation so cached legacy identifiers are not reused.
