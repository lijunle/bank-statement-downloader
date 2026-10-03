# Citi Statement API Analysis

**Analysis as of:** 2026-09-29

## Scope and evidence

**Bank ID:** `citi`
**Domains:** `https://online.citi.com` hosts account servicing and the API base
`https://online.citi.com/gcgapi/prod/public/v1`. Public sign-in is at
`https://www.citi.com/`.

| Account type / flow | Evidence basis and source | Scope boundary |
| --- | --- | --- |
| Credit card | Observed: dashboard, View Statements, View All Statements and Download | Eligible-account selection, recent monthly lists and direct PDF response |
| Bank and loan accounts | Code-derived: [Citi module](../bank/citi.mjs) | Account mapping exists; non-card statement/download routes are unverified |
| Brokerage and retirement | Observed: named eligible-response groups; Unverified: populated accounts | The module does not map these groups |

## Authentication and session context

**Session ownership:** complete sign-in through the bank UI. The module uses
browser cookies with `credentials: "include"` and leaves session renewal to Citi.
**Lifecycle:** session expiry/recovery timing and cross-user behavior are Unknown.
**Execution context:** issue requests from the authenticated `online.citi.com`
page. The relevant headers and their sources are:

| Header / material | Source and handling | Evidence basis |
| --- | --- | --- |
| Session/profile association | Readable `bcsid` cookie; report missing cookie as an authentication error | Code-derived |
| `customersessionid` | `bcsid` when available | Observed on the list request; Code-derived common request helper |
| `client_id` | Same-named cookie; module uses an empty string if absent | Observed header, Code-derived source |
| `appversion` | `appVersion` cookie; module default `CBOL-ANG-2025-11-02` | Code-derived; current necessity of the default is Unknown |
| `businesscode`, `channelid`, `countrycode` | `businessCode`, `channelId`, `countryCode` cookies, defaulting to `GCB`, `CBOL`, `US` | Observed values, Code-derived defaults |
| `Accept`, `Content-Type` | `application/json` on the common request path, including the PDF POST | Observed |

The bank page also supplies authorization and session cookies automatically.
The minimal required header/cookie set is Unknown; the module does not acquire
or refresh authorization tokens itself.

## API flow

**Sequence:** read the session context; OP-1 supplies the profile; OP-2 describes
the dashboard account and statement entry point; OP-3 supplies eligible accounts;
OP-4 lists a selected card's dates; OP-5 downloads a selected date.
The module uses OP-1 and OP-3 for account loading; OP-2 is a UI identity reference.

Requests below are relative to the API base above and use the shared authentication
context. Report non-success HTTP responses as operation errors.

### OP-1: Read the welcome name

**Evidence basis:** Observed: authenticated credit-card dashboard requests
`GET /digital/customers/globalSiteMessages/welcomeMessage`.
**Context and prerequisites:** authenticated page and session ID; no request body
or additional inputs.
**Response and processing:** HTTP 200 JSON:

```json
{"welcomeData":{"firstName":"TEST"},"displayTutorialFlag":false}
```

**Outputs:** profile display name.
**Errors and empty results:** Code-derived: require object-valued response and
`welcomeData`. If supplied, `firstName` must be a string; use `User` for a missing
or empty name. The supplied session ID is also the module's profile ID.

### OP-2: Read dashboard identity and statement navigation

**Evidence basis:** Observed: dashboard account balances and View Statements.
**Request:** `GET /cbol/accounts/details/balances?isRedesignPage=true`, no body.
**Context and prerequisites:** authenticated dashboard; fixed query
`isRedesignPage=true`.
**Response and processing:** HTTP 200 JSON with `accountLedgerData`:

```json
{
  "accountLedgerData": [{
    "accountId": "<card-id>",
    "accountMetaData": {
      "accountId": "<card-id>",
      "productNameAndDisplayAccountNo": "Synthetic Citi Card - 1234"
    },
    "displayAccountNumber": "1234",
    "statementsAvailableFlag": true,
    "accountType": "IBS_PRIMARY",
    "accountLinkDetail": {
      "statementLink": {"linkUrl":"/US/ag/accstatement?accountInstanceId=<card-id>"}
    }
  }]
}
```

**Outputs:** account selector, display suffix and UI navigation link. The selected
card's ID associates with OP-3's `accountId`.
**Selection and association:** use `displayAccountNumber` to interpret the
selected card's display suffix. Statement availability comes from OP-4 rather
than from the dashboard's next or previous closing-date balance fields.
**Errors and empty results:** service-specific failure/empty semantics beyond
HTTP status are Unknown; this response is not used by the module's account loader.
**Pagination and statement coverage:** dashboard continuation behavior is Unknown.

### OP-3: List statement-eligible accounts

**Evidence basis:** Observed: View Statements requests this operation.
**Request:** `POST /v2/digital/accounts/statementsAndLetters/eligibleAccounts/retrieve`,
JSON body:

```json
{"transactionCode":"1079_statements"}
```

**Context and prerequisites:** authenticated page and OP-1 profile; the transaction
code is the fixed statement-selection input.
**Response and processing:** HTTP 200 JSON:

```json
{
  "userType": "CARDS",
  "bankHostSystemDownFlag": false,
  "cardsHostSystemDownFlag": false,
  "isCardsHostSystemDownFlag": false,
  "eligibleAccounts": {
    "cardAccounts": [{
      "accountId": "<card-id>",
      "accountNickname": "Synthetic Citi Card - 1234",
      "accountType": "CARDS",
      "paperlessEnrollmentFlag": true,
      "paperlessEligibleFlag": true,
      "productDesc": "Synthetic Citi Card"
    }],
    "bankAccounts": [],
    "loanAccounts": [],
    "brokerageAccounts": [],
    "retirementAccounts": []
  }
}
```

**Outputs:** eligible account IDs and display/type information.
**Selection and association (Code-derived):** map card, bank and loan groups.
Each entry requires a nonblank string ID and a nickname ending in four or five
digits; expose the last four digits as its mask. Keep the full nickname as name.
Card/loan groups map to CreditCard/Loan; bank names containing `saving` map to
Savings, otherwise Checking. Brokerage/retirement groups are outside this mapping.
**Errors and empty results:** require all three mapped groups to be arrays,
including explicit empty arrays. Each present recognized host-down flag must be
boolean; `true` signals unavailability, another type signals malformed data.
Reject malformed entries as errors rather than returning a partial list.
**Pagination and statement coverage:** use the returned eligible groups; no
continuation input is established.

### OP-4: List a card's available statements

**Evidence basis:** Observed: View All Statements and its year filter.
**Request:** `POST /v2/digital/card/accounts/statements/accountsAndStatements/retrieve`,
JSON body:

```json
{"accountId":"<card-id>"}
```

**Context and prerequisites:** selected OP-3 card; pass its account ID unchanged.
**Response and processing:** HTTP 200 JSON:

```json
{
  "statementsByYear": [{
    "displayYearTitle": "2000",
    "statementsByMonth": [
      {"displayDate":"March 31","statementDate":"03/31/2000"},
      {"displayDate":"February 29","statementDate":"02/29/2000"}
    ],
    "annualAccountSummaryEligibleFlag": false
  }],
  "archivedStatementDetails": {
    "archivedStatementsByMonth": [],
    "archivedStatementRequestStartDate": "01/01/2000"
  },
  "archivedStatementsEligibleFlag": true,
  "estatementEnrollmentFlag": true
}
```

**Outputs:** `statementDate` is the exact download selector. Parse its strict
`MM/DD/YYYY` components, validate the calendar date by round-trip, and represent
it at UTC midnight for the shared Statement.
**Selection and association:** flatten monthly entries for the selected account.
Annual-account-summary URLs and archive-request metadata are separate document
flows, excluded from the monthly list.
**Errors and empty results (Code-derived):** reject missing/non-array year/month
groups and malformed rows/dates. Explicit empty arrays are valid.
**Pagination and statement coverage:** the response groups available dates by
year; the UI selects a year from that data. Sort the full monthly list newest
first. Return only supplied dates, as months without a listed statement need no
entry. Retention limits and archive-request behavior are Unknown.

### OP-5: Retrieve a monthly PDF

**Evidence basis:** Observed: recent-statement view and Download use this POST.
**Request:** `POST /v2/digital/card/accounts/statements/recent/retrieve`, JSON body:

```json
{"accountId":"<card-id>","statementDate":"03/31/2000","requestType":"RECENT STATEMENTS"}
```

**Context and prerequisites:** selected OP-4 statement and its OP-3 account.
Validate the date as in OP-4 before issuing the request; preserve the original
date string in the body. `requestType` is fixed.
**Response and processing:** HTTP 200, `Content-Type: application/pdf`, direct
binary body; the observed Content-Disposition is `attachment; filename=name`.
**Delivery and outputs:** obtain a Blob from this POST. The account statement
page at `/US/nga/accstatement?accountInstanceId=...` is the UI entry point;
OP-5 is the binary document source.
**Errors and empty results:** report HTTP failures, empty bodies, MIME types
other than `application/pdf` (case-insensitive, ignoring parameters), and bytes
without a `%PDF-` prefix as errors.

## Shared contract mapping

| Contract field / flow | Source operation and field | Meaning, conversion and runtime checks |
| --- | --- | --- |
| Profile.sessionId / profileId | Readable `bcsid` | Module session association; cross-session identity stability is Unknown |
| Profile.profileName | OP-1 `welcomeData.firstName` | Display name, default `User` |
| Account.profile / Statement.account | Caller profile / selected OP-3 account | Preserve associations |
| Account.accountId / accountName | OP-3 ID / nickname | Opaque API selector / displayed name |
| Account.accountMask / accountType | OP-3 group and nickname | Four-digit suffix and group/name classification |
| Statement.statementId | OP-4 `statementDate` | Exact `MM/DD/YYYY` string used by OP-5 |
| Statement.statementDate | OP-4 parsed date | Calendar date at UTC midnight; card PDF prints the closing date as `MM/DD/YY` |
| Downloaded Blob | OP-5 | Direct bytes with nonempty/MIME/signature checks |

## Limitations and open questions

- **Untested:** additional cards and bank/loan/investment products. Their account
  discovery structures alone do not establish applicability of OP-4/OP-5's card
  routes; those products need their own statement/download evidence.
- **Unsupported by this flow:** annual summaries and requested archived documents.
  Their flags/links are metadata, not a substitute for their own retrieval procedure.
- **Unknown:** minimal required headers, header-default necessity, session expiry/
  cross-user behavior, retention limits and archive-request lifecycle.
