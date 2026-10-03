# American Express Statement API Analysis

**Analysis as of:** 2026-09-24

## Scope and evidence

**Bank ID:** `american_express`
**Domains:** `https://global.americanexpress.com` hosts overview HTML and card PDFs;
`https://functions.americanexpress.com` serves card activity;
`https://graph.americanexpress.com/graphql` serves Rewards Checking GraphQL.
Use the bank's public sign-in UI at `https://www.americanexpress.com`.

| Account type / flow | Evidence basis and source | Scope boundary |
| --- | --- | --- |
| Consumer credit card | Observed: overview, Go to PDF Statements, Billing Statement (PDF) selection | REST statement list and supplied PDF URL |
| Business and additional cards | Observed: account-specific activity responses; Code-derived: [Amex module](../bank/american_express.mjs) | Same REST flow; a period may offer only transaction exports |
| Rewards Checking | Observed: banking account pages and financial-document actions | GraphQL account details, monthly financial statements and base64 PDF content |
| Savings, loans, tax and accessible documents | Unverified | Outside the module's checking/card standard-PDF scope |

## Authentication and session context

**Session ownership:** complete login and verification through the bank UI. The
module uses existing cookies with `credentials: "include"` and delegates renewal
to the bank.
**Authentication material:** read `JSESSIONID` for the module's session/profile
identifier, preserving embedded `=`. Missing `JSESSIONID` is an error. Other
authentication cookies are supplied by the browser.
**Lifecycle:** token lifetimes, comparative cookie stability and exact CSRF
requirements are Unknown.
**Execution context:** run from the authenticated Amex page; service calls use
their specified HTTPS origin and browser credentials.

| Request family | Application headers | Evidence basis |
| --- | --- | --- |
| Overview HTML | HTML-accepting `Accept` | Observed response/source; Code-derived fetch helper |
| Card activity POST | `Content-Type: application/json`, `one-data-correlation-id: CSR-<fresh-UUID>`, `ce-source: WEB` | Observed operation; Code-derived request construction |
| Checking GraphQL | `Content-Type: application/json`, `Accept: */*`, `ce-source: WEB`, `correlation-id: <fresh-UUID>` | Observed operation; Code-derived request construction |
| Card PDF | `Accept: application/pdf` | Code-derived download request |

The module's common helper sends `Accept-Language: en-US,en;q=0.9`. Individual
header necessity beyond these accepted request contexts is Unknown.

## API flow

**Sequence:** read session context; OP-1 supplies profile and account selectors.
For CreditCard use OP-2 -> OP-3. For Checking use OP-5 -> OP-6, with OP-4 describing
the bank UI's account-detail query. Route using the shared `accountType`.

**Common errors (Code-derived):** report non-success HTTP status. For GraphQL,
parse an object-valued envelope, surface nonempty `errors`, and require `data`
before operation-specific field checks.

### OP-1: Read overview state for profile and account discovery

**Evidence basis:** Observed: `/overview` HTML contains the serialized state;
Code-derived: `extractInitialState` and `extractAccountsFromOverview`.
**Request:** `GET https://global.americanexpress.com/overview`, empty body.
**Context and prerequisites:** authenticated page and session cookie.
**Response and processing:** HTTP 200 `text/html`. Locate the assignment between
`window.__INITIAL_STATE__ =` and `; window.__holocron`. The assignment's value
is a JSON string literal containing Transit JSON (`~#iM` maps).

```javascript
const match = html.match(/window\.__INITIAL_STATE__\s*=\s*(.+?);\s*window\.__holocron/s);
if (!match) throw new Error("Overview state is unavailable");
const stateLiteral = match[1];
const transitText = JSON.parse(stateLiteral);
```

This illustrates the two representations. The module matches escaped quotes in
`stateLiteral`; parsers operating on `transitText` should match its decoded quote
representation. Obtain fresh HTML for this source because hydration can remove
the state script from the live DOM.

**Outputs and selection:**

