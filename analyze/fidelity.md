# Fidelity Investments - Network API Analysis

**Analysis as of:** 2026-09-23

**Bank Information:**

- Bank: Fidelity Investments
- Website: https://www.fidelity.com / https://digitalservices.fidelity.com
- Current scope: authenticated investment/retirement Document Center and Fidelity credit-card statements
- Historical source: `analyze/fidelity_1763597495016.har`
- Implementation: `bank/fidelity.mjs`

## Current Document Center

The portfolio's Documents link now opens
`https://digitalservices.fidelity.com/navigate/ent-documentcenter/statements`.
The investment/retirement flow uses JSON REST endpoints rather than the historical
GraphQL document API. Use the Document Center origin for extension operations.

The authenticated portfolio still uses a separate REST-style
`POST https://digital.fidelity.com/ftgw/digital/portfolio/api/GetContext` with `{}`.
Its response is rooted at `getContext`, without a GraphQL `data` wrapper. The
Document Center obtains its accounts through the endpoint described below instead.

The historical `POST /ftgw/digital/documents/api/graphql` returned HTTP 403 on its
own `digital.fidelity.com` origin in the observed session. From the Document Center
origin, its cross-origin preflight returned 403. This is evidence for using the
current UI's endpoints, not proof that every historical API has been removed.
Do not bypass a rejected session or conceal automation.

### Authentication and application headers

The observed requests use browser session cookies with `credentials: 'include'`;
no Authorization header was present. Do not copy cookie values into code or notes.
Session identification continues to use the existing FC/MC/RC/SC cookie mechanism.
Persisted cookies do not guarantee that authentication is still valid.

The UI sends `Accept: application/json`, `Content-Type: application/json` for
POST bodies, and application metadata:

| Request group | `appid` and `fid-originating-app-id` | `appname` | `fid-originating-app-version` |
| --- | --- | --- | --- |
| Profile contacts | `AP162039` | `Enterprise Personal Info` | `2` |
| Document accounts and statement list | `AP160308` | `Document Access Hub` | `1` |
| Statement download | `AP160308` | `Document Access Hub` | `1.0` |

These are application-routing constants, not user credentials. The browser supplies
Cookie, Origin, and Referer. Do not hardcode per-request tracing identifiers.
Header presence alone does not prove that each header is mandatory. A reduced
contacts request without the application headers and address-selection field
returned 400; the email-only request below with the observed metadata returned JSON.
Those differences were not isolated individually.

### Profile: email-only contacts

The bank's Profile -> Personal information page requests
`POST https://digitalservices.fidelity.com/ftgw/dp/rwcf-cm-contacts/v4/customers/contacts/get`.
The extension only needs the retail primary email; do not request telephone or
address records.

```json
{
  "workplaceSrcs": ["PARTICIPANT"],
  "contactTypes": ["EMAIL"],
  "addrDetails": ["CUSTOMER"]
}
```

`addrDetails` is retained from the observed request, while `contactTypes` selects
only `EMAIL`. With that combination, the observed response contained only `emails`,
not telephone or address records:

```json
{
  "emails": [
    {
      "email": "person@example.com",
      "type": "PRIMARY",
      "custRel": "RETAIL"
    }
  ]
}
```

Map the `PRIMARY` / `RETAIL` email to both `profileId` and `profileName`, preserving
the existing contract. Missing or ambiguous primary-email data is an error, not an
anonymous-profile fallback.

### Account list

`POST https://dpservice.fidelity.com/ftgw/dp/customer-am-acctnxt/v2/accounts`

```json
{
  "acctCategory": "Brokerage,StockPlans,Annuity,Charitable,FidelityCreditCards,InternalDigital,BrokerageLending,RegisteredStock,WorkplaceBenefits,WorkplaceContributions",
  "filters": {
    "returnCustomerAttrDetail": true,
    "returnPreferenceDetail": true,
    "returnAcctRelAttrDetail": true,
    "returnAcctIndDetail": true,
    "returnOrderedAccounts": true,
    "returnAcctStateDetail": true
  }
}
```

Read `acctDetails[]` directly, not `data.getContext.person.assets`.

```json
{
  "acctDetails": [
    {
      "acctNum": "ACCOUNT0001",
      "acctType": "Brokerage",
      "acctSubTypeDesc": "Individual",
      "preferenceDetail": {
        "name": "Example investment account",
        "isHidden": false,
        "acctGroupId": "IA"
      }
    }
  ]
}
```

