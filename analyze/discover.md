# Discover Statement API Analysis

**Analysis as of:** 2026-09-29

## Scope and evidence

**Bank ID:** `discover`
**Domains:** `https://portal.discover.com` supplies account navigation and summary;
`https://card.discover.com` serves card activity/statements;
`https://bank.discover.com` serves deposit documents. Sign in through
`https://www.discover.com/`.

| Account type / flow | Evidence basis and source | Scope boundary |
| --- | --- | --- |
| Credit card | Observed: portal View Activity, statement selector and Previous Statements > PDF | Monthly card lists, direct/wrapped responses and PDF retrieval |
| Checking | Observed: portal Checking home, Activity > Statements & Tax Documents and monthly PDF link | Deposit statement list, binary references and PDF delivery |
| Cross-origin requests | Observed: card and bank page requests; Code-derived: [Discover module](../bank/discover.mjs) and [background transport](../docs/architecture.md) | Card requests via the worker from the bank origin; direct bank requests from the card origin |
| Savings and other products | Code-derived subtype mapping / Unverified document flow | Populated product responses and additional-account behavior require evidence |

## Authentication and session context

**Session ownership:** complete login and any renewal through the bank UI. Requests
use `credentials: "include"`. The module reads identifiers and uses the card
selection context; it does not issue login/token refresh requests.
**Lifecycle:** authentication expiry/recovery, cross-user switching and selection
concurrency guarantees are Unknown.

| Material / context | Source | Use |
| --- | --- | --- |
| Shared session identifier | Readable `customerId` cookie | Code-derived module session association |
| Session presence checks | Readable `customerId`, `cif`, and `sectoken` cookie names | Module requires all three before returning the customer ID; absence/extraction failure is an error |
| Other session cookies | Browser cookie jar, including HttpOnly session material | Sent automatically with credentialed requests |
| Card selector | OP-2 CARD `accountId` | OP-3 `selAcct` and OP-5 `dfsedskey` |
| Bank selector | OP-2 BANK `accountId` | OP-6/OP-7 account path |

**Execution context and headers:**

- Portal APIs accept credentialed calls from the card and bank pages. Use
  `Accept: application/json` for OP-1 through OP-4 and OP-6.
- For card endpoints, the module uses native fetch on the card origin and OP-8's
  background transport from other Discover origins.
- Bank document requests use direct fetch. The observed card-to-bank response
  includes `Access-Control-Allow-Origin: https://card.discover.com` and
  `Access-Control-Allow-Credentials: true`.
- PDF Accept headers are specified in OP-5/OP-7. Exact minimal cookie/header
  requirements and other-origin CORS behavior are Unknown.

## API flow

**Sequence:** the UI's OP-1 provides navigation context. The module reads session
context and uses OP-2 for both profile and accounts. CreditCard follows
OP-3 -> OP-4 -> OP-5; Checking follows OP-6 -> OP-7. Card operations use OP-8
whenever their request origin differs from the active page.

### OP-1: Read portal account summary and navigate

**Evidence basis:** Observed: authenticated Account Home and its card/checking links.
**Request:** `GET https://portal.discover.com/enterprise/portal/customeraccountinfo/v1/summary`,
empty body.
**Context and prerequisites:** authenticated portal, JSON Accept and credentials.
**Inputs:** no additional request parameters are established.
**Response and processing:** HTTP 200 JSON:

```json
{
  "firstName": "TEST",
  "customerAccountSummaryVO": {
    "cardSummaryVO": {
      "cardAccounts": [{"acctKey":"CARD001","acctNbr":"1234"}]
    },
    "bankSummaryVO": {
      "depositAccounts": [{
        "acctId":"BANK001",
        "acctNbr":"5678",
        "acctNickName":"Synthetic Checking",
        "acctType":"002"
      }]
    }
  }
}
```

**Outputs:** card `acctKey` and bank `acctId` identify the selected UI account and
correspond to OP-2 selectors. Use View Activity for card activity and checking's
Activity > Statements & Tax Documents for deposit statements.
**Errors and empty results:** detailed summary failure semantics are Unknown;
the module uses OP-2, not this summary, for account retrieval.
**Pagination and statement coverage:** no account continuation mechanism is
established for this operation.

### OP-2: Read profile and selected/other accounts

**Evidence basis:** Observed: card and checking navigation calls the corresponding
portal customer-info endpoint; Code-derived: combining/deduplication in the module.
**Requests:** two credentialed JSON GETs, with empty bodies:

| Endpoint | Bank UI selector | Module request |
| --- | --- | --- |
| `https://portal.discover.com/enterprise/navigation-api/v1/customer/info/card` | `selAcct=<card-id>` | Trailing `?` with no query values |
| `https://portal.discover.com/enterprise/navigation-api/v1/customer/info/bank` | `id=<bank-id>` | Trailing `?` with no query values |

**Context and prerequisites:** authenticated Discover page. The module requests
both endpoints concurrently for profile retrieval and again for account retrieval.
**Response and processing:** HTTP 200 JSON from the card-oriented view:

```json
{
  "profile": {"name":"TEST USER","email":"user@example.test"},
  "selectedAccount": {
    "accountId":"CARD001",
    "accountType":"CARD",
    "accountDesc":"Synthetic Card",
    "lastFourAccountNumber":"1234"
  },
  "accounts": [{
    "accountId":"BANK001",
    "accountType":"BANK",
    "accountSubType":"002",
    "accountDesc":"Synthetic Checking",
    "lastFourAccountNumber":"5678"
  }]
}
```

The bank-oriented view supplies the selected BANK account and CARD entries in
`accounts`. Include both `selectedAccount` and the `accounts` arrays from each
available response; deduplicate by `accountId`, taking the first occurrence.
**Outputs:** profile name/email, account ID/description/last-four digits and
account type/subtype.
**Selection and association:** select CARD and BANK entries by their explicit type.
Use `profile` from the card response when present, otherwise the bank response.
An email is required; the display name defaults to `Discover User`.
**Errors and empty results (Code-derived):** the module tolerates an individual
fetch/HTTP failure and uses data from the other response. It errors when no usable
profile or no mapped accounts remain. Completeness under a partial failure is
Unknown; an unavailable service alone does not establish an absent product.
**Pagination and statement coverage:** use selected and other-account collections;
no continuation input is established.

### OP-3: Read the card's latest statement date

**Evidence basis:** Observed: card View Activity opens Recent Activity.
**Request:** `GET https://card.discover.com/cardissuer/statements/transactions/v1/recent`.
Use JSON Accept, an empty body and the shared execution context.

| Query input | Value / source |
| --- | --- |
| `source` | `achome` for the module's request |
| `transOnly` | `Y` |
| `selAcct` | OP-2 selected CARD account ID |

**Response and processing:** HTTP 200 JSON, possibly prefixed by `)]}'` and an
optional comma/whitespace:

```json
{"errorCode":null,"summaryData":{"lastStmtDate":"02/29/2000"}}
```

**Card JSON processing shared with OP-4:** strip only the optional leading prefix,
parse an object, and reject a non-null/nonempty `errorCode`. If `jsonResponse`
exists, require a string, parse its object, and apply the same business-error check.
Otherwise use the direct object.
**Outputs:** validate strict `MM/DD/YYYY` and its calendar components, then form
`YYYYMMDD` for OP-4.
**Errors and empty results:** require object-valued `summaryData`. The module
returns no statements for missing, null or empty-string `lastStmtDate`; other
non-string values or invalid dates are errors. HTTP and JSON failures surface.

### OP-4: List card PDF periods

**Evidence basis:** Observed: the bank's current and selected-period views;
Code-derived: the module uses the selected-date route below.
**Request:** `GET https://card.discover.com/cardmembersvcs/statements/app/v2/stmt?stmtDate=<YYYYMMDD>`,
empty body and JSON Accept.
**Context and prerequisites:** OP-3's latest statement date and active card context.
The bank UI's `/cardmembersvcs/statements/app/v2/current` supplies the current view;
the parameterized route supplies a chosen period.
**Response and processing:** HTTP 200. Apply OP-3's card JSON processing to both
supported forms. Direct body:

```json
{
  "statements": [{
    "fromDate":"02/01/2000",
    "toDate":"02/29/2000",
    "stmtUri":"/cardmembersvcs/statements/app/v2/stmt?stmtDate=20000229",
    "pdfUri":"/cardmembersvcs/statements/app/stmtPDF?view=true&date=20000229",
    "year":"2000",
    "pdfAvailable":true
  }]
}
```

Wrapped body:

```json
{
  "previousStatementInputVO": {},
  "jsonResponse": "{\"statements\":[{\"pdfAvailable\":true,\"pdfUri\":\"/cardmembersvcs/statements/app/stmtPDF?view=true&date=20000229\"}]}"
}
```

