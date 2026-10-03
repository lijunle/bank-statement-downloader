# Chase Statement API Analysis

**Analysis as of:** 2026-09-27

## Scope and evidence

**Bank ID:** `chase`
**Domains:** sign in at `https://www.chase.com/`; account servicing and statement
APIs use `https://secure.chase.com`. Asset and analytics hosts are outside the
statement retrieval sequence.

| Account type / flow | Evidence basis and source | Scope boundary |
| --- | --- | --- |
| Checking and credit card | Observed: dashboard, Statements & documents, selected account and save action | Current-year standard monthly statements using STAR_MS delivery |
| Auto loan and mortgage | Observed: account-specific Statements & documents and save links | Same current-year retrieval chain; printed billing dates have product-specific meanings |
| Other products/document types | Unverified | Additional accounts, accessible PDFs, taxes and year-end documents need separate evidence |

## Authentication and session context

**Session ownership:** sign in through the bank page; let it establish and renew
cookies. The module makes credentialed requests without managing token refresh.
**Execution context:** authenticated page on `secure.chase.com`, with
`credentials: "include"`.
**Lifecycle:** expiry timing, cross-user behavior and the relationship between the
module's `v1st` identifier and bank authentication are Unknown.

| Material / header | Source and use | Evidence basis |
| --- | --- | --- |
| Shared session identifier | Read `v1st` from cookies; preserve embedded `=`; error if absent | Code-derived: [Chase module](../bank/chase.mjs) |
| PDF CSRF token | OP-3 `csrfToken`; also supplied in OP-1's cached CSRF response | Observed API field; module requests OP-3 before each download |
| POST `Content-Type` | `application/x-www-form-urlencoded; charset=UTF-8` | Observed |
| POST `Accept` | `application/json, text/plain, */*` | Code-derived request helper |
| `x-jpmc-channel` / `x-jpmc-csrf-token` | Fixed `id=C30` / `NONE` for the module's JSON requests | Code-derived; distinct from OP-5's actual CSRF query token |
| `x-jpmc-client-request-id` | Fresh random UUID | Code-derived |

The minimum required header/cookie set is Unknown; use the bank's authenticated
context and the operation-specific sources above.

## API flow

**Sequence:** read session context; OP-1 supplies profile and accounts; OP-2 lists
one account's documents; for each download run OP-3, then OP-4, then OP-5.
All endpoint paths below are relative to `https://secure.chase.com`.

**Common response handling (Code-derived):** require an object-valued JSON result.
If `code` is present, require `"SUCCESS"`; missing codes remain accepted by the
module. Apply this rule to consumed cached subresponses as well as outer responses.
HTTP failures are errors. Unrelated cached-service errors need not block an
operation whose required data is available.

### OP-1: Read application data for profile and accounts

**Evidence basis:** Observed: authenticated dashboard load; Code-derived: field
precedence and validation in the module.
**Request:** `POST /svc/rl/accounts/l4/v1/app/data/list`, empty body.
**Context and prerequisites:** authenticated dashboard; shared POST headers.
**Inputs:** no body parameters.
**Response and processing:** HTTP 200 JSON:

```json
{
  "code": "SUCCESS",
  "personId": 4001,
  "profileId": 5001,
  "cache": [
    {
      "url": "/svc/rl/accounts/secure/v1/deck/greeting/list",
      "response": {"greetingName":"TEST"}
    },
    {
      "url": "/svc/rr/accounts/secure/v4/dashboard/tiles/list",
      "response": {
        "code": "SUCCESS",
        "accountTiles": [{
          "accountId": 1001,
          "accountTileType": "CARD",
          "accountTileDetailType": "BAC",
          "nickname": "Synthetic Card",
          "mask": "1234",
          "tileDetail": {"productGroupCode":2}
        }]
      }
    },
    {
      "url": "/svc/rl/accounts/secure/v1/user/metadata/list",
      "response": {"code":"SUCCESS","personId":4001,"profileId":5001}
    },
    {
      "url": "/svc/rl/accounts/secure/v1/csrf/token/list",
      "response": {"code":"SUCCESS","csrfToken":"<csrf-token>"}
    }
  ]
}
```

**Outputs:** profile ID/name and account tiles; OP-3 describes the CSRF field's use.
**Selection and association:**

- Use top-level `profileId` when present. Cached profile ID, person ID and supplied
  session ID provide code-derived fallback sources; validate the profile
  subresponses used. Convert the chosen identifier to a string.
