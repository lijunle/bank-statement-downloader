# TD Bank Canada API Analysis

**Bank ID:** td_bank  
**Bank Name:** TD Bank Canada  
**Bank URL:** https://www.td.com / https://easyweb.td.com  
**Analysis Date:** November 20, 2025  
**Last Updated:** November 24, 2025

## Session ID

TD Bank uses **two separate session systems**:

### 1. /ms/ Endpoints (Account List, User Profile)

- **JSESSIONID**: HttpOnly cookie set during login (not accessible via JavaScript)
- **HD4bjx6N**: Accessible via JavaScript, can be used as session identifier

### 2. /waw/api/ Endpoints (Statements)

- **JESSIONID**: HttpOnly cookie with `Path=/waw/api`
- Must be initialized via SSO flow before accessing statement APIs

### E-Statement SSO Flow

Before calling any `/waw/api/` endpoints, the session must be initialized:

**Step 1: Call EStatementAccountRepositoryServlet**

```
GET https://easyweb.td.com/waw/ezw/servlet/com.td.estatement.servlet.EStatementAccountRepositoryServlet
```

This sets two HttpOnly cookies at `Path=/waw/api/ssologin`:

- `ssoTicketId`: SSO ticket identifier
- `oauthToken`: OAuth token for authentication

**Step 2: Call SSO Login**

```
POST https://easyweb.td.com/waw/api/ssologin
```

**Headers:**

- `Content-Type`: `application/x-www-form-urlencoded`
- `Referer`: `https://easyweb.td.com/waw/ezw/servlet/com.td.estatement.servlet.EStatementAccountRepositoryServlet`
- `sec-fetch-dest`: `document`
- `sec-fetch-mode`: `navigate`

**Request Body:**

```
applicationUrl=https://easyweb.td.com/waw/ezw/
goto=EZW_OCA
channelID=EasyWeb
language=en
applicationId=EZW:PRODBDC
```

This sets the **JESSIONID** cookie at `Path=/waw/api` which is required for all `/waw/api/` endpoints.

**Note:** The browser automatically sends `ssoTicketId` and `oauthToken` cookies with the SSO login request because they have matching path `/waw/api/ssologin`.

## Retrieve User Profile Information

**API Endpoint:**

```
GET https://easyweb.td.com/ms/mpref/v1/preferences/displayname
```

**HTTP Method:** GET

**HTTP Headers:**

- `Accept`: `application/json`
- `Accept-Language`: `en_CA`
- `Content-Type`: `application/json`
- `Referer`: `https://easyweb.td.com/ui/ew/fs?fsType=PFS&kyc=Y`
- `messageid`: UUID
- `originating-app-name`: `RWUI-unav-ew`
- `originating-app-version-num`: `25.9.1`
- `originating-channel-name`: `EWP`
- `timestamp`: ISO 8601 timestamp
- `traceabilityid`: UUID

**Request Parameters:** None

**Response Structure:**

```json
{
  "displayName": "USER NAME",
  "initials": "UN",
  "firstName": "USER"
}
```

**Important Fields:**

- `displayName`: Full name of the user
- `firstName`: User's first name
- `initials`: User's initials

## List All Accounts

**API Endpoint:**

```
GET https://easyweb.td.com/ms/uainq/v1/accounts/list
```

**HTTP Method:** GET

**HTTP Headers:**

- `Accept`: `application/json`
- `Accept-Language`: `en_CA`
- `Content-Type`: `application/json`
- `Referer`: `https://easyweb.td.com/ui/ew/fs?fsType=PFS&kyc=Y`
- `accept-secondary-language`: `fr_CA`
- `messageid`: UUID
- `originating-app-name`: `RWUI-uu-accounts`
- `originating-app-version-num`: `25.7.1`
- `originating-channel-name`: `EWP`
- `timestamp`: ISO 8601 timestamp
- `traceabilityid`: UUID

**Request Parameters:** None

**Response Structure:**

```json
{
  "accountList": [
    {
      "accountKey": "-2545236068",
      "accountNumber": "7162735",
      "accountDisplayName": "TD ALL-INCLUSIVE BANKING PLAN",
      "accountType": "PDA",
      "productCd": "MBA",
      "accountName": "TD ALL-INCLUSIVE BANKING PLAN"
    },
    {
      "accountKey": "-2978008644",
      "accountNumber": "7820342",
      "accountDisplayName": "TD EPREMIUM SAVINGS ACCOUNT",
      "accountType": "PDA",
      "productCd": "IBA",
      "accountName": "TD EPREMIUM SAVINGS ACCOUNT"
    },
    {
      "accountKey": "-2120696691",
      "accountNumber": "563196******1475",
      "accountDisplayName": "TD CASH BACK VISA INFINITE* CARD",
      "accountType": "VSA",
      "productCd": "I CASHBACK",
      "accountName": "TD CASH BACK VISA INFINITE* CARD"
    }
  ]
}
```

