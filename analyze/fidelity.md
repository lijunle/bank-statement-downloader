# Fidelity Investments - Network API Analysis

**Bank Information:**

- Bank: Fidelity Investments
- Website: https://www.fidelity.com / https://digital.fidelity.com
- HAR File: `analyze/fidelity_1763597495016.har`
- Captured: November 19, 2025
- Implementation: `bank/fidelity.mjs`
- Status: ✅ Validated

## Implementation Status

**Status:** ✅ Fully Validated and Working

**Supported Account Types:**

- ✅ Brokerage/Investment Accounts - Direct PDF download
- ✅ Credit Card Accounts - GraphQL with Base64-encoded PDF
- ✅ Retirement Accounts - Direct PDF download

**Key Implementation Notes:**

- Session cookies: Supports FC, MC, RC, or SC cookies for authentication
- Date format: Handles variable-length Fidelity date format (MDDYYYY or MMDDYYYY)
- Credit card downloads use different API than brokerage (GraphQL vs direct URL)
- Account filtering by `isHidden` flag implemented

## Account Information

Based on the captured network trace, the user has:

- **10 accounts** across 6 categories:
  - Investment (2 accounts)
  - Retirement (2 accounts)
  - Professionally managed (3 accounts)
  - Spend & Save (1 account)
  - Authorized (1 account)
  - Credit cards (1 account - Visa Signature Rewards)

**Statements Downloaded:**

1. Credit Card Statement: Nov 2025 (Visa Signature Rewards, Statement date: Oct-18 to Nov-18)
2. Multi-Account Consolidated Statement: Oct 2025 (includes investment, retirement, and IRA accounts)

---

## Session Authentication

### Session Identification

Fidelity uses **HTTP cookies** for session management. The primary session cookies include:

- **FC** - Main session token (encrypted) - _Present in HAR file_
- **MC** - Secondary session token - _✅ Verified in live session_
- **RC** - Secondary session token - _✅ Verified in live session_
- **SC** - Secondary session token - _✅ Verified in live session_
- **ATC** - Authentication token
- **PORTSUM_XSRF-TOKEN** - CSRF protection token
- **portsum\_.csrf** - Additional CSRF token

All these cookies are **Not HttpOnly** and CAN be accessed via JavaScript.

**Note**: Different Fidelity sessions may use different session cookies (FC, MC, RC, or SC). The implementation checks for any of these cookies to ensure compatibility across different browsers or login sessions.

### Important Notes

- Sessions expire after inactivity
- Multi-factor authentication (MFA) is required at login
- All API requests use `credentials: 'include'` to automatically send session cookies

---

## API Endpoints Overview

Fidelity uses a **GraphQL-based API architecture** with multiple specialized endpoints:

### 1. Portfolio API

- **Base URL**: `https://digital.fidelity.com/ftgw/digital/portfolio/api/graphql`
- **Purpose**: Portfolio summary, account state, preferences

### 2. Credit Card API

- **Base URL**: `https://digital.fidelity.com/ftgw/digital/credit-card/api/graphql`
- **Purpose**: Credit card statement listing

### 3. Documents API

- **Base URL**: `https://digital.fidelity.com/ftgw/digital/documents/api/graphql`
- **Purpose**: Statement listing and document metadata

### 4. PDF Statement Download

- **Base URL**: `https://digital.fidelity.com/ftgw/digital/documents/PDFStatement/STMT/pdf/`
- **Type**: REST endpoint for binary PDF download

---

## Task 1: Retrieve User Profile Information

**Note**: Fidelity does not provide a dedicated user name API. Use the email address from `GetDeliveryPref` as the profile identifier.

### Delivery Preferences API

#### API Endpoint

```
POST https://digital.fidelity.com/ftgw/digital/documents/api/graphql
```

#### HTTP Method

`POST`

#### Required Headers

- `Content-Type: application/json`
- `Cookie`: [Session cookies from login]

#### Request Parameters

GraphQL operation: `GetDeliveryPref`

No variables required.

#### Request Body Example

