# Chase Bank Statement API Analysis

**Analysis as of:** 2026-09-27

## Overview

This document analyzes the Chase bank APIs used to retrieve user profile information, list accounts, retrieve statements, and download statement PDFs.

## Current scope and evidence

The authenticated account overview at `secure.chase.com/web/auth/dashboard`
issued `POST /svc/rl/accounts/l4/v1/app/data/list`, returning HTTP 200 and
`code: "SUCCESS"`. The request had an empty body and
`Content-Type: application/x-www-form-urlencoded; charset=UTF-8`, superseding the
historical JSON-body description.

Its `cache` includes the dashboard tiles, greeting, user metadata, and
`/svc/rl/accounts/secure/v1/csrf/token/list` responses. Top-level `profileId`
and tile `accountId` values are numbers; tile masks are strings. The available
tiles include credit cards (`CARD` / `BAC`), checking (`DDA` / `CHK`), an auto
loan (`AUTOLOAN` / `ALA`), and a mortgage (`MORTGAGE` / `HMG`). Credit-card
`productGroupCode` values are not limited to `2`. These observations establish
account discovery, not statement or download support for every product.

Opening the bank's **Statements & documents** link issued
`POST /svc/rr/documents/secure/idal/v2/docref/list` with HTTP 200. Account-specific
expansion used `accountFilter=<account-id>` and
`dateFilter.idalDateFilterType=CURRENT_YEAR`. The selected checking and credit-card
lists contained five and four statements respectively; the auto-loan list contained
nine. The mortgage list contained nine `STMT` documents plus a `MORTGAGE_YES`
year-end statement, which is outside the regular-statement scope.

All four bank-UI downloads used the documented `dockey/list` POST and returned
`docURI: "/svc/rr/documents/secure/idal/v5/pdfdoc/star/list"` and
`docSOR: "STAR_MS"`. The ensuing PDF GETs returned HTTP 200 and `application/pdf`.
The checking download's `csrftoken` matched the token in the app-data cache's
CSRF response. Its `docKey` and `sor` matched the selected dockey response.
This proves the observed request path, not that every historical header is required.

The checking UI offered a save menu with standard and accessible PDFs. The other
three selected products offered direct save links. All four standard bank-UI PDFs
parsed and rendered without repair or warnings and matched the selected account
mask. Checking's selected date matched the document text; the credit-card closing
date matched in `MM/DD/YY` form. The mortgage PDF's labelled **Statement date**
was one day before its list date. The auto-loan PDF instead exposed a labelled
**Due Date**, twenty days after its list date. Do not equate the document-list date
with every product's printed billing date. Use the independently saved bank-UI
PDF's labelled field when comparing a later extension copy for these loan flows.
These bank-UI checks do not establish extension download acceptance.

The historical direct login URL `/auth/fcc/login` returned HTTP 405 when opened
with GET. The user instead signed in through the form on `https://www.chase.com/`.

## Base URLs

- **Secure API**: `https://secure.chase.com/svc/`
- **Static Content**: `https://static.chase.com/content/`
- **Analytics**: `https://analytics.chase.com/events/`

## API Authentication

The exercised requests use the authenticated page's cookies. Historical cookie
names below describe the session context, not a proven minimal authentication set:

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

- `Content-Type: application/x-www-form-urlencoded; charset=UTF-8`
- `Cookie`: Session authentication cookies

**Request Body**:

Empty body (not a JSON object).

**Response Structure** (key sections):

All identifiers, names, balances, dates, and document references in examples are
synthetic or placeholders. Numeric identifiers retain their numeric type.

```json
{
  "code": "SUCCESS",
  "cache": [
    {
      "url": "/svc/rl/accounts/secure/v1/deck/greeting/list",
      "usage": "SESSION",
      "response": {
        "greetingId": "TIME_OF_DAY",
        "greetingName": "TEST"
      }
    },
    {
      "url": "/svc/rr/accounts/secure/v4/dashboard/tiles/list",
      "usage": "ONCE",
      "response": {
        "code": "SUCCESS",
        "defaultAccountId": 1001,
        "personalTileGroups": [
          {
            "customerTileGroupId": "3001",
            "creditCardAccountTileIds": [-2001],
            "loanAccountTileIds": [],
            "creditScoreTileId": 2002,
            "creditJourneyTileId": 2003
          }
        ],
        "accountTiles": [
          {
            "tileId": -2001,
            "accountId": 1001,
            "accountOriginationCode": "6613",
            "accountTileType": "CARD",
            "cardType": "FREEDOM_PLATINUM",
            "accountTileDetailType": "BAC",
            "rewardProgramCode": "0404",
            "rewardsTypeId": "VP-6610-0414",
            "mask": "1234",
            "nickname": "Synthetic Card",
            "payeeId": -1001,
            "tileDetail": {
              "availableBalance": 1000.0,
              "currentBalance": 0.0,
              "lastPaymentDate": "20000215",
              "nextPaymentAmount": 0.0,
              "nextPaymentDueDate": "20000315",
              "pastDueAmount": 0.0,
              "productCode": "VP",
              "productGroupCode": 2,
              "cardArtGuid": "<card-art-id>"
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
        "personId": 4001,
        "profileId": 5001,
        "segment": "CCI",
        "zipCode": "<zip-code>",
        "stateCode": "<state-code>",
        "countryCode": "<country-code>",
        "maskedEmail": {
          "domain": "example.test",
          "prefix": "<prefix>",
          "suffix": "<suffix>"
        },
        "productInfos": [
          {
            "accountId": 1001,
            "rewardsTypeId": "VP-6610-0414",
            "cardDefaultNickName": "Freedom",
            "mask": "1234",
            "nickName": "Synthetic Card",
            "productId": "CARD-BAC-001"
          },
          {
            "accountId": 1002,
            "mask": "5678",
            "nickName": "Synthetic Mortgage",
            "productId": "MORTGAGE-HMG-004"
          },
          {
            "accountId": 1003,
            "mask": "9012",
            "nickName": "Synthetic Auto Loan",
            "productId": "AUTOLOAN-ALA-446"
          }
        ]
      }
    }
  ],
  "personId": 4001,
  "profileId": 5001,
  "currentDateTime": "2000-03-01T00:00:00.000Z"
}
```

