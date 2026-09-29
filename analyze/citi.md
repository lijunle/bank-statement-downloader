# Citi Bank Statement API Analysis

**Analysis as of:** 2026-09-29

## Overview

This document analyzes the Citi bank statement API endpoints and their usage for retrieving user profile information, listing accounts, accessing statements, and downloading statement PDFs.

Payload examples use synthetic identifiers, names, dates, balances, and account
numbers. They preserve field types and relationships, not captured customer values.

## Current scope and evidence

The authenticated credit-card dashboard issued the documented welcome-message
and account-balances GET requests, both with HTTP 200. The scoped session has one
credit card; no bank, loan, brokerage, or retirement accounts appear in the
statement-eligible response. These other product flows remain unverified.

Opening **View Statements** issued the existing eligible-accounts POST with
`transactionCode: "1079_statements"`, followed by the existing card statement-list
POST with the selected `accountId`. Both returned HTTP 200. The list contained
fourteen monthly statement entries across three year groups. Its newest returned
statement is not the dashboard's latest closing date: do not infer that every
month must have an available PDF.

The bank automatically requested the newest listed statement using the existing
`recent/retrieve` POST with `accountId`, its exact `MM/DD/YYYY` `statementDate`,
and `requestType: "RECENT STATEMENTS"`. That response was HTTP 200 with
`Content-Type: application/pdf`. **View All Statements** opened a yearly-filtered
list matching the available dates. Its Download button saved a four-page PDF
that parsed and rendered without repair or warnings. The selected card mask
and closing date matched the document; the PDF writes the date as `MM/DD/YY`.
This establishes the bank-side source document, not extension download acceptance.

The current eligible response has `bankHostSystemDownFlag`,
`cardsHostSystemDownFlag`, and `isCardsHostSystemDownFlag` in addition to the
account arrays. A service-outage response must not be reported as a genuine empty
account list.

The existing profile, eligible-account, card-statement-list, and recent-PDF
routes remain applicable to the observed credit-card flow; no endpoint migration
is indicated by the current bank-UI evidence.

## Shared contract mapping and validation

- Keep the existing readable `bcsid` session/profile identity and welcome name.
  Cross-user switching and authentication lifecycle are not established here.
- Use eligible-account IDs as opaque selectors, not account numbers. For the
  observed card, the nickname's trailing digits agree with the dashboard's
  `displayAccountNumber`; expose the last four digits as the mask, including when
  a nickname displays five trailing digits. Citi has no five-digit exception in
  the shared contract. A missing display mask must not silently fall back to an
  opaque ID suffix.
- Retain `statementDate` exactly as the download identifier (`MM/DD/YYYY`), while
  converting the calendar date to UTC midnight for the shared statement date.
  Reject malformed and impossible dates before listing or downloading.
- All supported account groups (`cardAccounts`, `bankAccounts`, `loanAccounts`)
  must be explicit arrays; missing groups are not equivalent to empty arrays.
  Recognized host-down flags are optional, but each present flag must be boolean:
  `true` reports unavailability, while other types are malformed responses.
  Explicit empty account/month arrays remain valid. Malformed account entries or
  missing/invalid year/month groups are errors, not empty or partial success.
  The PDF must have the expected MIME type and `%PDF-` prefix; these guards do not
  replace full document acceptance checks.
- Archived-statement requests, annual summaries, and non-card download routes are
  outside the observed scope. The existing bank/loan account mappings remain
  compatibility paths, not proof that their card-route downloads work.

## Base URL

All API endpoints use the following base URL:

```
https://online.citi.com/gcgapi/prod/public/v1
```

## Authentication

The exercised bank requests include cookies and application headers. The names
below describe observed/historical context, not a proven minimal requirement set:

### Cookie context:

- `citi_authorization` - Base64 encoded authorization token
- `bcsid` - Session ID
- `client_id` - Client identifier
- `isLoggedIn=true` - Login state flag
- Additional session management cookies

### Observed application headers:

- `appVersion`: Application build value; do not treat a historical version as permanent
- `businessCode`: `GCB`
- `channelId`: `CBOL`
- `client_id`: Client UUID
- `countryCode`: `US`
- `accept`: `application/json`
- `content-type`: `application/json`

## API Endpoints

### 1. User Welcome Message (Profile Name)

**Endpoint:** `GET /digital/customers/globalSiteMessages/welcomeMessage`

**Method:** GET

**Headers:** Same as above

**Response:**

```json
{
  "welcomeData": {
    "firstName": "TEST",
    "lastLoginTime": "Jan. 01, 2000 (12:00 AM ET)",
    "lastLoginDevice": "<login-device-description>"
  },
  "displayTutorialFlag": false
}
```

**Response Fields:**

- `welcomeData.firstName` - User's first name
- `welcomeData.lastLoginTime` - Last login timestamp with timezone
- `welcomeData.lastLoginDevice` - Last login device description
- `displayTutorialFlag` - Whether to display tutorial

---

### 2. Account Details and Balances

**Endpoint:** `GET /cbol/accounts/details/balances?isRedesignPage=true`

