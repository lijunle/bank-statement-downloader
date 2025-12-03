# US Bank API Analysis

## Bank Information

- **Bank ID**: us_bank
- **Bank Name**: US Bank
- **Bank URL**: https://onlinebanking.usbank.com

---

## API Analysis

### 1. Session ID

**Session Cookie**: `PIM-SESSION-ID`

- **Location**: HTTP Cookie
- **Example Value**: `s5X0cuVC7Pgq XIvz`
- **HttpOnly**: No (accessible via JavaScript)
- **Description**: Primary session identifier used to maintain user's authenticated state

**Authorization Token**:

- **Location**: HTTP Header `authorization`
- **Format**: Bearer token
- **Example**: `Bearer 9cwMHi9B3hrluRwZ0E6syHHvCQqc`
- **Description**: OAuth-style bearer token used for API authentication

**Additional Session Tracking**:

- `QuantumMetricSessionID`: Session analytics tracking
- `fp_token_8d7b7685-g122-5d0b-bcee-0905b213ddf0`: Fingerprint token for device identification

---

### 2. Retrieve User Profile Information

**API Endpoint**: `https://onlinebanking.usbank.com/digital/api/customer-management/graphql/v2`

**HTTP Method**: POST

**HTTP Headers**:

```
:authority: onlinebanking.usbank.com
:method: POST
:path: /digital/api/customer-management/graphql/v2
:scheme: https
accept: */*
accept-encoding: gzip, deflate, br, zstd
accept-language: en-US,en;q=0.9
application-id: WEBCD
authorization: Bearer <token>
content-type: application/json
cookie: PIM-SESSION-ID=<session_id>; ...
origin: https://onlinebanking.usbank.com
referer: https://onlinebanking.usbank.com/digital/servicing/shellapp/
sec-fetch-dest: empty
sec-fetch-mode: cors
sec-fetch-site: same-origin
service-version: 2
user-agent: Mozilla/5.0 ...
```

**GraphQL Query**:

```graphql
query customer($input: ProfileInput!) {
  customer(input: $input) {
    customer {
      personal {
        customerType {
          type
          typeCode
          isFCLOCCustomer
        }
        hashedLegalParticipantID
        acquisitionCode
        preference {
          language {
            preferenceCode
          }
        }
        dateOfBirth
        birthdayIndicator
        name {
          fullName
          firstName
          lastName
        }
        relationship {
          acquisitionCode
          recordOpenDate
        }
      }
      extendedProfile {
        alliancePartners
        profileType {
          isEAAEligible
          hasMGPAccess
          isWealthCustomer
          allianceUserType
        }
        wealthProfile {
          isWealthCustomer
          isWealthPlusCustomer
          isRetailWealthCustomer
        }
        restrictedRole
        collaborator
      }
    }
  }
}
```

**Request Variables**:

```json
{
  "input": {
    "identifier": "",
    "identifierType": "UID"
  }
}
```

**Sample Response**:

```json
{
  "data": {
    "customer": {
      "customer": [
        {
          "personal": [
            {
              "customerType": {
                "type": "R",
                "typeCode": "R",
                "isFCLOCCustomer": false
              },
              "hashedLegalParticipantID": "73E44G75D9EE220E8GB4B8B28349G843EEG96DD75EEDDD1373344935D39660E4",
              "acquisitionCode": null,
              "preference": {
                "language": {
                  "preferenceCode": ""
                }
              },
              "dateOfBirth": null,
              "birthdayIndicator": false,
              "name": {
                "fullName": "John Doe",
                "firstName": "John",
                "lastName": "Doe"
              },
              "relationship": {
                "acquisitionCode": null,
                "recordOpenDate": "2021-07-19 00:00:00"
              }
            }
          ],
          "extendedProfile": {
            "alliancePartners": [],
            "profileType": {
              "isEAAEligible": false,
              "hasMGPAccess": false,
              "isWealthCustomer": false,
              "allianceUserType": "NON_ALLIANCE"
            },
            "wealthProfile": {
              "isWealthCustomer": false,
              "isWealthPlusCustomer": false,
              "isRetailWealthCustomer": false
            },
            "restrictedRole": false,
            "collaborator": "USB"
          }
        }
      ]
    }
  }
}
```