**Important Fields**:

- `cache[].response.greetingName`: Greeting name
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

**Note**: Do not assume the greeting is a full legal name. The integration uses
the greeting response and top-level profile metadata rather than reading the
username from cookies. The app-data response provides the account IDs needed for
the exercised statement flows.

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
accountFilter=1001&dateFilter.idalDateFilterType=CURRENT_YEAR
```

**Request Parameters**:

- `accountFilter`: The account ID from the account tile
- `dateFilter.idalDateFilterType`: Date filter type
  - `CURRENT_YEAR`: Current year's documents
  - Other filters were described historically but have not been revalidated.
    The integration currently requests only `CURRENT_YEAR`.

**Response Structure**:

```json
{
  "code": "SUCCESS",
  "payeeId": -1001,
  "paperless": true,
  "mailMeACopy": true,
  "payAllowed": true,
  "idaldocRefs": [
    {
      "documentId": "<document-id>",
      "documentDate": "20000301",
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
- `documentDate`: Document-list date in YYYYMMDD format; not necessarily the
  printed statement or payment due date
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
accountFilter=1001&dateFilter.idalDateFilterType=CURRENT_YEAR&documentId=<document-id>
```

**Request Parameters**:

- `accountFilter`: The account ID
- `dateFilter.idalDateFilterType`: Date filter type (same as docref API)
- `documentId`: The document ID from the docref list response

**Response Structure**:

```json
{
  "code": "SUCCESS",
  "docKey": "<document-key>",
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
docKey=<document-key>&sor=STAR_MS&adaVersion=false&download=true&csrftoken=<csrf-token>
```

**Request Parameters**:

- `docKey`: Document key from the dockey API response
- `sor`: System of record from the dockey API response
- `adaVersion`: Whether to download ADA-compliant version (typically `false`)
- `download`: Set to `true` to trigger download
- `csrftoken`: Token from `/svc/rl/accounts/secure/v1/csrf/token/list`. Its response
  is included in the observed app-data cache. The integration requests that
  endpoint with an empty POST body before each download; it does not guess a cookie
  value or use a fixed CSRF token.

**Response**: Binary PDF file

The response will be a PDF file with content type `application/pdf`. The filename is typically in the format: `{YYYYMMDD}-statements-{last4digits}-.pdf`

Synthetic example: `20000301-statements-1234-.pdf`

## Account Type Differences

Different account types have slightly different data structures:

### Credit Cards

- `accountTileType`: `CARD`; `accountTileDetailType`: `BAC`
- `productGroupCode`: Multiple observed values; do not require only `2`
- `productCode`: Varies by card type (e.g., "VP", "VH", "SW")
- Statement date typically mid-month

### Mortgages

- `accountTileType`: `MORTGAGE`; `accountTileDetailType`: `HMG`
- Historical `HMORTGAGE` and group-code mappings remain compatibility fallbacks
- `productCode`: "H" series
- Statement date typically beginning of month
- May include "Year-end mortgage" documents

### Auto Loans

- `accountTileType`: `AUTOLOAN`; `accountTileDetailType`: `ALA`
- `productCode`: "A" series
- Statement date typically mid-month

## Complete Workflow Example

### Step 1: Get user profile and all accounts

```
POST /svc/rl/accounts/l4/v1/app/data/list
Body: <empty>
```

Extract `accountId` values from the cached dashboard response's `accountTiles`.
The metadata `productInfos` describe accounts but are not an integration fallback.

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

1. **Authentication**: Let the bank establish and renew the session through its
   public sign-in UI. The integration uses page cookies without managing login.

2. **CSRF Token**: The PDF requests carry the token from the bank's CSRF response;
   a successful request does not establish which headers are individually mandatory.

3. **Account ID**: The `accountId` is passed unchanged to document APIs. It is not
   the displayed account number; use the bank's `mask` for identification.

4. **Date Filtering**: Only `CURRENT_YEAR` was exercised. Older periods, accessible
   PDFs, other document categories, and additional accounts remain unverified.

5. **Document Types**: In addition to regular statements (`STMT`), there may be other document types:

   - Tax documents
   - Year-end summaries
   - Notices and disclosures

6. **Rate Limiting**: No limit was established in this investigation.

7. **Error Handling**: Reject an explicit non-`SUCCESS` code, malformed document
   lists, invalid dates, and non-PDF download bodies rather than reporting empty
   lists or successful downloads. Empty document arrays are valid.

## Shared contract mapping

- `Profile.sessionId` uses the existing `v1st` cookie mapping. Its behavior across
  sign-out and user switching was not validated; do not assume it proves identity.
- Top-level `profileId` and the cached greeting supply profile identity/display.
- Tile `accountId`, `nickname`, and `mask` supply account identity, name, and mask.
  Classify observed loan tile/detail codes before relying on a user-chosen nickname.
- `STMT` documents become statements; `MORTGAGE_YES` and other categories are
  excluded. Interpret `YYYYMMDD` as a calendar date at UTC midnight so the popup's
  ISO-date formatting does not shift the day in positive time zones.
- The document ID and account ID feed the key request. PDF bytes become the Blob;
  MIME type and signature checks reject obvious non-PDF responses but do not
  replace complete parsing/rendering/content validation.