**Method:** GET

**Response:**

```json
{
  "accountLedgerData": [
    {
      "accountMetaData": {
        "productNameAndDisplayAccountNo": "Synthetic Citi Card - 1234",
        "accountId": "<account-id>",
        "imageUrl": "https://online.citi.com/cards/svc/img/svgImage/408_Moonstone_Updated.svg",
        "productId": "408"
      },
      "accountBalance": {
        "currentBalanceAmount": "0.0",
        "availableCreditAmount": "1000.0",
        "statementBalanceAmount": "0.0",
        "minimumPaymentAmount": "0.0",
        "paymentDueDate": "Apr 15, 2000",
        "nextStatementClosingDate": "Mar 31, 2000",
        "remainingStatementBalance": "0.0",
        "creditLimit": "1000.0",
        "prevStatementClosingDate": "Feb 29, 2000",
        "statementStartMonth": "Feb 29"
      },
      "accountLinkDetail": {
        "statementLink": {
          "linkUrl": "/US/ag/accstatement?accountInstanceId=<account-id>"
        }
      },
      "balanceBreakdownData": {
        "lastStatementBalance": {
          "amount": "0.0"
        },
        "recentTransactions": {
          "amount": "0.00"
        },
        "cashAdvances": {
          "amount": "0.0"
        },
        "paymentsAndCredits": {
          "amount": "0.0"
        },
        "currentBalanceTotal": "0.0"
      },
      "accountId": "<account-id>",
      "displayAccountNumber": "1234",
      "statementsAvailableFlag": true,
      "accountStatusCode": "00",
      "accountType": "IBS_PRIMARY"
    }
  ]
}
```

**Response Fields:**

- `accountLedgerData[]` - Array of account objects with full details
- `accountLedgerData[].accountMetaData.accountId` - Unique account identifier (use this for statement APIs)
- `accountLedgerData[].accountMetaData.productNameAndDisplayAccountNo` - Full account name with last 4 digits
- `accountLedgerData[].accountMetaData.productId` - Product code
- `accountLedgerData[].accountBalance.currentBalanceAmount` - Current balance
- `accountLedgerData[].accountBalance.availableCreditAmount` - Available credit
- `accountLedgerData[].accountBalance.creditLimit` - Total credit limit
- `accountLedgerData[].accountBalance.paymentDueDate` - Next payment due date
- `accountLedgerData[].accountBalance.nextStatementClosingDate` - Next statement closing date
- `accountLedgerData[].accountLinkDetail.statementLink.linkUrl` - Direct link to statements page
- `accountLedgerData[].statementsAvailableFlag` - Whether statements are available
- `accountLedgerData[].displayAccountNumber` - Last 4 digits of account number
- `accountLedgerData[].accountType` - Account type indicator

---

### 3. List Eligible Accounts for Statements

**Endpoint:** `POST /v2/digital/accounts/statementsAndLetters/eligibleAccounts/retrieve`

**Method:** POST

**Headers:** Same as above

**Request Body:**

```json
{
  "transactionCode": "1079_statements"
}
```

**Request Parameters:**

- `transactionCode` - Hardcoded value `"1079_statements"` to retrieve statement-eligible accounts

**Response Structure:**

```json
{
  "userType": "CARDS",
  "fullName": "",
  "showInvestmentLink": false,
  "showInvestmentsCIFSLink": false,
  "showMortgageLink": false,
  "showCustomerLevelLettersFlag": false,
  "eligibleAccounts": {
    "bankAccounts": [],
    "loanAccounts": [],
    "brokerageAccounts": [],
    "retirementAccounts": [],
    "cardAccounts": [
      {
        "accountId": "<account-id>",
        "accountNickname": "Synthetic Citi Card - 1234",
        "imageUrl": "https://online.citi.com/cards/svc/img/svgImage/408_Moonstone_Updated.svg",
        "accountType": "CARDS",
        "paperlessEnrollmentFlag": true,
        "paperlessEligibleFlag": true,
        "productDesc": "Synthetic Citi Card"
      }
    ]
  },
  "isCardsHostSystemDownFlag": false
}
```

**Response Fields:**

- `userType` - Type of user (e.g., "CARDS")
- `eligibleAccounts.cardAccounts[]` - Array of eligible card accounts
- `eligibleAccounts.cardAccounts[].accountId` - Account identifier (matches the scoped dashboard balances response)
- `eligibleAccounts.cardAccounts[].accountNickname` - Display name for the account
- `eligibleAccounts.cardAccounts[].accountType` - Account type (e.g., "CARDS")
- `eligibleAccounts.cardAccounts[].paperlessEnrollmentFlag` - Whether enrolled in paperless statements
- `eligibleAccounts.cardAccounts[].paperlessEligibleFlag` - Whether eligible for paperless statements
- `eligibleAccounts.bankAccounts[]` - Array of eligible bank accounts (empty if none)
- `eligibleAccounts.loanAccounts[]` - Array of eligible loan accounts (empty if none)