| Data | Source within state | Association |
| --- | --- | --- |
| Profile display name | `embossed_name` | Shared profile; default `American Express` |
| Card selector | `axp-consumer-context-switcher` -> `registry` -> `CARD_PRODUCT` entries with `accountToken` and `accountKey` | Deduplicate by accountToken |
| Card display data | `details/productsList` entry associated with the token: `display_account_number`, product `description` | Five-digit card mask and product display name |
| Checking selector | `opaqueAccountId` | Same value supplies GraphQL `accountNumberProxy`; deduplicate by proxy |
| Checking display data | Associated productsList `productDisplayName` and `displayAccountNumber` | Checking name and four-digit mask |

**Extraction procedure (Code-derived):** use the encoded `stateLiteral` from the
example above with the module's escaped-quote patterns. Collect card selectors
once per token:

```javascript
const tokenPattern = /accountToken\\",\\"([A-Z0-9]+)\\",\\"accountKey\\",\\"([A-F0-9]+)\\"/g;
const cards = new Map();
for (const [, accountToken, accountKey] of stateLiteral.matchAll(tokenPattern)) {
  if (!cards.has(accountToken)) cards.set(accountToken, { accountToken, accountKey });
}
```

Locate `productsList` in the same literal and associate its detail entries with
the collected selectors. The module searches the next 50,000 characters, then
reads up to 1,000 characters from a card's quoted token for
`display_account_number` and product `description`.

For checking, collect `opaqueAccountId` using
`/opaqueAccountId\\",\\"([A-Za-z0-9_\-]+)\\"/g`. The module excludes all-uppercase
alphanumeric candidates shorter than 20 characters, deduplicates the remaining
proxies against the collected selectors, and requires a matching productsList
entry. Read up to 800 characters from that proxy for four-digit
`displayAccountNumber` and `productDisplayName`.

These character windows and the checking heuristic describe the current extractor,
not bank-defined size or identifier guarantees. They depend on field order and
state layout. `accountKey` selects a card in page URLs; OP-3 uses the complete PDF
URL already supplied by OP-2. Statement/download routing uses `accountType`.

**Errors and empty results:** report missing state assignments and extraction
failures. Code-derived display fallbacks include an empty mask when unavailable,
`Card ending in <mask>` for an unnamed card, and `Checking Account` for an unnamed
checking account. The general meaning of absent account fields is Unknown.
**Pagination and statement coverage:** use selectors from the overview state.
`ReadCustomerOverviewSecondary.web.v1` is a UI request, not an established
alternative source for this module's account contract.

### OP-2: List card statement dates and PDF URLs

**Evidence basis:** Observed: Go to PDF Statements at
`https://global.americanexpress.com/activity/statements`.
**Request:** `POST https://functions.americanexpress.com/ReadAccountActivity.web.v1`,
JSON body:

```json
{"accountToken":"<card-token>","axplocale":"en-US","view":"STATEMENTS"}
```

**Context and prerequisites:** OP-1 card token and card-POST headers.
**Inputs:** selected `accountToken`; fixed locale and view as shown.
**Response and processing:** HTTP 200 JSON; concatenate available recent/older
groups and sort included PDF periods newest first:

```json
{
  "billingStatements": {
    "recentStatements": [{
      "statementEndDate": "2000-02-29",
      "downloadOptions": {
        "STATEMENT_PDF": "https://global.americanexpress.com/api/servicing/v1/documents/statements/synthetic-document?account_key=synthetic-key&client_id=OneAmex"
      }
    }],
    "olderStatements": []
  }
}
```