Keep the existing hidden-account filter and field mapping: account number as
`accountId`, its last four characters as `accountMask`, and the preference name as
`accountName`. Records without an account identifier are not individual accounts.
The observed account categories include Brokerage, WPS, SPS, and Fidelity Credit Card.
For credit cards this endpoint can return only the four-digit `acctNum`, without
`creditCardDetail`. That value is an account mask, not a statement API identifier;
use the Portfolio context described in the credit-card section to obtain the full ID.

### Statement list

`POST https://digitalservices.fidelity.com/ftgw/dp/retail-am-financialdoc/v1/accounts/communications/financial-documents/statements`

```json
{
  "startDate": "2026-01-01",
  "endDate": "2026-09-23",
  "docType": "STMT",
  "hasCryptoAccount": false,
  "annuityAccountLookup": true
}
```

Dates are request filters in `YYYY-MM-DD` format. The UI's default window was
three months; it is not evidence of a server retention limit. The extension uses
a six-calendar-month lookback computed in UTC, clamping the start day to the target
month's last day when needed.

```json
{
  "statement": {
    "docDetails": {
      "docDetail": [
        {
          "id": "<STATEMENT_ID>",
          "type": "PI Monthly/Quarterly Statement",
          "isHouseholded": true,
          "periodStartDate": 1767243600,
          "periodEndDate": 1769835600,
          "generatedDate": 1769835600,
          "formatTypes": {
            "formatType": {
              "isPDF": true,
              "isHTML": false,
              "isCSV": true
            }
          }
        }
      ]
    }
  }
}
```

The dates in this example are synthetic Unix seconds. Multiply by 1,000 before
constructing a JavaScript Date; do not use the historical MDDYYYY/MMDDYYYY parser.
Convert the period-end date to the contract's `YYYY-MM-DD` value. Reject dates
outside the four-digit year range instead of emitting an extended-year ISO string.

- `statement.docDetails.docDetail` is the response array; there is no GraphQL wrapper.
- `formatTypes.formatType` is an object, not an array.
- Keep PDF-capable entries and use the opaque `id` as `statementId`.
- Non-consolidated entries identify their account with `acctNum`; compare the full
  account identifier, not just the last four characters.
- Consolidated entries use `isHouseholded: true` and may omit `acctNum`. Do not drop
  them solely because an account number is absent. Such a document can appear under
  multiple investment accounts; its presence does not establish every constituent
  account without inspecting the document.
- `formatDocIds` can occur on non-consolidated entries. The observed consolidated
  download used `docDetail.id` directly; do not assume a format-specific ID is required.
- `type` is a display description, not the download's `docType` value.

### Download

`POST https://digitalservices.fidelity.com/ftgw/dp/retail-am-financialdoc/v2/accounts/communications/financial-documents/download`

```json
{
  "id": "<STATEMENT_ID>",
  "formatType": "PDF",
  "docType": "STMT",
  "acctType": "Brokerage"
}
```

The ID comes unchanged from the statement-list response. `Brokerage` was the UI's
download category for the selected consolidated investment/retirement statement;
do not substitute the extension's generic `Investment` account type.

```json
{
  "document": {
    "docDetail": {
      "contentType": "application/pdf",
      "content": "<BASE64_PDF>",
      "encoding": "Base64",
      "deflated": "Y",
      "updateViewedInd": true
    }
  }
}
```

Decode `document.docDetail.content` from Base64 and return a PDF Blob. Despite the
`deflated: "Y"` metadata, the observed decoded bytes were already a readable PDF;
do not blindly inflate them. Reject missing content, unsupported encodings, or
non-PDF decoded bytes rather than saving a JSON/HTML error as a statement.
The bank UI creates a blob URL for its viewer; that transient URL is not the API.

### Scope and open questions

The Document Center evidence covers investment/retirement documents and the
email-only profile lookup. It does not establish cryptocurrency, annuity-specific,
or workplace download behavior. The current response shapes take precedence over
the historical investment examples below.

## Current Credit-Card Statements

The linked credit-card account's Statements link opens
`https://digital.fidelity.com/ftgw/digital/portfolio/creditstatements`.
The webpage requests the following REST APIs on `dpservice.fidelity.com`, not the
historical credit-card GraphQL endpoint. That GraphQL endpoint returned HTTP 403
when the extension requested a statement list in the observed authenticated session.
Use the current UI's APIs; do not retry rejected endpoints with authentication or
fingerprint overrides.

### Full credit-card identifier

The Portfolio page calls:

```http
POST https://digital.fidelity.com/ftgw/digital/portfolio/api/GetContext
Accept: application/json
Content-Type: application/json
```

The JSON request body is `{}` and uses `credentials: 'include'`. The response is
rooted at `getContext`, not `data.getContext`.