- Use direct `greetingName`, otherwise cached greeting; uppercase the first
  character and lowercase the remainder. With no greeting the module uses the
  session ID as display fallback. A greeting is a display value, not a legal-name
  guarantee.
- The module accepts direct `accountTiles`, then direct `accounts`, otherwise
  selects the cache URL containing `/dashboard/tiles/`. Require a valid dashboard
  object and tile array when that cache entry is present.
- Use `accountId` for document requests and `mask` for the display number. Product
  metadata's `productInfos` is descriptive and is not an account-loader fallback.

**Account classification:** observed tile/detail pairs are `CARD/BAC`,
`DDA/CHK`, `AUTOLOAN/ALA`, and `MORTGAGE/HMG`. Multiple card group codes exist.
The module applies these Code-derived rules in order, taking the first match:

| Priority | Source and condition | Account type |
| --- | --- | --- |
| 1 | `tileDetail.productGroupCode`, falling back to top-level `productGroupCode`: numeric `2` / `3` | CreditCard / Loan |
| 2 | `accountTileType` is `CARD`, or detail type is `BAC` | CreditCard |
| 3 | `accountTileType` is `MORTGAGE`/`AUTOLOAN`, or detail type is `HMG`/`HMORTGAGE`/`ALA` | Loan |
| 4 | Product code contains `CHK`/`DDA`, or lowercase product name contains `checking` | Checking |
| 5 | Product code contains `SAV`, or lowercase product name contains `saving` | Savings |
| 6 | Product code contains `CC`/`CREDIT`, or lowercase product name contains `credit` | CreditCard |
| 7 | Product code contains `MORT`/`MTG`/`LOAN`, or lowercase product name contains `mortgage`/`loan` | Loan |
| 8 | Any of `cardType`, `rewardsTypeId`, or `cardArtGuid` is populated | CreditCard |
| 9 | No preceding rule matches | Checking |

Detail type uses `accountTileDetailType`, then `tileDetail.detailType`. Product
code uses the first populated value in `tileDetail.productCode`, `productCode`,
`type`, `accountType`; product name uses `productName`, then `nickname`.
The fallback rules describe implementation behavior, not additional observed
product coverage.

**Errors and empty results:** apply common response validation. A consumed failed
dashboard/greeting/metadata subresponse is an error. An explicit empty tile array
is valid; completeness guarantees for entirely missing account sources are Unknown.
**Pagination and statement coverage:** no account continuation mechanism is
established. The module independently invokes OP-1 for profile and account reads.

### OP-2: List an account's current-year document references

**Evidence basis:** Observed: Statements & documents and account expansion.
**Request:** `POST /svc/rr/documents/secure/idal/v2/docref/list`, URL-encoded body.
**Context and prerequisites:** selected OP-1 account; shared POST headers.
**Inputs:**

| Field | Value / source |
| --- | --- |
| `accountFilter` | Selected account ID from OP-1 |
| `dateFilter.idalDateFilterType` | Fixed `CURRENT_YEAR` |

**Response and processing:** HTTP 200 JSON:

```json
{
  "code": "SUCCESS",
  "idaldocRefs": [{
    "documentId": "<document-id>",
    "documentDate": "20000229",
    "documentTypeDesc": "Statement",
    "idaldocType": "STMT",
    "adaVersionAvailable": false
  }]
}
```

**Outputs:** selected document ID and document-list date.
**Selection and association:** the module reads `idaldocRefs` (with code-derived
`documentRefs`/`documents` alternatives), associates rows with the selected
account, and skips rows whose supplied account selector identifies another
account. Include `STMT` or `STATEMENT`; exclude other categories such as
`MORTGAGE_YES`, notices and tax documents.
**Errors and empty results:** require an array of row objects and a usable string
or numeric identifier for every included statement. Invalid rows produce an error
rather than a partial list; an explicit empty array is valid.
**Date processing:** select `documentDate`, with `statementDate`/`date` as
code-derived alternatives. Accept `YYYYMMDD`, ISO calendar dates and valid ISO
timestamps. Check original calendar components before timestamp conversion;
calendar-only values become UTC midnight, while timestamp offsets determine the
instant. Reject unsupported formats and impossible dates.
**Pagination and statement coverage:** sort included dates newest first. This
flow requests the current calendar year; additional-year filters and continuation
semantics are Unknown.

The listing date identifies the archive entry, while printed dates have separate
semantics. Card PDFs use an `MM/DD/YY` closing date; mortgage PDFs expose a labelled
Statement date and auto-loan PDFs a Due Date. Use each field's own meaning rather
than treating the listing date as a universal billing date.