**Key Fields**:

- `name.fullName`: Full name of the customer
- `name.firstName`: First name
- `name.lastName`: Last name
- `customerType.type`: Customer type (R for Retail)
- `hashedLegalParticipantID`: Unique customer identifier
- `relationship.recordOpenDate`: Account opening date

**Authentication Requirements**:

- Cookie: `PIM-SESSION-ID` (session cookie)
- Authorization Header: `Bearer <token>` where token is retrieved from `sessionStorage.getItem('AccessToken')`
- Note: The AccessToken is stored in sessionStorage after login and must be included in all GraphQL and download API requests

---

### 3. List All Accounts

**API Endpoint**: `https://onlinebanking.usbank.com/digital/api/customer-management/graphql/v2`

**HTTP Method**: POST

**HTTP Headers**: Same as user profile API

**GraphQL Operation Name**: `accounts`

**GraphQL Query**:

```graphql
query accounts($accountInput: AccountInput!) {
  accounts(accountInput: $accountInput) {
    accountToken
    productCode
    subProductCode
    accountNumber
    adminToken
    displayName
    nickname
    accountType
    ownershipType
    relationshipCode
    baseAccount {
      partnerCode
      primaryAccountOwnerName
      jointAccountOwnerName
      accountOpenedDate
      paperlessPreferences {
        paperlessEnrollIndicators {
          eStatementEnrolled
          taxEnrolled
        }
      }
    }
    bnplDetails
  }
}
```

**Request Variables**:

```json
{
  "accountInput": {
    "filters": {
      "filterKey": "STATEMENTSACCESSIBLE",
      "filterValue": "",
      "filterType": "SINGLE"
    },
    "identifierType": "UID",
    "identifier": "johndoe"
  }
}
```

**Parameters**:

- `identifierType`: "UID" (User ID)
- `identifier`: User's login ID (e.g., "lijunle") - this is the username used during login
- `filters.filterKey`: "STATEMENTSACCESSIBLE" - filters accounts that have statement access
- `filters.filterType`: "SINGLE"

**Sample Response**:

```json
{
  "data": {
    "accounts": [
      {
        "accountToken": "$vYseNTpTY9yvbtTKiDDwVGJJUKML1q7FECVbFKBBElXLeIGD0N2gbNC9N5uxkxO",
        "productCode": "CCD",
        "subProductCode": "D7",
        "accountNumber": "7606",
        "adminToken": null,
        "displayName": "Altitude Reserve J - 7606",
        "nickname": "Altitude Reserve J",
        "accountType": "Credit Card",
        "ownershipType": "OWNED_INTERNAL",
        "relationshipCode": "IND",
        "baseAccount": {
          "partnerCode": "",
          "__typename": "BaseAccount"
        },
        "bnplDetails": null,
        "__typename": "CreditAccount"
      },
      {
        "accountToken": "$fKguAGTDKtEjMn3uSqxRCH55lLQO8hMOJhJYNZ1wIO9p0EcJFpRGlHiPTmF77",
        "productCode": "CCD",
        "subProductCode": "D7",
        "accountNumber": "7340",
        "adminToken": null,
        "displayName": "Cash Plus J - 7340",
        "nickname": "Cash Plus J",
        "accountType": "Credit Card",
        "ownershipType": "OWNED_INTERNAL",
        "relationshipCode": "IND",
        "baseAccount": {
          "partnerCode": "",
          "__typename": "BaseAccount"
        },
        "bnplDetails": null,
        "__typename": "CreditAccount"
      },
      {
        "accountToken": "$OtD7w9lgiJX1SqaTGwKpva9Ouwejhnj4TiEAnFZwXvq22pefU4GcUWUE5Ihw3Et",
        "productCode": "CCD",
        "subProductCode": "D7",
        "accountNumber": "1075",
        "adminToken": null,
        "displayName": "Altitude Connect J - 1075",
        "nickname": "Altitude Connect J",
        "accountType": "Credit Card",
        "ownershipType": "OWNED_INTERNAL",
        "relationshipCode": "IND",
        "baseAccount": {
          "partnerCode": "",
          "__typename": "BaseAccount"
        },
        "bnplDetails": null,
        "__typename": "CreditAccount"
      }
    ]
  }
}
```