```json
{
  "getContext": {
    "person": {
      "assets": [
        {
          "acctNum": "0002",
          "acctType": "Fidelity Credit Card",
          "creditCardDetail": {
            "creditCardAcctNumber": "<FULL_CARD_ID>",
            "memberId": "<MEMBER_ID>"
          }
        }
      ]
    }
  }
}
```

For a visible credit-card account lacking the full ID in the Document Center
response, fetch this context once per account-list operation. Match the card by
`acctType` and `acctNum`, require one unambiguous match, and use
`creditCardDetail.creditCardAcctNumber` as the contract's `accountId`. Retain the
short account number as `accountMask` and the Document Center's display name.
If a full ID is already supplied, use it without an additional context request.
Do not substitute `memberId` or the four-digit mask, and do not guess when two cards
share a mask. Missing or ambiguous full IDs must produce an explicit error.

The successful webpage statement request's path ID matched this field, not
`acctNum`. The context request also returned account data when made from the
Document Center origin with ordinary browser credentials; no extra extension host
permissions were needed for that observed cross-origin flow.

### Request metadata

List and download are GET requests with no body. The webpage sends:

```http
Accept: application/json, text/plain, */*
Content-Type: application/json
appid: AP159750
appname: Portfolio Summary Credit Card Account Management
```

Use `credentials: 'include'` so the browser supplies the session cookies. Do not
copy live Cookie, Origin, Referer, or tracing values. The application headers are
public routing constants; their presence in a capture does not independently
establish that each is required.

### Statement list

```http
GET https://dpservice.fidelity.com/ftgw/dp/customer-creditcard-statements/v1/customers/creditcards/{FULL_CARD_ID}/statements?startDate={YYYY-MM-DD}&endDate={YYYY-MM-DD}
```

Encode the full card ID as one URL path segment. The UI used a six-month date
filter; this does not establish the bank's retention limit or guarantee a statement
for every month. The extension shares the investment flow's UTC six-calendar-month
calculation with month-end clamping.

```json
{
  "statements": [
    {
      "statementName": "January 2026 (pdf)",
      "statementStartDate": "2025-12-19",
      "statementEndDate": "2026-01-18",
      "statementDate": "2026-01-18",
      "cardOffersAndNotices": []
    }
  ],
  "isPaperlessEnrolled": "Already Enrolled"
}
```

`statements` is a top-level array. Use its `statementDate` for `statementId`, the
contract's date, and the download path. In the observed response it equals
`statementEndDate`; do not infer that a missing download date can be reconstructed
from a display label. Require a valid `YYYY-MM-DD` calendar date. An empty array is
a valid empty list; a missing array or malformed entry is an error.
`cardOffersAndNotices` describes inserts, not the main statement PDF.

### Download

```http
GET https://dpservice.fidelity.com/ftgw/dp/customer-creditcard-statements/v1/customers/creditcards/{FULL_CARD_ID}/statements/{STATEMENT_DATE}
```

The webpage's selected statement supplies the full card ID and the date from the
list. The response is JSON, not a direct PDF and not a GraphQL wrapper:

```json
{
  "statement": {
    "statementDate": "2026-01-18",
    "pageContent": "<BASE64_PDF>"
  }
}
```

Require the returned date to match the requested statement. Decode `pageContent`
and return an `application/pdf` Blob. Reject empty, malformed, or non-PDF content
rather than saving an error as a statement. The bank UI opens a blob URL; the
temporary viewer URL is not a reusable download endpoint. No external issuer SSO
was involved in this observed Fidelity flow.

---

## Historical capture

The remaining sections describe the older GraphQL and direct-PDF flow. They are
retained for provenance, not as current endpoint guidance.
The REST flows above supersede the historical investment and credit-card examples.

### API Flow Overview

**Account Types and Download Flows:**

- Brokerage/Investment Accounts - Direct PDF download
- Credit Card Accounts - GraphQL with Base64-encoded PDF
- Retirement Accounts - Direct PDF download

**Key Implementation Notes:**

- Session cookies: Supports FC, MC, RC, or SC cookies for authentication
- Date format: Handles variable-length Fidelity date format (MDDYYYY or MMDDYYYY)
- Credit card downloads use different API than brokerage (GraphQL vs direct URL)
- Account filtering by `isHidden` flag implemented

### Account Categories

The captured account overview includes investment, retirement, professionally managed,
spend & save, authorized, and credit card categories. Investment, retirement, and IRA
accounts can share a consolidated statement.

---

### Session Authentication

#### Session Identification

Fidelity uses **HTTP cookies** for session management. The primary session cookies include:

- **FC** - Main session token (encrypted) - _Present in HAR file_
- **MC** - Secondary session token - _Observed in browser session_
- **RC** - Secondary session token - _Observed in browser session_
- **SC** - Secondary session token - _Observed in browser session_
- **ATC** - Authentication token
- **PORTSUM_XSRF-TOKEN** - CSRF protection token
- **portsum\_.csrf** - Additional CSRF token