### OP-3: Obtain a PDF CSRF token

**Evidence basis:** Observed: OP-1 cached CSRF response and PDF query token;
Code-derived: the module's explicit token request.
**Request:** `POST /svc/rl/accounts/secure/v1/csrf/token/list`, empty body and shared
POST headers.
**Context and prerequisites:** authenticated page, immediately before an OP-4/OP-5
download sequence. There are no additional inputs.
**Response and processing:** JSON:

```json
{"code":"SUCCESS","csrfToken":"<csrf-token>"}
```

**Outputs:** `csrfToken` for OP-5.
**Errors and empty results:** apply common response checks and report an absent/
empty token as an error.
**State and timing:** obtain a token per module download; reuse/expiry guarantees
are Unknown.

### OP-4: Resolve a selected document key

**Evidence basis:** Observed: the bank's save action requests a document key.
**Request:** `POST /svc/rr/documents/secure/idal/v2/dockey/list`, URL-encoded body.
**Context and prerequisites:** selected OP-2 document, its account, and shared
POST context; module calls this after OP-3.
**Inputs:** `accountFilter` from OP-1, `documentId` from OP-2, and
`dateFilter.idalDateFilterType=CURRENT_YEAR`.
**Response and processing:** HTTP 200 JSON:

```json
{"code":"SUCCESS","docKey":"<document-key>","docSOR":"STAR_MS","docURI":"/svc/rr/documents/secure/idal/v5/pdfdoc/star/list"}
```

**Outputs:** `docKey`, system-of-record value and the indicated PDF path.
**Errors and empty results:** apply common response checks and require a document
key. Code-derived aliases are `documentKey` and `sor`; the module defaults absent
SOR to `STAR_MS`.
**State and timing:** resolve a key for each selected document. Key lifetime and
reuse guarantees are Unknown.

### OP-5: Download the standard PDF

**Evidence basis:** Observed: checking, card, auto-loan and mortgage save actions
use the STAR_MS PDF route.
**Request:** `GET /svc/rr/documents/secure/idal/v5/pdfdoc/star/list`, no body.
**Context and prerequisites:** OP-3 token and OP-4 key for the selected document;
use browser credentials and document-accepting `Accept`.

| Query input | Source / fixed value |
| --- | --- |
| `docKey` | OP-4 key |
| `sor` | OP-4 SOR |
| `csrftoken` | OP-3 token |
| `adaVersion` / `download` | `false` / `true` |

Encode query values through URLSearchParams. The module uses the fixed STAR_MS
path matching the observed `docURI`; other route values require separate evidence.
**Response and delivery:** HTTP 200 `application/pdf`; read the binary body as a
Blob. A document filename can contain its listing date and account suffix.
**Errors and empty results:** report HTTP failures, empty bodies, MIME/signature
mismatches. Require `application/pdf` (case-insensitive, ignoring parameters) and
the `%PDF-` prefix.

## Shared contract mapping

| Contract field / flow | Source operation and field | Meaning, conversion and runtime checks |
| --- | --- | --- |
| Profile.sessionId | Cookie `v1st` | Module cache/session association; not established as user identity proof |
| Profile.profileId / profileName | OP-1 | String identifier and formatted greeting with the described fallbacks |
| Account.profile / Statement.account | Caller profile / selected account | Preserve associations |
| Account.accountId / accountName | OP-1 tile ID / nickname | String API selector; display falls back to displayName, mask, or generated account label |
| Account.accountMask | OP-1 `mask` | Observed string number suffix; ID-suffix fallback exists in code but number semantics are unverified |
| Account.accountType | OP-1 classification | Group/type/detail/name mapping |
| Statement.statementId | OP-2 `documentId` | String document selector, passed to OP-4 |
| Statement.statementDate | OP-2 date | Archive/list date, normalized using the documented calendar/timestamp rules |
| Downloaded Blob | OP-5 | Binary body with empty/MIME/signature guards |

## Limitations and open questions

- **Untested:** additional accounts, older years, accessible PDFs, and alternate
  `docURI`/SOR routes. OP-2 and OP-4 currently use `CURRENT_YEAR`.
- **Unsupported by the monthly flow:** tax, notice and year-end document categories.
- **Unknown:** key/reference retention and expiry, exact required headers,
  missing-account-source semantics, and `v1st` behavior across sign-out/users.
- **Unknown:** general relationship between archive dates and printed billing
  dates. Establish the product's labelled field rather than assuming equal dates.
