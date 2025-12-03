# Citi Bank Statement API Analysis

## Overview

This document analyzes the Citi bank statement API endpoints and their usage for retrieving user profile information, listing accounts, accessing statements, and downloading statement PDFs.

## Base URL

All API endpoints use the following base URL:

```
https://online.citi.com/gcgapi/prod/public/v1
```

## Authentication

All API requests require authentication via cookies and headers:

### Required Cookies:

- `citi_authorization` - Base64 encoded authorization token
- `bcsid` - Session ID
- `client_id` - Client identifier
- `isLoggedIn=true` - Login state flag
- Additional session management cookies

### Required Headers:

- `appVersion`: `CBOL-ANG-2025-11-02`
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
    "firstName": "JOHN",
    "lastLoginTime": "Oct. 12, 2025 (2:33 AM ET)",
    "lastLoginDevice": "from mobile device."
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
        "productNameAndDisplayAccountNo": "Citi Strata℠ Card - 4682",
        "accountId": "b187961b-fcb6-5b94-cf38-714c9d8bcgd1",
        "imageUrl": "https://online.citi.com/cards/svc/img/svgImage/408_Moonstone_Updated.svg",
        "productId": "408"
      },
      "accountBalance": {
        "currentBalanceAmount": "0.0",
        "availableCreditAmount": "5000.0",
        "statementBalanceAmount": "0.0",
        "minimumPaymentAmount": "0.0",
        "paymentDueDate": "Nov 15, 2025",
        "nextStatementClosingDate": "Nov 19, 2025",
        "remainingStatementBalance": "0.0",
        "creditLimit": "5000.0",
        "prevStatementClosingDate": "Oct 17, 2025",
        "statementStartMonth": "Oct 17"
      },
      "accountLinkDetail": {
        "statementLink": {
          "linkUrl": "/US/ag/accstatement?accountInstanceId=b187961b-fcb6-5b94-cf38-714c9d8bcgd1"
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
      "accountId": "b187961b-fcb6-5b94-cf38-714c9d8bcgd1",
      "displayAccountNumber": "4682",
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
        "accountId": "b187961b-fcb6-5b94-cf38-714c9d8bcgd1",
        "accountNickname": "Citi Strata℠ Card - 4682",
        "imageUrl": "https://online.citi.com/cards/svc/img/svgImage/408_Moonstone_Updated.svg",
        "accountType": "CARDS",
        "paperlessEnrollmentFlag": true,
        "paperlessEligibleFlag": true,
        "productDesc": "Citi Strata℠ Card"
      }
    ]
  },
  "isCardsHostSystemDownFlag": false
}
```

**Response Fields:**

- `userType` - Type of user (e.g., "CARDS")
- `eligibleAccounts.cardAccounts[]` - Array of eligible card accounts
- `eligibleAccounts.cardAccounts[].accountId` - Account identifier (same as from dashboardTiles API)
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
  "accountId": "b187961b-fcb6-5b94-cf38-714c9d8bcgd1"
}
```

**Request Parameters:**

- `accountId` - The account ID from the eligible accounts API (note: uses `accountId`, not `accountInstanceId`)

**Response Structure:**

```json
{
  "statementsByYear": [
    {
      "displayYearTitle": "2025",
      "annualAccountSummaryEligibleFlag": true,
      "annualAccountSummaryUrlDetails": {
        "documentUrl": "/US/ag/spendsummary?accountId=",
        "documentUrlLabel": "2024 Annual Account Summary"
      },
      "statementsByMonth": [
        {
          "displayDate": "July 17",
          "statementDate": "07/17/2025"
        },
        {
          "displayDate": "June 18",
          "statementDate": "06/18/2025"
        },
        {
          "displayDate": "May 19",
          "statementDate": "05/19/2025"
        }
      ]
    },
    {
      "displayYearTitle": "2024",
      "annualAccountSummaryEligibleFlag": false,
      "statementsByMonth": [
        {
          "displayDate": "December 18",
          "statementDate": "12/18/2024"
        },
        {
          "displayDate": "November 19",
          "statementDate": "11/19/2024"
        }
      ]
    }
  ],
  "archivedStatementDetails": {
    "archivedStatementsByMonth": [],
    "archivedStatementRequestStartDate": "11/17/2025"
  },
  "accountOpenDate": "01/03/2022",
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
  "accountId": "b187961b-fcb6-5b94-cf38-714c9d8bcgd1",
  "statementDate": "07/17/2025",
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