All these cookies are **Not HttpOnly** and CAN be accessed via JavaScript.

**Note**: Different Fidelity sessions may use different session cookies (FC, MC, RC, or SC). The implementation checks for any of these cookies to ensure compatibility across different browsers or login sessions.

#### Important Notes

- Sessions expire after inactivity
- Multi-factor authentication (MFA) is required at login
- All API requests use `credentials: 'include'` to automatically send session cookies

---

### API Endpoints Overview

Fidelity uses a **GraphQL-based API architecture** with multiple specialized endpoints:

#### 1. Portfolio API

- **Base URL**: `https://digital.fidelity.com/ftgw/digital/portfolio/api/graphql`
- **Purpose**: Portfolio summary, account state, preferences

#### 2. Credit Card API

- **Base URL**: `https://digital.fidelity.com/ftgw/digital/credit-card/api/graphql`
- **Purpose**: Credit card statement listing

#### 3. Documents API

- **Base URL**: `https://digital.fidelity.com/ftgw/digital/documents/api/graphql`
- **Purpose**: Statement listing and document metadata

#### 4. PDF Statement Download

- **Base URL**: `https://digital.fidelity.com/ftgw/digital/documents/PDFStatement/STMT/pdf/`
- **Type**: REST endpoint for binary PDF download

---

### Task 1: Retrieve User Profile Information

**Note**: Fidelity does not provide a dedicated user name API. Use the email address from `GetDeliveryPref` as the profile identifier.

#### Delivery Preferences API

##### API Endpoint

```
POST https://digital.fidelity.com/ftgw/digital/documents/api/graphql
```

##### HTTP Method

`POST`

##### Required Headers

- `Content-Type: application/json`
- `Cookie`: [Session cookies from login]

##### Request Parameters

GraphQL operation: `GetDeliveryPref`

No variables required.

##### Request Body Example

```json
{
  "operationName": "GetDeliveryPref",
  "query": "query GetDeliveryPref {\n  deliveryPrefData {\n    deliveryPrefInquiry {\n      deliveryPref {\n        custInformation {\n          emailAddr\n          __typename\n        }\n        docDeliveryPref {\n          isElectronicMonthlyQuarterlyStmt\n          fundRprts\n          __typename\n        }\n        __typename\n      }\n      __typename\n    }\n    __typename\n  }\n}\n"
}
```

##### Response Structure

Returns email and delivery preferences:

```json
{
  "data": {
    "deliveryPrefData": {
      "deliveryPrefInquiry": {
        "deliveryPref": {
          "custInformation": {
            "emailAddr": "person@example.com"
          },
          "docDeliveryPref": {
            "isElectronicMonthlyQuarterlyStmt": true,
            "fundRprts": "EDELIVERY"
          }
        }
      }
    }
  }
}
```

#### Important Fields

- `emailAddr`: User's email address (uppercase format) - **Use this as the profile identifier/name**
- `isElectronicMonthlyQuarterlyStmt`: Boolean indicating electronic delivery preference
- `fundRprts`: Report delivery method

#### Profile ID/Name

Use email address as the profile identifier:

- **Profile ID**: Email address from `emailAddr` field
- **Profile Name**: Email address from `emailAddr` field

---

### Task 2: List All Accounts

#### Portfolio Summary Accounts

##### API Endpoint

```
POST https://digital.fidelity.com/ftgw/digital/portfolio/api/graphql
```

This endpoint provides portfolio-level account information (investment, retirement, brokerage accounts).

##### HTTP Method

`POST`

##### Required Headers

- `Content-Type: application/json`
- `Cookie`: [Session cookies]
- `Referer`: https://digital.fidelity.com/ftgw/digital/portfolio/summary

##### Request Parameters

GraphQL operation: `GetContext`

**No variables required** - retrieves all accounts for the authenticated user.

##### Request Body Example

```json
{
  "operationName": "GetContext",
  "query": "query GetContext {\n  getContext {\n    person {\n      assets {\n        acctNum\n        acctType\n        acctSubType\n        acctSubTypeDesc\n        acctCreationDate\n        preferenceDetail {\n          name\n          isHidden\n          isDefaultAcct\n          acctGroupId\n        }\n        gainLossBalanceDetail {\n          totalMarketVal\n          todaysGainLoss\n          todaysGainLossPct\n        }\n        acctAttrDetail {\n          regTypeDesc\n          taxTreatmentCode\n        }\n        creditCardDetail {\n          creditCardAcctNumber\n          memberId\n        }\n      }\n    }\n  }\n}\n"
}
```