**Note:** The `transactionCode` value `"1079_statements"` is a hardcoded constant required by this API. This endpoint filters accounts to only show those eligible for statement retrieval.

---

### 4. Get Account Statements List

**Endpoint:** `POST /v2/digital/card/accounts/statements/accountsAndStatements/retrieve`

**Method:** POST

**Headers:** Same as above

**Request Body:**

```json
{
  "accountId": "<account-id>"
}
```

**Request Parameters:**

- `accountId` - The account ID from the eligible accounts API (note: uses `accountId`, not `accountInstanceId`)

**Response Structure:**

```json
{
  "statementsByYear": [
    {
      "displayYearTitle": "2000",
      "annualAccountSummaryEligibleFlag": true,
      "annualAccountSummaryUrlDetails": {
        "documentUrl": "/US/ag/spendsummary?accountId=",
        "documentUrlLabel": "1999 Annual Account Summary"
      },
      "statementsByMonth": [
        {
          "displayDate": "March 31",
          "statementDate": "03/31/2000"
        },
        {
          "displayDate": "February 29",
          "statementDate": "02/29/2000"
        },
        {
          "displayDate": "January 31",
          "statementDate": "01/31/2000"
        }
      ]
    },
    {
      "displayYearTitle": "1999",
      "annualAccountSummaryEligibleFlag": false,
      "statementsByMonth": [
        {
          "displayDate": "December 31",
          "statementDate": "12/31/1999"
        },
        {
          "displayDate": "November 30",
          "statementDate": "11/30/1999"
        }
      ]
    }
  ],
  "archivedStatementDetails": {
    "archivedStatementsByMonth": [],
    "archivedStatementRequestStartDate": "01/01/2000"
  },
  "accountOpenDate": "01/01/1999",
  "archivedStatementsEligibleFlag": true,
  "estatementEnrollmentFlag": true,
  "accountSubtype": ""
}
```

**Response Fields:**

- `statementsByYear[]` - Array of statement years
- `statementsByYear[].displayYearTitle` - Year (e.g., "2025")
- `statementsByYear[].annualAccountSummaryEligibleFlag` - Whether annual summary is available
- `statementsByYear[].statementsByMonth[]` - Array of monthly statements
- `statementsByYear[].statementsByMonth[].displayDate` - Display format (e.g., "July 17")
- `statementsByYear[].statementsByMonth[].statementDate` - Date in MM/DD/YYYY format (e.g., "07/17/2025")
- `accountOpenDate` - Date when account was opened
- `estatementEnrollmentFlag` - Whether enrolled in e-statements
- `archivedStatementsEligibleFlag` - Whether archived statements can be requested

**Note:** This API returns a list of available statement dates grouped by year. To download a specific statement, use the download API with the `statementDate` value.

---

### 5. Download Statement PDF

**Endpoint:** `POST /v2/digital/card/accounts/statements/recent/retrieve`

**Method:** POST

**Headers:** Same as above

**Request Body:**

```json
{
  "accountId": "<account-id>",
  "statementDate": "03/31/2000",
  "requestType": "RECENT STATEMENTS"
}
```

**Request Parameters:**

- `accountId` - The account ID
- `statementDate` - Statement date in MM/DD/YYYY format (from the statements list API)
- `requestType` - Fixed value: `"RECENT STATEMENTS"`

**Response:** Binary PDF file (Content-Type: application/pdf)

**Response Headers:**

- `content-type`: `application/pdf`
- `content-disposition`: `attachment; filename=name`
- `content-length`: Size in bytes

**Note:** The URL `https://online.citi.com/US/nga/accstatement?accountInstanceId={accountInstanceId}` returns an HTML page for viewing statements in the browser, not the PDF file directly. To download the PDF, use this POST API instead.

---

## API Call Flow

1. **Get Welcome Message** (Optional) - Retrieve user's name and last login info from `/digital/customers/globalSiteMessages/welcomeMessage` (Section 1)
2. **List Eligible Accounts** - POST to `/v2/digital/accounts/statementsAndLetters/eligibleAccounts/retrieve` with `transactionCode: "1079_statements"` (Section 3)
   - Extract `accountId` for each eligible account from `eligibleAccounts.cardAccounts[]`
3. **For Each Account:**
   - **Get Statements List** - POST to `/v2/digital/card/accounts/statements/accountsAndStatements/retrieve` (Section 4)
   - **Download PDF** - POST to `/v2/digital/card/accounts/statements/recent/retrieve` with the statement date (Section 5)

---

## Implementation Notes

1. **Session Management:** All APIs require valid authenticated session with cookies
2. **Account ID:** Use `accountId` from eligible accounts API for all statement-related requests
3. **Date Format:** Statement dates use `MM/DD/YYYY` format (e.g., "07/17/2025")
4. **PDF Download:** Use POST request to `/v2/digital/card/accounts/statements/recent/retrieve` endpoint
5. **Error Handling:** API returns standard HTTP status codes; 401/403 indicate authentication issues

---

## Security Considerations

- All requests must be made over HTTPS
- Authorization tokens and session cookies are required for authentication
- PDF downloads contain sensitive financial information