**Outputs:** complete `STATEMENT_PDF` URL and its `statementEndDate`.
**Selection and association:** use only standard billing PDFs for the selected
card. If `STATEMENT_PDF` is absent and any of `EXCEL`, `CSV`, `QUICKBOOKS` or
`QUICKEN` supplies a nonempty URL, exclude that export-only period. Other download
formats, including `ACCESSIBLE_STATEMENT_PDF`, are outside OP-3.
**Errors and empty results:** require `billingStatements` and at least one
array-valued recent/older group; either group may be omitted, but every present
group must be an array. Explicit empty arrays or entirely export-only periods
yield no PDF statements. A supplied empty/invalid PDF URL or invalid `YYYY-MM-DD`
calendar date is an error.
**Pagination and statement coverage:** recent/older UI groups correspond to the
response arrays. Use the dates actually supplied; additional pagination and
retention guarantees are Unknown.

### OP-3: Download a card billing PDF

**Evidence basis:** Observed: Download > Billing Statement (PDF).
**Request:** `GET` the complete OP-2 URL, empty body and PDF headers.
**Context and prerequisites:** selected card statement; browser credentials.
**Inputs:** retain all URL components, including the encrypted document reference,
`account_key` and `client_id=OneAmex`.
**Response and delivery:** HTTP 200 `application/pdf`; the response body is the
document, with a date-based Content-Disposition filename. This flow uses the
servicing host directly.
**Outputs:** PDF Blob.
**Errors and empty results (Code-derived):** validate URL origin
`https://global.americanexpress.com`, a nonempty path under
`/api/servicing/v1/documents/statements/`, and absence of URL credentials. Use the
validated original URL unchanged. Reject HTTP errors, empty bodies, MIME mismatch
and bytes without `%PDF-`. URL-reference expiry/reuse guarantees are Unknown.

### OP-4: Read Rewards Checking account details

**Evidence basis:** Observed: banking account pages use `checkingAccountDataQuery`.
**Request:** `POST https://graph.americanexpress.com/graphql`, JSON containing
`operationName: "checkingAccountDataQuery"`, variables below, and query text:

```json
{"filter":{"productClass":"PERSONAL_CHECKING_ACCOUNT","accountNumberProxy":"<checking-proxy>"}}
```

```graphql
query checkingAccountDataQuery($filter: ProductAccountByAccountNumberProxyInput!) {
  productAccountByAccountNumberProxy(filter: $filter) {
    __typename
    ... on CheckingAccount {
      lastDigits
      isRestricted
      status
      product { name __typename }
      fundingStatus
      openDate
      __typename
    }
  }
}
```

**Context and prerequisites:** OP-1 proxy; shared checking GraphQL headers.
**Response and processing:** HTTP 200 JSON at
`data.productAccountByAccountNumberProxy`, with checking status, four-digit
`lastDigits`, `product.name` and restriction/funding fields.
**Outputs:** bank-UI account detail. Module discovery instead uses OP-1's display
fields, so OP-4 is not an extra request in `getAccounts`.
**Errors and empty results:** apply common GraphQL checks; closed/restricted or
missing-account semantics for this operation are Unknown.

### OP-5: List checking financial statements

**Evidence basis:** Observed: banking statement page and its yearly groups.
**Request:** `POST https://graph.americanexpress.com/graphql`, with
`operationName: "bankingAccountDocuments"`, these variables and query:

```json
{
  "accountFilter":{"productClass":"PERSONAL_CHECKING_ACCOUNT","accountNumberProxy":"<checking-proxy>"},
  "documentFilter":{"type":"FINANCIAL"}
}
```

```graphql
query bankingAccountDocuments($accountFilter: ProductAccountByAccountNumberProxyInput!, $documentFilter: CheckingAccountStatementInput) {
  productAccountByAccountNumberProxy(filter: $accountFilter) {
    ... on CheckingAccount {
      statements(filter: $documentFilter) {
        document
        identifier
        type
        year
        month
        __typename
      }
      __typename
    }
    __typename
  }
}
```

**Context and prerequisites:** OP-1 checking proxy and GraphQL headers.
**Response and processing:** HTTP 200 JSON:

```json
{
  "data": {
    "productAccountByAccountNumberProxy": {
      "statements": [{
        "document":"MONTHLY_STATEMENT",
        "identifier":"<checking-document-urn>",
        "type":"FINANCIAL",
        "year":"2000",
        "month":"02"
      }]
    }
  }
}
```