##### Response Structure

Returns comprehensive account information grouped by categories:

```json
{
  "data": {
    "getContext": {
      "person": {
        "balances": {
          "balanceDetail": {
            "gainLossBalanceDetail": {
              "totalMarketVal": 0,
              "todaysGainLoss": 0,
              "todaysGainLossPct": 0
            }
          }
        },
        "assets": [
          {
            "acctNum": "<ACCOUNT_ID_1>",
            "acctType": "Brokerage",
            "acctSubType": "Brokerage",
            "acctSubTypeDesc": "Brokerage General Investing Person",
            "acctCreationDate": 1635224400,
            "preferenceDetail": {
              "name": "Example account group 1",
              "isHidden": false,
              "isDefaultAcct": false,
              "acctGroupId": "IA"
            },
            "gainLossBalanceDetail": {
              "totalMarketVal": 0,
              "todaysGainLoss": 0,
              "todaysGainLossPct": 0
            },
            "acctAttrDetail": {
              "regTypeDesc": "Individual - TOD",
              "taxTreatmentCode": "TAXED"
            }
          },
          {
            "acctNum": "0002",
            "acctType": "Fidelity Credit Card",
            "acctSubType": "Credit Card",
            "acctSubTypeDesc": "Credit Card",
            "preferenceDetail": {
              "name": "Example account group 2",
              "isHidden": false,
              "isDefaultAcct": false,
              "acctGroupId": "CC"
            },
            "gainLossBalanceDetail": {
              "totalMarketVal": 0
            },
            "creditCardDetail": {
              "creditCardAcctNumber": "<ACCOUNT_ID_3>",
              "memberId": "<MEMBER_ID_1>",
              "twelveMonthRewards": "87.21"
            }
          }
        ],
        "groups": [
          {
            "id": "IA",
            "name": "Investment",
            "items": [...],
            "balanceDetail": {
              "gainLossBalanceDetail": {
                "totalMarketVal": 0,
                "todaysGainLoss": 0,
                "todaysGainLossPct": 0
              }
            }
          },
          {
            "id": "RA",
            "name": "Retirement",
            "items": [...],
            "balanceDetail": {...}
          },
          {
            "id": "CC",
            "name": "Credit Cards",
            "items": [...]
          }
        ]
      }
    }
  }
}
```

##### Important Fields in Response

**Account Level (`assets` array):**

- `acctNum`: Account number/identifier
- `acctType`: Account type (Brokerage, Fidelity Credit Card, SPS, etc.)
- `acctSubType`: Sub-type (Brokerage, Credit Card, Health Savings, etc.)
- `acctSubTypeDesc`: Human-readable description
- `preferenceDetail.name`: Account nickname/display name
- `preferenceDetail.isHidden`: Whether account is hidden
- `preferenceDetail.acctGroupId`: Group category (IA=Investment, RA=Retirement, CC=Credit Cards, etc.)
- `gainLossBalanceDetail.totalMarketVal`: Current account balance
- `acctAttrDetail.regTypeDesc`: Registration type (Individual, ROTH IRA, Traditional IRA, etc.)
- `creditCardDetail.creditCardAcctNumber`: Full credit card account number (for credit cards)
- `creditCardDetail.memberId`: Credit card member ID

**Group Level (`groups` array):**

- `id`: Group ID (IA, RA, PM, SC, CC, etc.)
- `name`: Group display name
- `items`: Array of accounts in this group
- `balanceDetail.gainLossBalanceDetail.totalMarketVal`: Total balance for all accounts in group

**Portfolio Level (`balances`):**

- `balanceDetail.gainLossBalanceDetail.totalMarketVal`: Total portfolio value across all accounts
- `balanceDetail.gainLossBalanceDetail.todaysGainLoss`: Today's gain/loss in dollars
- `balanceDetail.gainLossBalanceDetail.todaysGainLossPct`: Today's gain/loss percentage

##### Account Categories (Groups)

- `IA`: Investment (Individual/Joint brokerage accounts)
- `RA`: Retirement (401k, HSA, IRA accounts)
- `PM`: Professionally Managed (IRA accounts)
- `SC`: Spend & Save (Cash Management, Savings)
- `CC`: Credit Cards
- `AA`: Authorized (Stock plans from employer)
- `SP`: Stock Plans
- `CG`: Charitable Giving
- Other groups: ID (Cryptocurrency), EA (Education), FV (Non-Fidelity), etc.

##### Notes

- Returns all account types (brokerage, retirement, credit cards, stock plans) in a single call
- Credit card accounts: `acctNum` shows last 4 digits; use `creditCardDetail.creditCardAcctNumber` for full account number
- Filter hidden accounts using `preferenceDetail.isHidden` flag
- For credit card APIs, use `creditCardDetail.creditCardAcctNumber` (not `acctNum`)

