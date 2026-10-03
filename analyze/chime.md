# Chime Statement API Analysis

**Analysis as of:** 2026-09-28

## Scope and evidence

**Bank ID:** `chime`
**Domains:** `https://app.chime.com` hosts the authenticated UI and GraphQL API.

| Account type / flow | Evidence basis and source | Scope boundary |
| --- | --- | --- |
| Checking | Observed: overview, Profile > Account info, Profile > Documents and monthly PDF action | Account identity, actual number suffix, monthly periods and encoded PDF delivery |
| Savings | Observed: full-query endpoint accepts the OP-4 fields with a null account; Code-derived: [Chime module](../bank/chime.mjs) | Populated details and savings document delivery are untested |
| Secured credit | Code-derived: module account and statement mappings | Account-number suffix and document delivery are unverified |

## Authentication and session context

**Session ownership:** sign in through the bank UI. The browser supplies cookies;
the module reads session/profile identifiers and leaves login and renewal to Chime.
**Lifecycle:** expiry timing, cross-user switching, and fallback-cookie behavior
are Unknown; establishing those rules requires session-lifecycle evidence.
**Execution context:** run requests in the authenticated `app.chime.com` page with
`credentials: "include"`.

| Material / context | Source and use |
| --- | --- |
| Session identifier | Code-derived: read `id` from `chime_session` (`id=<session-id>&end_ts=<timestamp>`); if it has no `id` component use the cookie value. If absent, use `__Host-authn`; error if neither is available. |
| Profile identifier | Code-derived: `chime_user_id`, then `__Host-uid`, then the supplied session ID |
| Request headers | `Content-Type: application/json`, `Accept: */*`, and `chime-timezone` from the browser's resolved timezone, with `America/Los_Angeles` as the module default |

Header necessity beyond the accepted request context is Unknown.

## API flow

**Sequence:** read the session context; OP-1 provides the profile; OP-2 discovers
accounts, with OP-3 for a present checking account and OP-4 for a present savings
account; OP-5 lists periods; OP-6 retrieves the selected month's PDF.

All HTTP operations below use `POST https://app.chime.com/api/graphql` and the
shared authentication context. The persisted-query request format is:

```json
{
  "operationName": "UserQuery",
  "variables": {},
  "extensions": {
    "persistedQuery": {
      "version": 1,
      "sha256Hash": "md5:f4a5ebcc4103cf23f7e582af45b0edd0"
    }
  }
}
```

Use the operation-specific hash listed below. These are public query identifiers.
OP-4 instead sends `query` text with `operationName` and `variables`, without the
persisted-query extension.

**Common response handling (Code-derived):** parse JSON and require an object with
an object-valued `data`. A nonempty `errors` array or malformed `errors` value is
an error; an absent or empty `errors` array is accepted. HTTP failures surface as
operation errors. Each operation also checks its required data structure.

### OP-1: Read the profile

**Purpose and flow:** obtain the checking user's display name.
**Evidence basis:** Observed: account overview issues `UserQuery`.
**Context and prerequisites:** authenticated page and supplied session ID.
**Query:** `UserQuery`, variables `{}`, hash
`md5:f4a5ebcc4103cf23f7e582af45b0edd0`.

**Response and processing:** HTTP 200 JSON with `data.me`; keep the name fields.

```json
{"data":{"me":{"first_name":"Test","last_name":"User"}}}
```

**Outputs:** trimmed name components for the profile; profile ID from the cookie
precedence above.
**Errors and empty results:** require `me` to be an object. Join available name
components with a space; use the profile ID when both components are empty.

### OP-2: Discover accounts

**Evidence basis:** Observed: overview issues `HomeFeedAccountsQuery`;
Code-derived: account selection in the module.
**Context and prerequisites:** authenticated page and OP-1 profile.
**Query:** `HomeFeedAccountsQuery`, variables `{}`, hash
`md5:ca98a6f37e5df3c609f762c922dd5edb`.

**Response and processing:** HTTP 200 JSON; select
`data.user.bank_account_v2`.

```json
{
  "data": {
    "user": {
      "bank_account_v2": {
        "primary_funding_account": {"id":"<checking-id>","account_name":"Checking"},
        "savings_account": null,
        "secured_credit_account": null
      }
    }
  }
}
```

**Outputs:** account IDs and names; use OP-3/OP-4 for actual number suffixes.
**Selection and association:** checking and savings each use their named field.
Only explicit `null` means absent; a present value must be an object with a nonblank
string ID. Include a secured-credit entry when it supplies an ID.
**Errors and empty results:** reject a missing account root or malformed checking/
savings entry. All absent accounts produce an empty list. Credit mapping uses its
ID suffix as described in the contract table; its number semantics are unverified.
**Pagination and statement coverage:** no account continuation mechanism is
established by this response.

### OP-3: Read checking account-number details

**Evidence basis:** Observed: Profile > Account info issues `AccountInfoQuery`.
**Context and prerequisites:** a present checking account from OP-2.
**Query:** `AccountInfoQuery`, variables `{}`, hash
`md5:e57adf8d54262ff92f7b952f3aac90b7`.

**Response and processing:** HTTP 200 JSON:

```json
{
  "data": {
    "me": {
      "bank_account_v2": {
        "primary_funding_account": {
          "id": "<checking-id>",
          "account_number": "000000001234",
          "routing_number": "<routing-number>"
        }
      }
    }
  }
}
```