The bank UI exposes the direct shape; the module request can receive the wrapped
shape. Select the decoder by field presence.
**Outputs:** validated PDF query `date` as statement ID, converted to UTC midnight
for the shared statement date.
**Selection and association:** require boolean `pdfAvailable`. Exclude false rows;
for true rows resolve `pdfUri` against `https://card.discover.com`. Accept only that
HTTPS origin, path `/cardmembersvcs/statements/app/stmtPDF`, one `date`, one
`view=true`, and no other query selectors, URL credentials or fragment. Validate
the eight-digit date before reducing the link to a date ID. Other document routes
are distinct operations, not interchangeable monthly PDFs.
**Errors and empty results:** require an explicit statements array. Empty is valid;
malformed rows, invalid links/dates, and business/HTTP failures are errors.
**Pagination and statement coverage:** sort the full included list newest first.
The UI groups previous PDFs by year. Activity detail availability and PDF-period
availability are separate; retention and continuation guarantees are Unknown.

### OP-5: Download a card monthly PDF

**Evidence basis:** Observed: Previous Statements > PDF opens the monthly document;
Code-derived: module card selection before fetch.
**Request:** `GET https://card.discover.com/cardmembersvcs/statements/app/stmtPDF?view=true&date=<YYYYMMDD>`,
empty body, `Accept: application/pdf, */*` and credentials.
**Context and prerequisites:** selected OP-4 period and its OP-2 card.
**Inputs:** fixed `view=true`; validated OP-4 date.
**State and timing:** set `dfsedskey=<card-account-id>; path=/; domain=.discover.com`
immediately before requesting the PDF. The cookie controls account selection.
Cross-card concurrent selection and cookie restoration behavior are Unknown.
**Response and delivery:** HTTP 200 `application/pdf`. The UI may open a PDF
viewer; module requests read the response bytes directly or through OP-8.
**Outputs:** PDF Blob.
**Errors and empty results:** reject HTTP failures and require MIME
`application/pdf` case-insensitively, ignoring parameters, plus a `%PDF-` prefix.
Empty or non-PDF content is an error. OP-7 shares these byte checks.

### OP-6: List bank-account statement references

**Evidence basis:** Observed: checking Activity > Statements & Tax Documents.
**Request:** `GET https://bank.discover.com/bank/deposits/servicing/documents/v1/accounts/<bank-id>/statements`,
empty body, JSON Accept and credentials.
**Context and prerequisites:** OP-2 selected BANK account; direct fetch under the
shared execution context.
**Inputs:** account ID in the path.
**Response and processing:** HTTP 200 JSON array:

```json
[
  {
    "name":"February 2000",
    "statementDate":"2000-02-29T00:00:00-0400",
    "id":"synthetic|document-reference",
    "links":[
      {
        "rel":"self",
        "href":"https://bank.discover.com/bank/deposits/servicing/documents/v1/accounts/BANK001/statements/synthetic%7Cdocument-reference"
      },
      {
        "rel":"binary",
        "href":"https://bank.discover.com/bank/deposits/servicing/documents/v1/accounts/BANK001/statements/synthetic%7Cdocument-reference"
      }
    ]
  }
]
```

**Outputs:** name/month label, timestamp and selected document reference.
**Selection and association (Code-derived):**

- Require a nonblank string `id`, a string date with valid leading calendar
  components, and a parseable complete timestamp. Preserve the instant on ISO
  conversion, including the bank's timezone offset.
- If `links` exists, require an array of objects with nonblank string `rel`.
  Use the single `rel: "binary"` entry; `self` and `thumbnail` are other relations.
- For a present binary entry, require a nonblank URL resolving to
  `https://bank.discover.com` and
  `/bank/deposits/servicing/documents/v1/accounts/<encoded-selected-id>/statements/<reference>`.
  The reference must be a nonempty single encoded path segment. Reject URL
  credentials, fragments, wrong origins/account paths and duplicate binary entries.
- Preserve the URL's encoded reference and query. Resolve supported relative
  paths to an absolute URL. Only an absent binary entry permits opaque-ID fallback.

**Errors and empty results:** empty arrays are valid. Invalid rows, dates or links
produce errors rather than a partial list.
**Pagination and statement coverage:** use the returned array and sort newest
first. The UI groups its month labels under year accordions; no list-continuation
input is established. Lifetime and retention guarantees are Unknown.