---

### Task 3: List Available Statements

#### API Endpoint

```
POST https://digital.fidelity.com/ftgw/digital/documents/api/graphql
```

#### HTTP Method

`POST`

#### Required Headers

- `Content-Type: application/json`
- `Cookie`: [Session cookies]
- `Referer`: https://digital.fidelity.com/ftgw/digital/documents

#### GraphQL Operation

`GetStatements`

#### Request Parameters

```json
{
  "operationName": "GetStatements",
  "variables": {
    "docType": "STMT",
    "startDate": "2025-05-19",
    "endDate": "2025-11-19"
  },
  "query": "query GetStatements($docType: String, $startDate: String, $endDate: String) {\n  getStatement(docType: $docType, startDate: $startDate, endDate: $endDate) {\n    statement {\n      docDetails {\n        docDetail {\n          id\n          type\n          acctNum\n          periodStartDate\n          periodEndDate\n          generatedDate\n          isHouseholded\n          householdNum\n          formatTypes {\n            formatType {\n              isPDF\n              isCSV\n            }\n          }\n        }\n      }\n    }\n  }\n}\n"
}
```

#### Request Body Example

```json
{
  "operationName": "GetStatements",
  "variables": {
    "docType": "STMT",
    "startDate": "2025-05-19",
    "endDate": "2025-11-19"
  },
  "query": "query GetStatements($docType: String, $startDate: String, $endDate: String) {\n  getStatement(docType: $docType, startDate: $startDate, endDate: $endDate) {\n    statement {\n      docDetails {\n        docDetail {\n          id\n          type\n          acctNum\n          periodStartDate\n          periodEndDate\n          generatedDate\n          isHouseholded\n          householdNum\n          formatTypes {\n            formatType {\n              isPDF\n              isCSV\n            }\n          }\n        }\n      }\n    }\n  }\n}\n"
}
```

#### Parameters

- `docType`: Document type (e.g., "STMT" for statements)
- `startDate`: Start date filter (YYYY-MM-DD format)
- `endDate`: End date filter (YYYY-MM-DD format)

#### Response Structure

```json
{
  "data": {
    "getStatement": {
      "statement": {
        "docDetails": {
          "docDetail": [
            {
              "id": "[STATEMENT_ID]",
              "type": "STMT",
              "acctNum": "[ACCOUNT_NUMBER]",
              "periodStartDate": "2025-10-01",
              "periodEndDate": "2025-10-31",
              "generatedDate": "2025-11-01",
              "isHouseholded": false,
              "householdNum": null,
              "formatTypes": {
                "formatType": [
                  {
                    "isPDF": true,
                    "isCSV": false
                  }
                ]
              }
            }
          ]
        }
      }
    }
  }
}
```

#### Important Fields

- `id`: Statement ID (used for downloading PDF)
- `type`: Document type (STMT, TAX, etc.)
- `acctNum`: Associated account number
- `periodStartDate`: Statement period start date
- `periodEndDate`: Statement period end date
- `generatedDate`: Date the statement was generated
- `isHouseholded`: Whether this is a household/consolidated statement
- `formatTypes.formatType`: Available formats (PDF, CSV)

#### Notes

- Returns statements for all brokerage/investment/retirement accounts (not credit cards)
- Date range filters statements by period end date
- Consolidated statements covering multiple accounts have `isHouseholded: true`
- No account ID parameter - lists all statements for the authenticated user

---

#### For Credit Card Accounts (Alternative API)

##### API Endpoint

```
POST https://digital.fidelity.com/ftgw/digital/credit-card/api/graphql
```

##### HTTP Method

`POST`

##### Required Headers

- `Content-Type: application/json`
- `Cookie`: [Session cookies]
- `apollographql-client-name: credit-card`
- `apollographql-client-version: 0.0.1`
- `Referer: https://digital.fidelity.com/ftgw/digital/portfolio/creditstatements`

##### GraphQL Operation

`GetStatementsList`

##### Request Parameters

**Query Variables:**

```json
{
  "accountId": "<ACCOUNT_ID_3>",
  "dateRange": {
    "startDate": "2025-05-19",
    "endDate": "2025-11-19"
  }
}
```

**How to Choose Account ID:**

The `accountId` parameter must be the **full credit card account number**, obtained from:

1. **GetContext API** (Task 2) → `creditCardDetail.creditCardAcctNumber`

   - Example: `"creditCardAcctNumber": "<ACCOUNT_ID_3>"`
   - This is the FULL account number, not the shortened `acctNum` (e.g., "0002")

