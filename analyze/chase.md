# Chase Bank Statement API Analysis

## Overview

This document analyzes the Chase bank APIs used to retrieve user profile information, list accounts, retrieve statements, and download statement PDFs.

## Base URLs

- **Secure API**: `https://secure.chase.com/svc/`
- **Static Content**: `https://static.chase.com/content/`
- **Analytics**: `https://analytics.chase.com/events/`

## API Authentication

All APIs require authentication via session cookies. Key authentication headers include:

- `Cookie`: Contains multiple session tokens including:
  - `AMSESSION`: JWT-based session token
  - `auth-guid`: Authentication GUID
  - `auth-sigguid`: Signature GUID
  - `auth-user-info`: User information token
  - `PC_1_0`: Profile and customer information
  - Various other tracking and session cookies

## 1. User Profile & Account Listing

### API: Get Application Data (User Profile & Metadata)

**Endpoint**: `POST /svc/rl/accounts/l4/v1/app/data/list`

**HTTP Method**: POST

**Purpose**: Retrieves comprehensive user profile information, metadata, and greeting name. This is the primary API called on dashboard load that contains user identity, profile settings, and account summary.

**Request Headers**:

- `Content-Type: application/json`
- `Cookie`: Session authentication cookies

**Request Body**:

```json
{}
```

**Response Structure** (key sections):

```json
{
  "code": "SUCCESS",
  "cache": [
    {
      "url": "/svc/rl/accounts/secure/v1/deck/greeting/list",
      "usage": "SESSION",
      "response": {
        "greetingId": "TIME_OF_DAY",
        "greetingName": "JOHN"
      }
    },
    {
      "url": "/svc/rr/accounts/secure/v4/dashboard/tiles/list",
      "usage": "ONCE",
      "response": {
        "code": "SUCCESS",
        "defaultAccountId": 894082738,
        "personalTileGroups": [
          {
            "customerTileGroupId": "331815912",
            "creditCardAccountTileIds": [-025462372, 1238293696, ...],
            "loanAccountTileIds": [-1690625348, -2029112462, 474249683],
            "creditScoreTileId": 2016057738,
            "creditJourneyTileId": 1551611085
          }
        ],
        "accountTiles": [
          {
            "tileId": -025482572,
            "accountId": 894284738,
            "accountOriginationCode": "6613",
            "accountTileType": "CARD",
            "cardType": "FREEDOM_PLATINUM",
            "accountTileDetailType": "BAC",
            "rewardProgramCode": "0404",
            "rewardsTypeId": "VP-6610-0414",
            "mask": "5673",
            "nickname": "Freedom X",
            "payeeId": -894082738,
            "tileDetail": {
              "availableBalance": 6000.0,
              "currentBalance": 0.0,
              "lastPaymentDate": "20251015",
              "nextPaymentAmount": 0.0,
              "nextPaymentDueDate": "20251115",
              "pastDueAmount": 0.0,
              "productCode": "VP",
              "productGroupCode": 2,
              "cardArtGuid": "a1bf7f4d-7621-5b5d-0e17-de767aa2c5c1"
            }
          }
        ]
      }
    },
    {
      "url": "/svc/rl/accounts/secure/v1/user/metadata/list",
      "usage": "SESSION",
      "response": {
        "code": "SUCCESS",
        "personId": 2292345594,
        "profileId": 292845991,
        "segment": "CCI",
        "zipCode": "091334172",
        "stateCode": "WA",
        "countryCode": "USA",
        "maskedEmail": {
          "domain": "gmail.com",
          "prefix": "a",
          "suffix": "z"
        },
        "productInfos": [
          {
            "accountId": 894004738,
            "rewardsTypeId": "VP-6610-0414",
            "cardDefaultNickName": "Freedom",
            "mask": "5692",
            "nickName": "Freedom X",
            "productId": "CARD-BAC-001"
          },
          {
            "accountId": 2101029692,
            "mask": "0391",
            "nickName": "Primary Mortgage",
            "productId": "MORTGAGE-HMG-004"
          },
          {
            "accountId": 974024543,
            "mask": "5522",
            "nickName": "Auto Loan",
            "productId": "AUTOLOAN-ALA-446"
          }
        ]
      }
    }
  ],
  "personId": 2295346594,
  "profileId": 296845391,
  "currentDateTime": "2025-11-17T06:77:66.888Z"
}
```

**Important Fields**:

- `cache[].response.greetingName`: User's first name (e.g., "JOHN")
- `personId`: Person identifier
- `profileId`: Profile identifier (also available in PC_1_0 cookie as `pfid`)
- `cache[].response.accountTiles[]`: Detailed list of all accounts with tile information
  - `accountId`: Unique account identifier
  - `accountOriginationCode`: Account origination code (e.g., "6610", "6388")
  - `accountTileType`: Type of account tile ("CARD", "LOAN", etc.)
  - `accountTileDetailType`: Detail type ("BAC" for credit cards, "HMG" for mortgages, "ALA" for auto loans)
  - `cardType`: Specific card type (e.g., "FREEDOM_PLATINUM", "UNITED", "SAPPHIRE_RESERVE")
  - `mask`: Last 4 digits of account number
  - `nickname`: User-defined account nickname
  - `payeeId`: Payment identifier (negative of accountId)
  - `tileDetail.productCode`: Product code (e.g., "VP", "VW", "ME")
  - `tileDetail.productGroupCode`: Product group code (2 for credit cards, 3 for loans)
  - `tileDetail.currentBalance`: Current account balance
  - `tileDetail.availableBalance`: Available credit/balance
  - `tileDetail.nextPaymentDueDate`: Next payment due date (YYYYMMDD format)
  - `tileDetail.cardArtGuid`: GUID for card artwork/design
- `cache[].response.productInfos[]`: Simplified account summary list
  - Contains accountId, mask, nickName, and productId for all account types
  - `productId` format: `{TYPE}-{CODE}-{NUMBER}` (e.g., "CARD-BAC-001", "MORTGAGE-HMG-004", "AUTOLOAN-ALA-446")
- `cache[].response.maskedEmail`: Masked email address
- `cache[].response.zipCode`, `stateCode`, `countryCode`: Address information

**Note**: The full name is stored in uppercase in the greeting. The username can be found in the `auth-user-info` cookie (e.g., `johndoe1|timestamp|timestamp`). This single API call provides all necessary profile and account metadata including account IDs, eliminating the need for separate dashboard module list or account detail calls for statement downloads.

## 2. List Available Statements

### API: Get Document References

**Endpoint**: `POST /svc/rr/documents/secure/idal/v2/docref/list`

**HTTP Method**: POST

**Purpose**: Retrieves the list of available statements and documents for a specific account.

**Request Headers**:

- `Content-Type: application/x-www-form-urlencoded`
- `Cookie`: Session authentication cookies

**Request Body** (URL-encoded):

```
accountFilter={accountId}&dateFilter.idalDateFilterType=CURRENT_YEAR
```

Example:

```
accountFilter=894984728&dateFilter.idalDateFilterType=CURRENT_YEAR
```

**Request Parameters**:

- `accountFilter`: The account ID (from account detail API)
- `dateFilter.idalDateFilterType`: Date filter type
  - `CURRENT_YEAR`: Current year's documents
  - `PRIOR_YEAR`: Previous year's documents
  - `ALL`: All available documents

**Response Structure**:

```json
{
  "code": "SUCCESS",
  "payeeId": -894184738,
  "paperless": true,
  "mailMeACopy": true,
  "payAllowed": true,
  "idaldocRefs": [
    {
      "documentId": "a27ffd1d-330c-5edc-c036-0f07fgf41bb6",
      "documentDate": "20250918",
      "inserts": [],
      "adaVersionAvailable": false,
      "pageCount": "4",
      "documentTypeDesc": "Statement",
      "languageType": "ENGLISH",
      "changeInTermsAvailable": false,
      "adaVlsAvailable": false,
      "idaldocType": "STMT"
    }
  ]
}
```

**Important Fields**:

- `documentId`: Unique identifier for the document (used in download API)
- `documentDate`: Date of the statement in YYYYMMDD format
- `documentTypeDesc`: Type of document (e.g., "Statement", "Year-end mortgage")
- `idaldocType`: Document type code ("STMT" for statements)
- `pageCount`: Number of pages in the document

## 3. Get Document Download Key

### API: Get Document Key

**Endpoint**: `POST /svc/rr/documents/secure/idal/v2/dockey/list`

**HTTP Method**: POST

**Purpose**: Retrieves the document key required for downloading a specific statement.

**Request Headers**:

- `Content-Type: application/x-www-form-urlencoded`
- `Cookie`: Session authentication cookies

**Request Body** (URL-encoded):

```
accountFilter={accountId}&dateFilter.idalDateFilterType=CURRENT_YEAR&documentId={documentId}
```

Example:

```
accountFilter=894984728&dateFilter.idalDateFilterType=CURRENT_YEAR&documentId=a27ffd1d-330c-5edc-c036-0f07fgf41bb6
```

**Request Parameters**:

- `accountFilter`: The account ID
- `dateFilter.idalDateFilterType`: Date filter type (same as docref API)
- `documentId`: The document ID from the docref list response

**Response Structure**:

```json
{
  "code": "SUCCESS",
  "docKey": "239c8961-080a-582e-90d8-e49437ccg60b",
  "docSOR": "STAR_MS",
  "docURI": "/svc/rr/documents/secure/idal/v5/pdfdoc/star/list"
}
```

**Important Fields**:

- `docKey`: Document key required for the download request
- `docSOR`: System of record identifier
- `docURI`: URI path for the download endpoint

## 4. Download Statement PDF

### API: Download Document

**Endpoint**: `GET /svc/rr/documents/secure/idal/v5/pdfdoc/star/list`

**HTTP Method**: GET

**Purpose**: Downloads the PDF file for a specific statement.

**Request Headers**:

- `Cookie`: Session authentication cookies
- `Accept: text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8`

**Request Parameters** (Query String):

```
docKey={docKey}&sor={docSOR}&adaVersion=false&download=true&csrftoken={csrfToken}
```

Example:

```
docKey=239c8961-080a-582e-90d8-e49437ccg60b&sor=STAR_MS&adaVersion=false&download=true&csrftoken=2ex2d252fbe92gc97d666c38dc5g72e04e6deb213b02c0156c9b7d43c986bde5
```

**Request Parameters**:

- `docKey`: Document key from the dockey API response
- `sor`: System of record from the dockey API response
- `adaVersion`: Whether to download ADA-compliant version (typically `false`)
- `download`: Set to `true` to trigger download
- `csrftoken`: CSRF token (can be extracted from session cookies or page context)

**Response**: Binary PDF file

The response will be a PDF file with content type `application/pdf`. The filename is typically in the format: `{YYYYMMDD}-statements-{last4digits}-.pdf`

Example: `20250918-statements-5693-.pdf`

## Account Type Differences

Different account types have slightly different data structures:

### Credit Cards

- `productGroupCode`: 2
- `detail.detailType`: "BAC"
- `productCode`: Varies by card type (e.g., "VP", "VH", "SW")
- Statement date typically mid-month

### Mortgages

- `productGroupCode`: 3
- `detail.detailType`: "HMORTGAGE"
- `productCode`: "H" series
- Statement date typically beginning of month
- May include "Year-end mortgage" documents

### Auto Loans

- `productGroupCode`: 3
- `detail.detailType`: "ALA"
- `productCode`: "A" series
- Statement date typically mid-month

## Complete Workflow Example

### Step 1: Get user profile and all accounts

```
POST /svc/rl/accounts/l4/v1/app/data/list
Body: {}
```

Extract `accountId` values from `cache[].response.accountTiles[]` or `cache[].response.productInfos[]`.

### Step 2: For each account, get statements

```
POST /svc/rr/documents/secure/idal/v2/docref/list
Body: accountFilter={accountId}&dateFilter.idalDateFilterType=CURRENT_YEAR
```

### Step 3: For each statement, get download key

```
POST /svc/rr/documents/secure/idal/v2/dockey/list
Body: accountFilter={accountId}&dateFilter.idalDateFilterType=CURRENT_YEAR&documentId={documentId}
```

### Step 4: Download the statement PDF

```
GET /svc/rr/documents/secure/idal/v5/pdfdoc/star/list?docKey={docKey}&sor={docSOR}&adaVersion=false&download=true&csrftoken={csrfToken}
```

## Notes

1. **Authentication**: All APIs require valid session cookies. The session is established through the login flow at `https://www.chase.com/auth/fcc/login`.

2. **CSRF Token**: The CSRF token is required for the download API and can be obtained from the session cookies or page context.

3. **Account ID**: The `accountId` is the primary identifier for accounts and is used consistently across all document-related APIs. It can be positive (e.g., 894084738) while the `payeeId` is negative (e.g., -894084738).

4. **Date Filtering**: The `dateFilter.idalDateFilterType` parameter allows filtering documents by year. Available values:

   - `CURRENT_YEAR`: Current calendar year
   - `PRIOR_YEAR`: Previous calendar year
   - Can potentially use multiple years by making separate requests

5. **Document Types**: In addition to regular statements (`STMT`), there may be other document types:

   - Tax documents
   - Year-end summaries
   - Notices and disclosures

6. **Rate Limiting**: Chase likely implements rate limiting. Consider adding delays between requests to avoid triggering anti-bot measures.

7. **Error Handling**: All responses include a `code` field. Always check for `"SUCCESS"` before processing the response data.