**Outputs:** the last four digits of `account_number`.
**Selection and association:** require the detail ID to equal OP-2's checking ID.
**Errors and empty results:** report missing/mismatched details or an account number
that is not a digit-only string of at least four digits. Only the suffix enters
the shared Account; the full number and routing number remain local to this read.

### OP-4: Read savings account-number details

**Evidence basis:** Observed: the endpoint accepts this query with a null savings
result; Code-derived: populated-result checks in the module.
**Context and prerequisites:** a present savings account from OP-2.
**Query:** `SavingsAccountInfoQuery`, variables `{}`, with this full query text:

```graphql
query SavingsAccountInfoQuery {
  me {
    bank_account_v2 {
      savings_account {
        id
        account_number
      }
    }
  }
}
```

**Response and processing:** JSON at `data.me.bank_account_v2.savings_account`.
The expected populated shape is:

```json
{"id":"<savings-id>","account_number":"000000005678"}
```

**Outputs:** savings account-number suffix.
**Selection and association:** apply OP-3's ID/number checks to the OP-2 savings ID
and this savings object. Checking details do not supply savings identity.
**Errors and empty results:** if OP-2 contains savings but this result is null,
missing or mismatched, report an error. Skip OP-4 when OP-2 savings is null.

### OP-5: List monthly periods

**Evidence basis:** Observed: Profile > Documents issues `DocumentsQuery`;
Code-derived: supported type selection and validation.
**Context and prerequisites:** an OP-2 account with its internal account type.
**Query:** `DocumentsQuery`, hash `md5:a17bd74480800ce36bfbc0c4b1516bae`.
The module sends `{"account_types":["credit","checking","savings"]}` as variables.
The UI also includes `unsecured_credit` and `line_of_credit`; these are outside
the module's account mappings.

**Response and processing:** HTTP 200 JSON:

```json
{
  "data": {
    "statements": {
      "statement_accounts": [{
        "name": "Checking",
        "account_type": "checking",
        "statement_periods": [{
          "display_name": "February 2000",
          "id": "1001_20000229",
          "month": 2,
          "year": 2000
        }]
      }]
    }
  }
}
```

**Outputs:** opaque period ID and explicit month/year for each selected period.
**Selection and association:** select the bucket for `Checking -> checking`,
`Savings -> savings`, or `CreditCard -> credit`. Require at most one matching
bucket. Period IDs contain an opaque prefix and date suffix; use the month/year
fields for period meaning.
**Errors and empty results:** validate the array and bucket type fields. An absent
matching bucket or empty periods array produces no statements. Each included period
requires a nonblank string ID, integer month 1-12, and integer year 1000-9999.
Malformed or ambiguous data is an error.
**Pagination and statement coverage:** use the full returned periods array and
sort newest first. The observed UI pages ten rows at a time from that array;
date-range retention guarantees are Unknown.

### OP-6: Retrieve a monthly PDF

**Evidence basis:** Observed: the checking monthly PDF action issues
`GetMonthlyPdfStatementQuery`; Code-derived: decoding and guards.
**Context and prerequisites:** selected account/type and OP-5 period.
**Query:** `GetMonthlyPdfStatementQuery`, hash
`md5:409087bebf32f903eaab1e1498e1a724`, variables:

```json
{"account_types":["checking"],"month":2,"year":2000}
```

**Inputs:** one API account type using OP-5's mapping; UTC month and year from the
shared statement date.
**Response and processing:** HTTP 200 JSON at
`data.statements.statement_accounts[0].monthly_pdf_statement.encoded_pdf`.
The account result also includes `name`; `encoded_pdf` is a base64 string.
**Delivery and outputs:** decode base64 to bytes, require a `%PDF-` prefix, and
construct an `application/pdf` Blob.
**Errors and empty results:** reject invalid dates, malformed account arrays,
multiple result buckets, missing encoded data, base64 decode errors, and non-PDF
bytes. An empty download result is an error.

## Shared contract mapping

| Contract field / flow | Source operation and field | Meaning, conversion and runtime checks |
| --- | --- | --- |
| Profile.sessionId | Authentication context | Cookie-derived session association |
| Profile.profileId / profileName | Cookie precedence / OP-1 | String ID; joined trimmed names or ID fallback |
| Account.profile / Statement.account | Caller profile / selected account | Preserve object association through OP-2 and OP-5 |
| Account.accountId / accountName | OP-2 named account object | String ID; account name with Checking, Savings or Credit Card default |
| Account.accountMask / checking, savings | OP-3 / OP-4 | ID-matched actual account number's last four digits |
| Account.accountMask / credit | OP-2 secured-credit ID | Code-derived ID suffix; actual number suffix is Unknown |
| Account.accountType | OP-2 | Primary name containing check/saving/credit, default Checking; named savings/credit fields map to Savings/CreditCard |
| Statement.statementId | OP-5 `id` | Opaque period selector stored unchanged |
| Statement.statementDate | OP-5 `year`, `month` | First day of the represented month at UTC midnight; OP-6 uses UTC getters |
| Downloaded Blob | OP-6 | Decoded PDF bytes with runtime signature check |

## Limitations and open questions

- **Untested:** populated savings details and savings/credit PDFs. OP-4 needs
  a populated account response to establish its real-number mapping end to end.
- **Unknown:** credit account-number source; the code-derived ID suffix lacks
  account-number evidence.
- **Unsupported by the module:** unsecured credit, line of credit, tax forms and
  other document types.
- **Unknown:** persisted-query stability across deployments, session expiry/
  cross-user behavior and document-retention limits. Determine these from their
  respective bank operations before making broader guarantees.