2. **Do NOT use** the `acctNum` field from the credit card item in the GetContext response
   - `acctNum: "0002"` ← This is the LAST 4 digits only
   - `creditCardDetail.creditCardAcctNumber: "<ACCOUNT_ID_3>"` ← Use this

##### Request Body Example

```json
{
  "operationName": "GetStatementsList",
  "variables": {
    "accountId": "<ACCOUNT_ID_3>",
    "dateRange": {
      "startDate": "2025-05-19",
      "endDate": "2025-11-19"
    }
  },
  "query": "query GetStatementsList($accountId: String!, $dateRange: DateRange, $year: String) {\n  getStatementsList(accountId: $accountId, dateRange: $dateRange, year: $year) {\n    statements {\n      statementName\n      statementStartDate\n      statementEndDate\n      cardOffersAndNotices {\n        eInsertId\n        description\n      }\n    }\n    isPaperlessEnrolled\n  }\n}\n"
}
```

##### Response Structure

```json
{
  "data": {
    "getStatementsList": {
      "statements": [
        {
          "statementName": "November 2025 - Oct-18 to Nov-18 (pdf)",
          "statementStartDate": "2025-10-18",
          "statementEndDate": "2025-11-18",
          "cardOffersAndNotices": []
        },
        {
          "statementName": "October 2025 - Sep-19 to Oct-17 (pdf)",
          "statementStartDate": "2025-09-19",
          "statementEndDate": "2025-10-17",
          "cardOffersAndNotices": []
        }
      ],
      "isPaperlessEnrolled": "Already Enrolled"
    }
  }
}
```

##### Important Fields

- `statementName`: Human-readable statement name with date range
- `statementStartDate`: Statement period start date (YYYY-MM-DD)
- `statementEndDate`: Statement period end date (YYYY-MM-DD)
- `cardOffersAndNotices`: Additional inserts (e.g., privacy notices)
  - `eInsertId`: Insert identifier
  - `description`: Insert description
- `isPaperlessEnrolled`: Paperless enrollment status

##### Source APIs

**Account ID Source**: `GetContext` API (Task 2) → `creditCardDetail.creditCardAcctNumber`

##### Notes

- Credit card specific API
- Requires full account number from `creditCardDetail.creditCardAcctNumber` (not `acctNum`)
- Date range is optional; omit to get all available statements

---

### Task 4: Download Statement PDF

#### For Brokerage/Investment Accounts

##### API Endpoint

```
GET https://digital.fidelity.com/ftgw/digital/documents/PDFStatement/STMT/pdf/Statement{DATE}.pdf
```

##### HTTP Method

`GET`

##### URL Structure

```
https://digital.fidelity.com/ftgw/digital/documents/PDFStatement/{DOCTYPE}/pdf/{FILENAME}.pdf?id={ENCODED_ID}
```

**Example:**

```
https://digital.fidelity.com/ftgw/digital/documents/PDFStatement/STMT/pdf/Statement10312025.pdf?id=RVhBTVBMRV9TVEFURU1FTlRfSURfMQ==
```

#### URL Parameters

- `{DOCTYPE}`: Document type (e.g., "STMT")
- `{FILENAME}`: PDF filename (e.g., "Statement10312025.pdf")
- `id`: Base64-encoded statement identifier from `GetStatements` API

#### Required Headers

- `Cookie`: [Session cookies]
- `Referer`: https://digital.fidelity.com/ftgw/digital/documents

#### Response

- **Content-Type**: `application/pdf`
- **Content-Disposition**: `inline;filename="Statement10312025.pdf"`
- **Body**: Binary PDF content

#### Parameter Sources

##### Statement ID (`id` query parameter)

**Source API**: `GetStatements` (see Task 3 above)

- The `id` field from the statement list response is used as the query parameter
- This ID is already Base64-encoded in the response

##### Filename

**Source**: Can be constructed from `periodEndDate` field in `GetStatements` response

- Format: `Statement{MMDDYYYY}.pdf`
- Example: For `periodEndDate: "2025-10-31"`, filename is `Statement10312025.pdf`

##### Document Type

**Source**: `type` field from `GetStatements` response

- Common values: "STMT", "TAX", "CONFIRM"

#### Download Flow

1. Call `GetStatements` API to retrieve statement list
2. Extract `id` and `periodEndDate` from desired statement
3. Construct URL:
   - Use `id` as the `id` query parameter
   - Construct filename from `periodEndDate`
4. Make GET request with session cookies
5. Receive binary PDF response

#### Example Statement ID Decoding

The `id` parameter appears to be Base64-encoded and contains:

- Statement date
- Account identifier
- Other metadata