### OP-7: Download a bank-account PDF

**Evidence basis:** Observed: the checking month's Statement (PDF) link.
**Request:** credentialed `GET` of the OP-6 binary URL, empty body and
`Accept: application/pdf`. The module uses the statements-page URL
`https://bank.discover.com/web/deposits/documents/statements` as its Referer option.
**Context and prerequisites:** selected OP-6 statement and associated OP-2 account.
**Inputs and delivery:** for a full/supported relative URL, apply OP-6's target
validation and use the resolved URL unchanged. For the opaque-ID fallback,
individually encode the account ID and statement ID and construct:

```text
https://bank.discover.com/bank/deposits/servicing/documents/v1/accounts/<encoded-account-id>/statements/<encoded-statement-id>
```

Pipe characters in a raw ID become `%7C`; already encoded binary URLs remain
encoded exactly once.
**Response and outputs:** HTTP 200 `application/pdf`, binary body as a Blob.
The printed checking period uses an abbreviated month-end date (`Mon DD, YYYY`).
**Errors and empty results:** reject a blank identifier, invalid URL target,
HTTP failure or failed OP-5 PDF-byte check.

### OP-8: Execute a cross-origin card request through the background

**Evidence basis:** Code-derived: `fetchViaPopup` in the module and `requestFetch`
in [background.mjs](../extension/background.mjs); Observed: card requests from
the bank page.
**Context and prerequisites:** active Discover page and extension messaging.
**Source and extraction:** send `chrome.runtime.sendMessage` with
`action: "requestFetch"`, target `url`, and options `method`, `headers`, and
`credentials`. The receiving background worker issues the fetch.
**Inputs:** the card URL/options from OP-3, OP-4 or OP-5.
**Response and processing:** receive `ok`, `status`, `statusText`, `headers`, `body`,
or an error response. The shared worker's [transport rules](../docs/architecture.md)
classify PDF/octet-stream MIME case-insensitively and encode binary bodies as
base64 data URLs; other bodies remain text.
**Outputs:** decode a base64 data URL locally into bytes and construct a native
`Response` with received status/headers. Use a null body for 204/205/304.
**Errors and empty results:** propagate messaging/worker failures, malformed data
URLs and conversion failures. The adapter performs no silent page-fetch retry.
The caller applies its operation-specific HTTP and content checks.

## Shared contract mapping

| Contract field / flow | Source operation and field | Meaning, conversion and runtime checks |
| --- | --- | --- |
| Profile.sessionId | Cookie `customerId` | Module session association after presence checks |
| Profile.profileId / profileName | OP-2 email / name | Email identity; name defaults to `Discover User` |
| Account.profile / Statement.account | Caller profile / selected account | Preserve associations |
| Account.accountId / accountName | OP-2 ID / description | API selector; display defaults to Card/Account plus suffix |
| Account.accountMask | OP-2 `lastFourAccountNumber` | Bank-supplied display suffix |
| Account.accountType | OP-2 type/subtype | CARD -> CreditCard; BANK `002`/`checking` -> Checking, `003`/`savings` -> Savings, default Checking |
| Statement.statementId / card | OP-4 `pdfUri.date` | Strict YYYYMMDD for OP-5 |
| Statement.statementDate / card | OP-4 date | UTC midnight; PDF closing date uses MM/DD/YYYY |
| Statement.statementId / bank | OP-6 binary URL or opaque ID | Validated link preserved; raw fallback encoded by OP-7 |
| Statement.statementDate / bank | OP-6 `statementDate` | ISO instant from offset-bearing timestamp; leading calendar components validated |
| Downloaded Blob | OP-5 / OP-7, with OP-8 where needed | Direct/bridged bytes with MIME and signature checks |

## Limitations and open questions

- **Untested:** savings, other products, multiple-card selection/concurrency and
  portal-only document retrieval. Each requires its own account/routing evidence.
- **Unsupported by the monthly flow:** tax/year-end and transaction exports.
  `/cardmembersvcs/statements/app/stmt.pdf` is a distinct transaction-document
  route; it is not substituted for OP-5.
- **Unknown:** account-list completeness during a partial OP-2 service outage.
  The code-derived tolerant behavior is not a product-absence contract.
- **Unknown:** authentication/cross-user lifecycle, reference expiry, document
  retention and CORS policy outside the described origins/operations.