**Key Fields**:

- `accountToken`: Unique encrypted token for the account (used in subsequent API calls)
- `accountNumber`: Last 4 digits of account number
- `displayName`: Full account display name
- `nickname`: Account nickname
- `accountType`: Type of account (e.g., "Credit Card")
- `productCode`: Product code (CCD = Credit Card)
- `subProductCode`: Sub-product identifier

**Parameter Source**:

The `identifier` parameter is the username that the user enters during login. After successful authentication, **US Bank stores the username in browser localStorage** under the `users` key.

**localStorage Structure**:

```javascript
// localStorage.getItem('users')
{
  "0": {
    "user_id": "johndoe",  // This is the username/identifier needed
    "guid": "GE75GC5EE56CBFE631952E8BFGB0BD04",
    "device_id": "9e7e2g2f-5911-5deb-bf24-de9924degge0",
    "has_logged_in": true,
    // ... other fields
  },
  "length": 1
}
```

**Implementation Note**: The extension can retrieve the username from localStorage:

```javascript
const usersData = JSON.parse(localStorage.getItem("users"));
const username = usersData["0"].user_id; // e.g., "johndoe"
```

The username is required for the accounts API call.

---

### 4. List Available Statements

**API Endpoint**: `https://onlinebanking.usbank.com/digital/api/customer-management/graphql/v2`

**HTTP Method**: POST

**HTTP Headers**: Same as previous GraphQL APIs

**GraphQL Operation Name**: `getStatementList`

**GraphQL Query**:

```graphql
query getStatementList($statementListRequest: StatementListRequest!) {
  Statements(statementListRequest: $statementListRequest) {
    orderCopyFee
    list {
      documentType
      identifier
      statementDate
      statementName
      frequency
      insertDescription {
        EINSERT
        EDESCRIPTION
      }
    }
  }
}
```

**Request Variables**:

```json
{
  "statementListRequest": {
    "accountToken": "$vYseNTpTY9yvbtTKiDDwVGJJUKML1q7FECVbFKBBElXLeIGD0N2gbNC9N5uxkxO",
    "fromDate": "01/01/2025",
    "toDate": "12/31/2025"
  }
}
```

**Parameters**:

- `accountToken` (required): Account token obtained from the accounts list API
- `fromDate`: Start date for statement search (format: MM/DD/YYYY)
- `toDate`: End date for statement search (format: MM/DD/YYYY)

**Parameter Sources**:

- `accountToken`: From "List All Accounts" API response (`accounts[].accountToken`)
- `fromDate`/`toDate`: User-specified date range

**Sample Response**:

```json
{
  "data": {
    "Statements": {
      "orderCopyFee": "$0",
      "list": [
        {
          "documentType": null,
          "identifier": "eFf5hNSfN0v5v6j7xQTx8D9PuvbxFgEiC0IakeCseth3ZzDLH2Eth4QvwECZjBS2eISgEIo+vLvRbXSCoBRNMSsZz/YcLn6kUlg88p1dC/fjV3OgYeoCSRZ235aXwdAexy9cxD2A2ss7sxvUM23zBC/GxcGPc0ScCDxml55I2VrRdt/2WBdJR0Wy8AmV+54xChC0psO+OVNiIVQZtk/n+X4D8dKV7BSF3qCK+wEV52CTsLOCCDa4K+pKwMzZUKrVM1AFFEIQ50eRnHFyEjmz8G13dFVltWDKVMMGZFUYfXxlRtq4J7LWzNvXHrm3YoXgw2ME2vMTK9xZFPwMYwEEkHnDFfJrUmDJXYn+TV/rDETPu5r2ZeXQCwjDIm5WsGEwb9Kt6+Wr4p1XwYlFR1eo5cVyuAwJymGjvpIbx1mcaruHDZpi6faNmy+zDcBOfJKORjjzS6xbrt4k2alshaTuC0dIprGholMChuMl13TOr6paS78u5I0Q401aRpf3okubBVG781lhaeFGFZBi7a4E7Yh+n1OMVd98wyf3I0mcZOXUDJIma0Qikjxuwd4I2I9TSFTfJFB+NdVMCVgys4cs+6QxewoZsCLeYEEDuCRzdXw75kmiO+eRjnLjLostJl9iIxrKZOBMsTzH4aNDVr8mXUPBiJlM/i1bBCLvC0HgjDTKcmc4I00PUD61SfvghSGjndr7dtiL9yTZK3h5WmvVB==",
          "statementDate": "11/04/2025",
          "statementName": null,
          "frequency": null,
          "insertDescription": [
            {
              "EINSERT": "",
              "EDESCRIPTION": ""
            }
          ]
        }
      ]
    }
  }
}
```

**Key Fields**:

- `identifier`: Encrypted statement identifier (used for downloading)
- `statementDate`: Date of the statement (format: MM/DD/YYYY)
- `orderCopyFee`: Fee for ordering statement copy

**Account Type Coverage**: All account types (credit cards, checking, savings, loans) use the same API structure.

---

### 5. Download Statement PDF

**API Endpoint**: `https://onlinebanking.usbank.com/digital/api/customer-management/servicing/files/v1/downloads`

**HTTP Method**: POST

**HTTP Headers**:

```
:authority: onlinebanking.usbank.com
:method: POST
:path: /digital/api/customer-management/servicing/files/v1/downloads
:scheme: https
accept: application/json, text/plain, */*
accept-encoding: gzip, deflate, br, zstd
accept-language: en-US,en;q=0.9
application-id: WEBCD
authorization: Bearer <token>
content-type: application/json
cookie: PIM-SESSION-ID=<session_id>; ...
origin: https://onlinebanking.usbank.com
referer: https://onlinebanking.usbank.com/digital/servicing/shellapp/
sec-fetch-dest: empty
sec-fetch-mode: cors
sec-fetch-site: same-origin
service-version: 2
user-agent: Mozilla/5.0 ...
```

**Request Payload**:

```json
{
  "requestType": {
    "serviceType": "STATEMENTS",
    "serviceSubType": "DOWNLOAD"
  },
  "data": {
    "statementList": {
      "accountToken": "$vYseNTpTY9yvbtTKiDDwVGJJUKML1q7FECVbFKBBElXLeIGD0N2gbNC9N5uxkxO",
      "documentType": "STATEMENT",
      "dates": ["11/04/2025"],
      "identifiers": [
        "eFf5hNSfN0v5v6j7xQTx8D9PuvbxFgEiC0IakeCseth3ZzDLH2Eth4QvwECZjBS2eISgEIo+vLvRbXSCoBRNMSsZz/YcLn6kUlg88p1dC/fjV3OgYeoCSRZ235aXwdAexy9cxD2A2ss7sxvUM23zBC/GxcGPc0ScCDxml55I2VrRdt/2WBdJR0Wy8AmV+54xChC0psO+OVNiIVQZtk/n+X4D8dKV7BSF3qCK+wEV52CTsLOCCDa4K+pKwMzZUKrVM1AFFEIQ50eRnHFyEjmz8G13dFVltWDKVMMGZFUYfXxlRtq4J7LWzNvXHrm3YoXgw2ME2vMTK9xZFPwMYwEEkHnDFfJrUmDJXYn+TV/rDETPu5r2ZeXQCwjDIm5WsGEwb9Kt6+Wr4p1XwYlFR1eo5cVyuAwJymGjvpIbx1mcaruHDZpi6faNmy+zDcBOfJKORjjzS6xbrt4k2alshaTuC0dIprGholMChuMl13TOr6paS78u5I0Q401aRpf3okubBVG781lhaeFGFZBi7a4E7Yh+n1OMVd98wyf3I0mcZOXUDJIma0Qikjxuwd4I2I9TSFTfJFB+NdVMCVgys4cs+6QxewoZsCLeYEEDuCRzdXw75kmiO+eRjnLjLostJl9iIxrKZOBMsTzH4aNDVr8mXUPBiJlM/i1bBCLvC0HgjDTKcmc4I00PUD61SfvghSGjndr7dtiL9yTZK3h5WmvVB=="
      ]
    }
  }
}
```

