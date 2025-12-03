# MBNA Canada API Analysis

**Bank ID:** mbna_ca  
**Bank Name:** MBNA Canada  
**Bank URL:** https://www.mbna.ca  
**Analysis Date:** November 20, 2025

## Overview

MBNA Canada uses a cookie-based authentication system with multiple session cookies. The main application is hosted at `https://service.mbna.ca/waw/mbna/` and provides RESTful JSON APIs for account management.

## Session Management

### Session Cookies

The following cookies are used to maintain the authenticated session:

- **JSESSIONID**: Primary session identifier

  - Example: `0000tv4WGT2Le7hw2FHWMZLE8BF:2cn1ju5hk`
  - HttpOnly: Yes (NOT accessible via JavaScript)
  - Secure: Yes
  - Critical for all authenticated requests
  - Automatically sent by browser with credentials: 'include'

- **AUTHSTATE**: Authentication state token

  - Example: `qN1lrpo8YwI6xpQ/niPa51cyNi5P26knRr8gQ88d6hF=`
  - HttpOnly: Yes (NOT accessible via JavaScript)
  - Required for API authentication
  - Automatically sent by browser with credentials: 'include'

- **com.td.last_login**: Last login timestamp (USED AS SESSION ID)

  - Example: `1849273651824`
  - HttpOnly: No (accessible via JavaScript)
  - Used as the session identifier in getSessionId()
  - Represents Unix timestamp of last login

- **TD-persist**: Persistence indicator

  - Value: `SOC`
  - HttpOnly: No (accessible via JavaScript)
  - Set during OAuth authorization flow
  - Fallback session identifier

- **uap_locale**: User application locale

  - Values: `en_CA` or `fr_CA`
  - HttpOnly: No (accessible via JavaScript)
  - Secondary fallback session identifier

- **PF**: PingFederate session token

  - HttpOnly: Yes
  - Secure: Yes
  - SameSite: None

- **forceLanguage**: User's language preference
  - Values: `en` or `fr`

### Session Identifier Strategy

Critical session cookies (JSESSIONID, AUTHSTATE, PF) are HttpOnly and not accessible via JavaScript. The implementation uses the **`com.td.last_login`** cookie value (Unix timestamp) as the session identifier. All API requests use `credentials: 'include'` in fetch() to automatically send HttpOnly cookies.

**Implementation:**

```javascript
function getSessionId() {
  const cookies = document.cookie.split("; ");
  for (const cookie of cookies) {
    const [name, value] = cookie.split("=");
    if (name === "com.td.last_login" && value) {
      return value; // e.g., "1849273651824"
    }
  }
  throw new Error("Session cookie not found. Please log in first.");
}
```

## API Endpoints

### 1. Retrieve User Profile Information

**Endpoint:** `GET https://service.mbna.ca/waw/mbna/customer-profile`

**HTTP Method:** GET

**Required Headers:**

- `Accept: application/json, text/plain, */*`

**Authentication:** Uses `credentials: 'include'` to automatically send HttpOnly cookies (JSESSIONID, AUTHSTATE)

**Request Parameters:** None

**Response Structure:**

```json
{
  "customerName": {
    "firstname": "JOHN",
    "lastname": "DOE"
  }
}
```

**Response Fields:**

- `customerName.firstname`: User's first name
- `customerName.lastname`: User's last name

---

### 2. List All Accounts

**Endpoint:** `GET https://service.mbna.ca/waw/mbna/accounts/summary`

**HTTP Method:** GET

**Required Headers:**

- `Accept: application/json, text/plain, */*`

**Authentication:** Uses `credentials: 'include'` to automatically send HttpOnly cookies (JSESSIONID, AUTHSTATE)

**Request Parameters:** None

**Response Structure:**

```json
[
  {
    "cardName": "MBNA Rewards World Elite® Mastercard®",
    "accountId": "00381729465",
    "endingIn": "7483",
    "allowedAccountSummary": true,
    "cardNameShort": "MBNA Rewards World Elite®",
    "eligibleForPaperlessOffer": false,
    "enrolledForPaperlessStatements": true,
    "pchName": "JOHN DOE",
    "accountCurrentSetting": "ONLINE",
    "accountEmail": "JOHN.DOE@EXAMPLE.COM",
    "allowedStandardEForms": true,
    "primaryCardHolder": true
  }
]
```