```json
{
  "operationName": "GetDeliveryPref",
  "query": "query GetDeliveryPref {\n  deliveryPrefData {\n    deliveryPrefInquiry {\n      deliveryPref {\n        custInformation {\n          emailAddr\n          __typename\n        }\n        docDeliveryPref {\n          isElectronicMonthlyQuarterlyStmt\n          fundRprts\n          __typename\n        }\n        __typename\n      }\n      __typename\n    }\n    __typename\n  }\n}\n"
}
```

#### Response Structure

Returns email and delivery preferences:

```json
{
  "data": {
    "deliveryPrefData": {
      "deliveryPrefInquiry": {
        "deliveryPref": {
          "custInformation": {
            "emailAddr": "JOHN.DOE@EXAMPLE.COM"
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

### Important Fields

- `emailAddr`: User's email address (uppercase format) - **Use this as the profile identifier/name**
- `isElectronicMonthlyQuarterlyStmt`: Boolean indicating electronic delivery preference
- `fundRprts`: Report delivery method

### Profile ID/Name

Use email address as the profile identifier:

- **Profile ID**: Email address from `emailAddr` field
- **Profile Name**: Email address from `emailAddr` field

---

## Task 2: List All Accounts

### Portfolio Summary Accounts

#### API Endpoint

```
POST https://digital.fidelity.com/ftgw/digital/portfolio/api/graphql
```

This endpoint provides portfolio-level account information (investment, retirement, brokerage accounts).

#### HTTP Method

`POST`

#### Required Headers

- `Content-Type: application/json`
- `Cookie`: [Session cookies]
- `Referer`: https://digital.fidelity.com/ftgw/digital/portfolio/summary

#### Request Parameters

GraphQL operation: `GetContext`

**No variables required** - retrieves all accounts for the authenticated user.

#### Request Body Example

```json
{
  "operationName": "GetContext",
  "query": "query GetContext {\n  getContext {\n    person {\n      assets {\n        acctNum\n        acctType\n        acctSubType\n        acctSubTypeDesc\n        acctCreationDate\n        preferenceDetail {\n          name\n          isHidden\n          isDefaultAcct\n          acctGroupId\n        }\n        gainLossBalanceDetail {\n          totalMarketVal\n          todaysGainLoss\n          todaysGainLossPct\n        }\n        acctAttrDetail {\n          regTypeDesc\n          taxTreatmentCode\n        }\n        creditCardDetail {\n          creditCardAcctNumber\n          memberId\n        }\n      }\n    }\n  }\n}\n"
}
```

#### Response Structure

Returns comprehensive account information grouped by categories:

```json
{
  "data": {
    "getContext": {
      "person": {
        "balances": {
          "balanceDetail": {
            "gainLossBalanceDetail": {
              "totalMarketVal": 8100.87,
              "todaysGainLoss": -781.18,
              "todaysGainLossPct": -1.12
            }
          }
        },
        "assets": [
          {
            "acctNum": "K48271593",
            "acctType": "Brokerage",
            "acctSubType": "Brokerage",
            "acctSubTypeDesc": "Brokerage General Investing Person",
            "acctCreationDate": 1635224400,
            "preferenceDetail": {
              "name": "MY STOCK",
              "isHidden": false,
              "isDefaultAcct": false,
              "acctGroupId": "IA"
            },
            "gainLossBalanceDetail": {
              "totalMarketVal": 4247.22,
              "todaysGainLoss": 162.9,
              "todaysGainLossPct": 3
            },
            "acctAttrDetail": {
              "regTypeDesc": "Individual - TOD",
              "taxTreatmentCode": "TAXED"
            }
          },
          {
            "acctNum": "3842",
            "acctType": "Fidelity Credit Card",
            "acctSubType": "Credit Card",
            "acctSubTypeDesc": "Credit Card",
            "preferenceDetail": {
              "name": "Visa Signature Rewards",
              "isHidden": false,
              "isDefaultAcct": false,
              "acctGroupId": "CC"
            },
            "gainLossBalanceDetail": {
              "totalMarketVal": 141.3
            },
            "creditCardDetail": {
              "creditCardAcctNumber": "00007291638452917486",
              "memberId": "82749163524",
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
                "totalMarketVal": 3947.09,
                "todaysGainLoss": -105.72,
                "todaysGainLossPct": -2.75
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

#### Important Fields in Response

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

#### Account Categories (Groups)

- `IA`: Investment (Individual/Joint brokerage accounts)
- `RA`: Retirement (401k, HSA, IRA accounts)
- `PM`: Professionally Managed (IRA accounts)
- `SC`: Spend & Save (Cash Management, Savings)
- `CC`: Credit Cards
- `AA`: Authorized (Stock plans from employer)
- `SP`: Stock Plans
- `CG`: Charitable Giving
- Other groups: ID (Cryptocurrency), EA (Education), FV (Non-Fidelity), etc.

#### Notes

- Returns all account types (brokerage, retirement, credit cards, stock plans) in a single call
- Credit card accounts: `acctNum` shows last 4 digits; use `creditCardDetail.creditCardAcctNumber` for full account number
- Filter hidden accounts using `preferenceDetail.isHidden` flag
- For credit card APIs, use `creditCardDetail.creditCardAcctNumber` (not `acctNum`)

---

## Task 3: List Available Statements

### API Endpoint

```
POST https://digital.fidelity.com/ftgw/digital/documents/api/graphql
```

### HTTP Method

`POST`

### Required Headers

- `Content-Type: application/json`
- `Cookie`: [Session cookies]
- `Referer`: https://digital.fidelity.com/ftgw/digital/documents

### GraphQL Operation

`GetStatements`

### Request Parameters

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

### Request Body Example

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

### Parameters

- `docType`: Document type (e.g., "STMT" for statements)
- `startDate`: Start date filter (YYYY-MM-DD format)
- `endDate`: End date filter (YYYY-MM-DD format)

### Response Structure

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

### Important Fields

- `id`: Statement ID (used for downloading PDF)
- `type`: Document type (STMT, TAX, etc.)
- `acctNum`: Associated account number
- `periodStartDate`: Statement period start date
- `periodEndDate`: Statement period end date
- `generatedDate`: Date the statement was generated
- `isHouseholded`: Whether this is a household/consolidated statement
- `formatTypes.formatType`: Available formats (PDF, CSV)

### Notes

- Returns statements for all brokerage/investment/retirement accounts (not credit cards)
- Date range filters statements by period end date
- Consolidated statements covering multiple accounts have `isHouseholded: true`
- No account ID parameter - lists all statements for the authenticated user

---

### For Credit Card Accounts (Alternative API)

#### API Endpoint

```
POST https://digital.fidelity.com/ftgw/digital/credit-card/api/graphql
```

#### HTTP Method

`POST`

#### Required Headers

- `Content-Type: application/json`
- `Cookie`: [Session cookies]
- `apollographql-client-name: credit-card`
- `apollographql-client-version: 0.0.1`
- `Referer: https://digital.fidelity.com/ftgw/digital/portfolio/creditstatements`

#### GraphQL Operation

`GetStatementsList`

#### Request Parameters

**Query Variables:**

```json
{
  "accountId": "00007291638452917486",
  "dateRange": {
    "startDate": "2025-05-19",
    "endDate": "2025-11-19"
  }
}
```

**How to Choose Account ID:**

The `accountId` parameter must be the **full credit card account number**, obtained from:

1. **GetContext API** (Task 2) → `creditCardDetail.creditCardAcctNumber`

   - Example: `"creditCardAcctNumber": "00007291638452917486"`
   - This is the FULL account number, not the shortened `acctNum` (e.g., "3842")

2. **Do NOT use** the `acctNum` field from the credit card item in the GetContext response
   - `acctNum: "3842"` ← This is the LAST 4 digits only
   - `creditCardDetail.creditCardAcctNumber: "00007291638452917486"` ← Use this

#### Request Body Example

```json
{
  "operationName": "GetStatementsList",
  "variables": {
    "accountId": "00007291638452917486",
    "dateRange": {
      "startDate": "2025-05-19",
      "endDate": "2025-11-19"
    }
  },
  "query": "query GetStatementsList($accountId: String!, $dateRange: DateRange, $year: String) {\n  getStatementsList(accountId: $accountId, dateRange: $dateRange, year: $year) {\n    statements {\n      statementName\n      statementStartDate\n      statementEndDate\n      cardOffersAndNotices {\n        eInsertId\n        description\n      }\n    }\n    isPaperlessEnrolled\n  }\n}\n"
}
```

#### Response Structure

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

#### Important Fields

- `statementName`: Human-readable statement name with date range
- `statementStartDate`: Statement period start date (YYYY-MM-DD)
- `statementEndDate`: Statement period end date (YYYY-MM-DD)
- `cardOffersAndNotices`: Additional inserts (e.g., privacy notices)
  - `eInsertId`: Insert identifier
  - `description`: Insert description
- `isPaperlessEnrolled`: Paperless enrollment status

#### Source APIs

**Account ID Source**: `GetContext` API (Task 2) → `creditCardDetail.creditCardAcctNumber`

#### Notes

- Credit card specific API
- Requires full account number from `creditCardDetail.creditCardAcctNumber` (not `acctNum`)
- Date range is optional; omit to get all available statements

---

## Task 4: Download Statement PDF

### For Brokerage/Investment Accounts

#### API Endpoint

```
GET https://digital.fidelity.com/ftgw/digital/documents/PDFStatement/STMT/pdf/Statement{DATE}.pdf
```

#### HTTP Method

`GET`

#### URL Structure

```
https://digital.fidelity.com/ftgw/digital/documents/PDFStatement/{DOCTYPE}/pdf/{FILENAME}.pdf?id={ENCODED_ID}
```

**Example:**

```
https://digital.fidelity.com/ftgw/digital/documents/PDFStatement/STMT/pdf/Statement10312025.pdf?id=TjE4NS0yNy0xOUhGNzNWMDA5MjAwNTgxMDI3NCwyLEZDRiwzNzQ5
```

### URL Parameters

- `{DOCTYPE}`: Document type (e.g., "STMT")
- `{FILENAME}`: PDF filename (e.g., "Statement10312025.pdf")
- `id`: Base64-encoded statement identifier from `GetStatements` API

### Required Headers

- `Cookie`: [Session cookies]
- `Referer`: https://digital.fidelity.com/ftgw/digital/documents

### Response

- **Content-Type**: `application/pdf`
- **Content-Disposition**: `inline;filename="Statement10312025.pdf"`
- **Body**: Binary PDF content

### Parameter Sources

#### Statement ID (`id` query parameter)

**Source API**: `GetStatements` (see Task 3 above)

- The `id` field from the statement list response is used as the query parameter
- This ID is already Base64-encoded in the response

#### Filename

**Source**: Can be constructed from `periodEndDate` field in `GetStatements` response

- Format: `Statement{MMDDYYYY}.pdf`
- Example: For `periodEndDate: "2025-10-31"`, filename is `Statement10312025.pdf`

#### Document Type

**Source**: `type` field from `GetStatements` response

- Common values: "STMT", "TAX", "CONFIRM"

### Download Flow

1. Call `GetStatements` API to retrieve statement list
2. Extract `id` and `periodEndDate` from desired statement
3. Construct URL:
   - Use `id` as the `id` query parameter
   - Construct filename from `periodEndDate`
4. Make GET request with session cookies
5. Receive binary PDF response

### Example Statement ID Decoding

The `id` parameter appears to be Base64-encoded and contains:

- Statement date
- Account identifier
- Other metadata

**Example**: `TjE4NS0yNy0xOUhGNzNWMDA5MjAwNTgxMDI3NCwyLEZDRiwzNzQ5`

Decoded (approximate): `N185-27-19HF73V0092005810274,2,FCF,3749`

- Includes: Date, account reference, format code

#### Notes

- For brokerage/investment/retirement accounts only (not credit cards)
- Simple GET request with encoded statement ID from `GetStatements` API
- Account association is embedded in the encoded `id` parameter
- Consolidated multi-account statements use the same endpoint

---

### For Credit Card Accounts

#### API Endpoint

```
POST https://digital.fidelity.com/ftgw/digital/credit-card/api/graphql
```

#### HTTP Method

`POST`

#### Required Headers

- `Content-Type: application/json`
- `Cookie`: [Session cookies]
- `apollographql-client-name: credit-card`
- `apollographql-client-version: 0.0.1`
- `Referer: https://digital.fidelity.com/ftgw/digital/portfolio/creditstatements`

#### GraphQL Operation

`GetStatement`

#### Request Parameters

**Query Variables:**

```json
{
  "accountId": "00007291638452917486",
  "statementDate": "2025-11-18"
}
```

**Parameter Sources:**

- `accountId`: Full credit card account number from `GetContext` API → `creditCardDetail.creditCardAcctNumber`
- `statementDate`: Statement end date from `GetStatementsList` API → `statementEndDate` (YYYY-MM-DD format)

#### Request Body Example

```json
{
  "operationName": "GetStatement",
  "variables": {
    "accountId": "00007291638452917486",
    "statementDate": "2025-11-18"
  },
  "query": "query GetStatement($accountId: String!, $statementDate: String!) {\n  getStatement(accountId: $accountId, statementDate: $statementDate) {\n    statement {\n      statementDate\n      pageContent\n      __typename\n    }\n    __typename\n  }\n}\n"
}
```

#### Response Structure

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

#### Important Fields

- `statementDate`: Statement date (YYYY-MM-DD)
- `pageContent`: **Base64-encoded PDF content** - decode this to get the binary PDF

#### Download Flow

1. Call `GetContext` API to get credit card account number
2. Call `GetStatementsList` API to get available statements
3. Extract `statementEndDate` from desired statement
4. Call `GetStatement` GraphQL with:
   - `accountId`: Full credit card account number
   - `statementDate`: Statement end date
5. Decode `pageContent` from Base64 to binary PDF
6. Save as PDF file

#### Source APIs

- **Account ID**: `GetContext` API → `creditCardDetail.creditCardAcctNumber`
- **Statement Date**: `GetStatementsList` API → `statementEndDate`

#### Notes

- Credit card specific API
- Returns Base64-encoded PDF (different from brokerage direct download)
- Requires full account number from `creditCardDetail.creditCardAcctNumber`
- PDF is served directly by Fidelity's API (no external SSO)

---

## Authentication & Security

- **Cookie-based authentication** using FC, MC, RC, or SC session cookies
- All API endpoints use HTTPS
- Session cookies must be preserved across requests with `credentials: 'include'`
- Sessions expire after inactivity

---

## API Flow Summary

### For Brokerage/Investment/Retirement Accounts

1. **GetDeliveryPref** → Get email (profile)
2. **GetContext** → Get all accounts
3. **GetStatements** → List statements (no account ID needed)
4. **Direct PDF Download** → Download via URL with statement ID

### For Credit Card Accounts

1. **GetDeliveryPref** → Get email (profile)
2. **GetContext** → Get accounts and extract `creditCardDetail.creditCardAcctNumber`
3. **GetStatementsList** → List statements (requires full account number)
4. **GetStatement** → Download Base64-encoded PDF (requires account ID and statement date)

---

## File Information

**HAR File**: `analyze/fidelity_1763597495016.har`

- **Size**: 19.40 MB
- **Total Entries**: 535 Fidelity domain requests
- **Captured**: November 19, 2025, 4:22 PM

**Downloaded Statements:**

1. Credit Card Statement (November 2025) - Downloaded via `GetStatement` GraphQL API (Base64-encoded)
2. Brokerage Statement (October 31, 2025) - 91,540 bytes - Downloaded via direct PDF URL

**Coverage:**

- ✅ Portfolio summary API
- ✅ Credit card API (details, transactions, rewards)
- ✅ Document listing API
- ✅ PDF download API
- ✅ User state/preferences API

---

## Summary

Fidelity uses a GraphQL API architecture with separate endpoints for portfolio, credit cards, and documents. Authentication is cookie-based (FC, MC, RC, or SC cookies).

**Key Differences:**

- **Brokerage/Investment**: Direct PDF download via URL
- **Credit Cards**: GraphQL API with Base64-encoded PDF content