**Important Fields:**

- `accountKey`: Unique identifier for the account (used in statement APIs)
- `accountNumber`: Account number (masked for credit cards)
- `accountDisplayName`: Display name of the account
- `accountType`: Type of account
  - `PDA`: Personal Deposit Account (checking, savings)
  - `VSA`: Visa Account (credit cards)
- `productCd`: Product code
  - `MBA`: Main Banking Account (checking)
  - `IBA`: Interest-Bearing Account (savings)

## List Available Statements

**Prerequisite:** SSO flow must be completed (see Session ID section above)

**API Endpoint:**

```
GET https://easyweb.td.com/waw/api/edelivery/estmt/documentlist
```

**HTTP Method:** GET

**HTTP Headers:**

- `Accept`: `application/json, text/plain, */*`
- `Referer`: `https://easyweb.td.com/waw/webui/acct/`

**Request Parameters:**

- `accountKey`: Account key from the accounts list API (e.g., `-2545236068`)
- `period`: Time period filter (e.g., `Last_12_Months`)
- `documentType`: Document type filter (`ESTMT` for statements)

**Example Request:**

```
GET https://easyweb.td.com/waw/api/edelivery/estmt/documentlist?accountKey=-2545236068&period=Last_12_Months&documentType=ESTMT
```

**Response Structure:**

```json
{
  "status": {
    "statusCode": "200",
    "severity": "SUCCESS"
  },
  "documentList": [
    {
      "documentId": "N1GHF82E5CD7G7BEBC...",
      "name": "TD_ALL-INCLUSIVE_BANKING_PLAN_0209-7162735_Sep_29-Oct_31_2025",
      "documentDate": "2025/10/31",
      "startDate": "2025/09/29",
      "endDate": "2025/10/31"
    }
  ]
}
```

**Important Fields:**

- `documentId`: Unique identifier for the statement (used to download PDF)
- `name`: Statement file name
- `documentDate`: Statement date
- `startDate`/`endDate`: Statement period

**Note:** Same API works for all account types (checking, savings, credit cards).

## Download Statement PDF

**Prerequisite:** SSO flow must be completed (see Session ID section above)

**API Endpoint:**

```
GET https://easyweb.td.com/waw/api/edelivery/estmt/documentdetail
```

**HTTP Method:** GET

**HTTP Headers:**

- `Accept`: `application/json, text/plain, */*`
- `Referer`: `https://easyweb.td.com/waw/webui/acct/`

**Request Parameters:**

- `documentKey`: The `documentId` from the statement list API

**Example Request:**

```
GET https://easyweb.td.com/waw/api/edelivery/estmt/documentdetail?documentKey=N1GHF82E5CD7G7BEBC...
```

**Response Structure:**

```json
{
  "status": {
    "statusCode": "200",
    "severity": "SUCCESS"
  },
  "document": {
    "content": "<base64-encoded-pdf-content>",
    "documentId": "N1GHF82E5CD7G7BEBC...",
    "mimeType": "application/pdf"
  }
}
```

**Important Fields:**

- `document.content`: Base64-encoded PDF content
- `document.mimeType`: MIME type (always "application/pdf")

## API Call Flow

1. **User Login** → Session established with `JSESSIONID` and `HD4bjx6N` cookies
2. **Retrieve User Profile** → GET `/ms/mpref/v1/preferences/displayname`
3. **List All Accounts** → GET `/ms/uainq/v1/accounts/list`
4. **For Each Account (on first /waw/api/ call or 403):**
   - **Initialize SSO** → GET `/waw/ezw/servlet/com.td.estatement.servlet.EStatementAccountRepositoryServlet`
   - **SSO Login** → POST `/waw/api/ssologin`
   - **List Statements** → GET `/waw/api/edelivery/estmt/documentlist?accountKey={accountKey}&period=Last_12_Months&documentType=ESTMT`
   - **For Each Statement:**
     - **Download PDF** → GET `/waw/api/edelivery/estmt/documentdetail?documentKey={documentId}`

## Notes

- `/ms/` endpoints use `JSESSIONID` cookie (set during login)
- `/waw/api/` endpoints use `JESSIONID` cookie (set via SSO flow)
- The SSO flow must be triggered if `/waw/api/` returns 403
- The `accountKey` is a negative integer that uniquely identifies each account
- The `documentId` is a long base64-encoded string
- All account types (checking, savings, credit cards) use the same statement APIs