**Example**: `RVhBTVBMRV9TVEFURU1FTlRfSURfMQ==`

Decoded (synthetic example): `EXAMPLE_STATEMENT_ID_1`

- Includes: Date, account reference, format code

##### Notes

- For brokerage/investment/retirement accounts only (not credit cards)
- Simple GET request with encoded statement ID from `GetStatements` API
- Account association is embedded in the encoded `id` parameter
- Consolidated multi-account statements use the same endpoint

---

#### For Credit Card Accounts

##### API Endpoint

```
POST https://digital.fidelity.com/ftgw/digital/credit-card/api/graphql
```

##### HTTP Method

`POST`

##### Required Headers

- `Content-Type: application/json`
- `Cookie`: [Session cookies]
- `apollographql-client-name: credit-card`
- `apollographql-client-version: 0.0.1`
- `Referer: https://digital.fidelity.com/ftgw/digital/portfolio/creditstatements`

##### GraphQL Operation

`GetStatement`

##### Request Parameters

**Query Variables:**

```json
{
  "accountId": "<ACCOUNT_ID_3>",
  "statementDate": "2025-11-18"
}
```

**Parameter Sources:**

- `accountId`: Full credit card account number from `GetContext` API → `creditCardDetail.creditCardAcctNumber`
- `statementDate`: Statement end date from `GetStatementsList` API → `statementEndDate` (YYYY-MM-DD format)

##### Request Body Example

```json
{
  "operationName": "GetStatement",
  "variables": {
    "accountId": "<ACCOUNT_ID_3>",
    "statementDate": "2025-11-18"
  },
  "query": "query GetStatement($accountId: String!, $statementDate: String!) {\n  getStatement(accountId: $accountId, statementDate: $statementDate) {\n    statement {\n      statementDate\n      pageContent\n      __typename\n    }\n    __typename\n  }\n}\n"
}
```

##### Response Structure

```json
{
  "data": {
    "getStatement": {
      "statement": {
        "statementDate": "2025-11-18",
        "pageContent": "JVBERi0xLjQK...[BASE64_ENCODED_PDF]...",
        "__typename": "Statement"
      },
      "__typename": "GetStatementResponse"
    }
  }
}
```

##### Important Fields

- `statementDate`: Statement date (YYYY-MM-DD)
- `pageContent`: **Base64-encoded PDF content** - decode this to get the binary PDF

##### Download Flow

1. Call `GetContext` API to get credit card account number
2. Call `GetStatementsList` API to get available statements
3. Extract `statementEndDate` from desired statement
4. Call `GetStatement` GraphQL with:
   - `accountId`: Full credit card account number
   - `statementDate`: Statement end date
5. Decode `pageContent` from Base64 to binary PDF
6. Save as PDF file

##### Source APIs

- **Account ID**: `GetContext` API → `creditCardDetail.creditCardAcctNumber`
- **Statement Date**: `GetStatementsList` API → `statementEndDate`

##### Notes

- Credit card specific API
- Returns Base64-encoded PDF (different from brokerage direct download)
- Requires full account number from `creditCardDetail.creditCardAcctNumber`
- PDF is served directly by Fidelity's API (no external SSO)

---

### Authentication & Security

- **Cookie-based authentication** using FC, MC, RC, or SC session cookies
- All API endpoints use HTTPS
- Session cookies must be preserved across requests with `credentials: 'include'`
- Sessions expire after inactivity

---

### API Flow Summary

#### For Brokerage/Investment/Retirement Accounts

1. **GetDeliveryPref** → Get email (profile)
2. **GetContext** → Get all accounts
3. **GetStatements** → List statements (no account ID needed)
4. **Direct PDF Download** → Download via URL with statement ID

#### For Credit Card Accounts

1. **GetDeliveryPref** → Get email (profile)
2. **GetContext** → Get accounts and extract `creditCardDetail.creditCardAcctNumber`
3. **GetStatementsList** → List statements (requires full account number)
4. **GetStatement** → Download Base64-encoded PDF (requires account ID and statement date)

---

### File Information

**HAR File**: `analyze/fidelity_1763597495016.har`

- **Size**: 19.40 MB
- **Total Entries**: 535 Fidelity domain requests

**APIs present in the capture:**

- Portfolio summary API
- Credit card API (details, transactions, rewards)
- Document listing API
- PDF download API
- User state/preferences API

---

### Summary

Fidelity uses a GraphQL API architecture with separate endpoints for portfolio, credit cards, and documents. Authentication is cookie-based (FC, MC, RC, or SC cookies).

**Key Differences:**

- **Brokerage/Investment**: Direct PDF download via URL
- **Credit Cards**: GraphQL API with Base64-encoded PDF content