**Outputs:** document URN and represented month/year.
**Selection and association:** request `PERSONAL_CHECKING_ACCOUNT` for the selected
proxy and `FINANCIAL` documents. Tax entries use `TAX` and may have null month;
their downloads are outside this flow.
**Errors and empty results (Code-derived):** require a statements array, nonblank
identifier, four-digit year of at least 1000, and month 1-12. Numeric/string period
values accepted by the module are converted to numbers. Explicit empty arrays
are valid; incomplete periods are errors.
**Pagination and statement coverage:** use the returned array; no pagination
arguments are used in this operation. Sort month-end dates newest first.

### OP-6: Retrieve and decode a checking PDF

**Evidence basis:** Observed: selecting a monthly link issues `accountDocument`.
**Request:** `POST https://graph.americanexpress.com/graphql`, with
`operationName: "accountDocument"`, variables and query:

```json
{"filter":{"identifier":"<checking-document-urn>","accountNumberProxy":"<checking-proxy>"}}
```

```graphql
query accountDocument($filter: CheckingAccountStatementFilterInput!) {
  checkingAccountStatement(filter: $filter) {
    name
    contentType
    content
    __typename
  }
}
```

**Context and prerequisites:** selected OP-5 identifier and its OP-1 account proxy;
shared GraphQL headers.
**Response and processing:** HTTP 200 JSON at `data.checkingAccountStatement`;
`name` is a filename, `contentType` is `application/pdf`, and `content` is base64.
**Delivery and outputs:** decode `content` into bytes and construct a PDF Blob.
The bank UI may display that Blob in a viewer; the content comes from this JSON
response.
**Errors and empty results:** surface GraphQL errors, absent/empty content, invalid
base64 and PDF MIME/signature failures. Use OP-3's nonempty PDF-byte checks.

## Shared contract mapping

| Contract field / flow | Source operation and field | Meaning, conversion and runtime checks |
| --- | --- | --- |
| Profile.sessionId / profileId | Readable `JSESSIONID` | Module session association |
| Profile.profileName | OP-1 `embossed_name` | Display name, default `American Express` |
| Account.profile / Statement.account | Caller profile / selected account | Preserve associations |
| Account.accountId / card | OP-1 `accountToken` | Card activity request selector |
| Account.accountId / checking | OP-1 `opaqueAccountId` | GraphQL `accountNumberProxy` |
| Account.accountName / accountMask | OP-1 product fields | Card description + five-digit display number; checking productDisplayName + four-digit display number |
| Account.accountType | OP-1 product extraction | CreditCard or Checking; used for API dispatch |
| Statement.statementId / card | OP-2 `STATEMENT_PDF` | Full original URL for OP-3 |
| Statement.statementDate / card | OP-2 `statementEndDate` | Valid calendar end date at UTC midnight |
| Statement.statementId / checking | OP-5 `identifier` | Full opaque URN for OP-6 |
| Statement.statementDate / checking | OP-5 year/month | Last calendar day at UTC midnight; representation of a month, not an exact closing timestamp |
| Downloaded Blob | OP-3 / OP-6 | Direct PDF body / base64-decoded bytes with runtime MIME/signature checks |

## Limitations and open questions

- **Unsupported by this module:** savings, loans, tax documents, accessible PDFs
  and transaction exports. Export-only card periods are valid exclusions.
- **Untested:** broader business/additional-card eligibility. Use OP-2's per-period
  PDF availability for each account rather than assuming a product-wide rule.
- **Unknown:** overview serialization/layout guarantees, absent-field semantics,
  opaque-reference lifetimes, minimum required cookies/headers and rate limits.
  OP-1's pattern-based extraction is code-derived, not a general Transit decoder.
- **Unknown:** account/profile identity behavior across sign-out and user changes,
  and document-retention guarantees beyond the returned lists.