**Important Response Fields:**

- `[].accountId`: Account identifier
- `[].endingIn`: Last 4 digits
- `[].cardName`: Card product name
- `[].pchName`: Primary cardholder name
- `[].accountEmail`: Contact email

---

### 3. List Available Statements

**Endpoint:** `GET https://service.mbna.ca/waw/mbna/accounts/{accountId}/statement-history/{year}`

**HTTP Method:** GET

**Required Headers:**

- `Accept: application/json, text/plain, */*`

**Authentication:** Uses `credentials: 'include'` to automatically send HttpOnly cookies (JSESSIONID, AUTHSTATE)

\*\*Path Parameters:

- `accountId`: Account identifier (e.g., `00381729465`)
- `year`: Statement year (e.g., `2025`)

**Request Parameters:** None

**Response Structure:**

```json
{
  "errorCode": "",
  "dmsAvailable": true,
  "StatementItem": [
    {
      "closingDate": "Nov 17, 2025 12:00:00 AM",
      "closingDateFmted": "2025-11-17",
      "documentId": "72BF5E8D4137CE9F...",
      "description": " ",
      "statementFileName": "eStmt_2025-11-17.PDF",
      "dmsAvailable": false
    },
    {
      "closingDate": "Oct 17, 2025 12:00:00 AM",
      "closingDateFmted": "2025-10-17",
      "documentId": "58C934D0E579F387...",
      "description": " ",
      "statementFileName": "eStmt_2025-10-17.PDF",
      "dmsAvailable": false
    }
  ]
}
```

**Important Response Fields:**

- `StatementItem[].closingDateFmted`: Statement closing date in YYYY-MM-DD format
- `StatementItem[].documentId`: Encrypted document identifier (not used in download)
- `StatementItem[].statementFileName`: Statement filename

---

### 4. Download Statement PDF

**Endpoint:** `GET https://service.mbna.ca/waw/mbna/accounts/{accountId}/statement-history/open-save/selected-date/{closingDate}`

**HTTP Method:** GET

**Required Headers:**

- `Accept: application/pdf, */*`

**Authentication:** Uses `credentials: 'include'` to automatically send HttpOnly cookies (JSESSIONID, AUTHSTATE)

\*\*Path Parameters:

- `accountId`: Account identifier (e.g., `00242411733`)
- `closingDate`: Statement closing date in YYYY-MM-DD format (e.g., `2025-11-17`)

**Query Parameters:**

- `format`: File format, always `PDF`
- `contentDisposition`: Always `attachment` (forces download)
- `folder`: Empty string
- `insertDocId`: Empty string

**Sample URL:**

```
https://service.mbna.ca/waw/mbna/accounts/00381729465/statement-history/open-save/selected-date/2025-11-17?format=PDF&contentDisposition=attachment&folder=&insertDocId=
```

**Response:**

- Content-Type: `application/pdf`
- Binary PDF file content

---

## API Dependencies

### Account-Specific APIs

All account-specific APIs require the `accountId` parameter, which is obtained from:

**Source API:** `GET /waw/mbna/accounts/summary`

**Flow:**

1. Call `/customer-profile` to get user information
2. Call `/accounts/summary` to get list of accounts and their IDs
3. Use the `accountId` from step 2 to call:
   - `/accounts/{accountId}/statement-history/{year}` - for statement list
   - `/accounts/{accountId}/statement-history/open-save/selected-date/{date}` - for statement download

### Statement Download Flow

**Complete flow to download a statement:**

1. **Get account list:**

   ```
   GET /waw/mbna/accounts/summary
   → Extract accountId
   ```

2. **Get statements for a year:**

   ```
   GET /waw/mbna/accounts/{accountId}/statement-history/{year}
   → Extract closingDateFmted
   ```

3. **Download statement PDF:**
   ```
   GET /waw/mbna/accounts/{accountId}/statement-history/open-save/selected-date/{closingDateFmted}?format=PDF&contentDisposition=attachment&folder=&insertDocId=
   → Receive PDF file
   ```