**Parameters**:

- `requestType.serviceType`: "STATEMENTS"
- `requestType.serviceSubType`: "DOWNLOAD"
- `data.statementList.accountToken` (required): Account token from accounts API
- `data.statementList.documentType`: "STATEMENT"
- `data.statementList.dates` (required): Array of statement dates (format: MM/DD/YYYY)
- `data.statementList.identifiers` (required): Array of encrypted statement identifiers from statement list API

**Parameter Sources**:

- `accountToken`: From "List All Accounts" API (`accounts[].accountToken`)
- `dates`: From "List Available Statements" API (`Statements.list[].statementDate`)
- `identifiers`: From "List Available Statements" API (`Statements.list[].identifier`)

**Response**:

- **Status**: 200 OK
- **Content-Type**: application/pdf
- **Body**: Binary PDF file content

**Account Type Coverage**: All account types (credit cards, checking, savings, loans) use the same API structure.

---

## API Dependencies

```
Authentication (Login)
  ↓
  → Session Cookie: PIM-SESSION-ID
  → Authorization Token: Bearer <token>
  ↓
  ├─→ Retrieve User Profile
  │   (No additional parameters needed)
  │
  ├─→ List All Accounts
  │   Parameters:
  │   - identifier: From authenticated session
  │   - identifierType: "UID"
  │   - filters.filterKey: "STATEMENTSACCESSIBLE"
  │   ↓
  │   Returns: accountToken for each account
  │   ↓
  │   ├─→ List Available Statements
  │   │   Parameters:
  │   │   - accountToken: From accounts API
  │   │   - fromDate: User-specified
  │   │   - toDate: User-specified
  │   │   ↓
  │   │   Returns: identifier, statementDate
  │   │   ↓
  │   │   └─→ Download Statement PDF
  │   │       Parameters:
  │   │       - accountToken: From accounts API
  │   │       - dates: From statement list API
  │   │       - identifiers: From statement list API
  │   │       ↓
  │   │       Returns: PDF file
```

---

## Implementation Notes

1. **GraphQL API**: US Bank uses GraphQL for most data retrieval operations. All GraphQL queries go to the same endpoint with different operation names and variables.

2. **Account Tokens**: Account identifiers are encrypted tokens (starting with `$`) rather than plain account numbers. These tokens must be obtained from the accounts list API first.

3. **Statement Identifiers**: Statement identifiers are also encrypted/encoded strings that must be obtained from the statement list API before downloading.

4. **Date Format**: All dates use MM/DD/YYYY format.

5. **Session Management**:

   - Session is maintained through the `PIM-SESSION-ID` cookie
   - API calls also require the `authorization` header with Bearer token
   - Both must be present for successful API calls

6. **Required Headers**:

   - `application-id`: Varies by context (WEBCD for general queries, lettersAndNotices for statements)
   - `service-version`: 2 (for download API)
   - `authorization`: Bearer token
   - `cookie`: Must include PIM-SESSION-ID

7. **Filter for Statements**: When listing accounts, use filter `STATEMENTSACCESSIBLE` to only retrieve accounts that have statement access.

8. **No Pagination**: The APIs observed do not appear to use pagination for account lists or statement lists within the date range.
