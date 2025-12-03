# BMO Canada - Bank Statement API Analysis

## Summary

BMO Canada's online banking platform uses a series of JSON-based POST APIs to retrieve account information, statement lists, and download statements. The APIs follow a consistent request/response pattern with headers for authentication and session management.

## Key Findings

- **Authentication**: Uses session cookies (`XSRF-TOKEN`, `PMData`) for API authentication
- **Base URL**: `https://www1.bmo.com`
- **API Pattern**: All APIs use POST requests with JSON bodies
- **Request Format**: Consistent `HdrRq` (header) and `BodyRq` (body) structure
- **Response Format**: Consistent `HdrRs` (header) and `BodyRs` (body) structure

## API Endpoints

### 1. Get Account Summary

**Purpose**: Retrieve comprehensive account summary including customer information, all bank accounts, credit cards, loans, mortgages, and investments with balances and details.

**Endpoint**: `POST /banking/services/mysummary/getMySummary`

**Request Headers**:

- `Content-Type`: `application/json` - Indicates JSON payload
- `Accept`: `application/json, text/plain, */*` - Accepts JSON response
- `X-XSRF-TOKEN`: CSRF protection token from `XSRF-TOKEN` cookie
- `X-ChannelType`: `OLB` (Online Banking) - Channel identifier
- `X-Request-ID`: Unique request identifier (format: `REQ_` + random hex)
- `X-UI-Session-ID`: UI session identifier (typically `0.0.1`)
- `Cookie`: Session cookies including `JSESSIONID`, `PD-S-SESSION-ID`, `XSRF-TOKEN`, `PMData`

**Request Parameters**:

- `MySummaryRq.HdrRq` (Header Request):
  - `ver`: API version (always `"1.0"`)
  - `channelType`: `"OLB"` for online banking
  - `appName`: `"OLB"` for online banking application
  - `hostName`: `"BDBN-HostName"` - client hostname identifier
  - `clientDate`: ISO 8601 timestamp of client request time
  - `rqUID`: Unique request UUID (matches `X-Request-ID` header)
  - `clientSessionID`: `"session-id"` - client session identifier
  - `userAgent`: Browser user agent string
  - `clientIP`: Client IP address (typically `"127.0.0.1"` from browser)
  - `mfaDeviceToken`: MFA device token from `PMData` cookie
- `MySummaryRq.BodyRq` (Body Request):
  - `refreshProfile`: `"N"` or `"Y"` - whether to refresh profile data from backend

**Request Payload**:

```json
{
  "MySummaryRq": {
    "HdrRq": {
      "ver": "1.0",
      "channelType": "OLB",
      "appName": "OLB",
      "hostName": "BDBN-HostName",
      "clientDate": "2025-11-16T13:16:00.699",
      "rqUID": "REQ_82a79f76e1f65220",
      "clientSessionID": "session-id",
      "userAgent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36",
      "clientIP": "127.0.0.1",
      "mfaDeviceToken": "RNW8M08cwEduVrYVoV2SiVO67Zzcy9MTz6Qju5GLUsEVzMH%2BkgKCufBGl43wglT%2Fl%2FwCrRHt54y2tFXLoCoMVzOiNzzz%3D%3D"
    },
    "BodyRq": {
      "refreshProfile": "N"
    }
  }
}
```

**Response Sample**:

```json
{
  "GetMySummaryRs": {
    "HdrRs": {
      "callStatus": "Success",
      "hostName": "colctddtqsdps02",
      "serverDate": "2025-11-16T08:16:00.668",
      "rqUID": "REQ_82a79f76e1f65220",
      "mfaDeviceToken": "SOX9N19dxFevWsZWpW3TjWP78Aady0NUz7Rkv6HMVtFWzNI%2BlhLDvgCHm54xhmU%2Fm%2FxDsSIu65z3uGYMpDpNWzPjOzzz%3D%3D",
      "mfaDeviceTokenExpire": 365
    },
    "BodyRs": {
      "credential": "6621301257354012",
      "firstName": "JOHN",
      "lastName": "DOE",
      "role": "BDC",
      "customerName": "JOHN DOE",
      "displayClassLimitFlag": "Y",
      "lastSignInDate": "2025-11-16",
      "lastSignInTime": "8:11 AM EST",
      "lastPasswordChangeDate": "1900-01-01",
      "applePayProvisioning": "true",
      "categoryDisplayOption": "",
      "categories": [
        {
          "categoryName": "BA",
          "groupHeadTitle": "Bank Accounts",
          "groupTotal": [
            {
              "summaryBalance": "2006.99",
              "currency": "CAD",
              "incompleteBalance": "N"
            }
          ],
          "products": [
            {
              "accountType": "BANK_ACCOUNT",
              "productName": "Chequing",
              "ocifAccountName": "Primary Chequing Account",
              "menuOptions": "VIEW_ESTATEMENTS,CHANGE_STATEMENT_OPTION",
              "accountNumber": "0895 4905-784",
              "currency": "CAD",
              "accountIndex": 0,
              "asOfDate": "2025-11-17",
              "accountBalance": "2006.98",
              "availableAmount": "2006.98",
              "jumpSiteIndicator": {
                "index": 0,
                "name": "NONE",
                "code": "NONE"
              },
              "isFromAm": false,
              "ocifShortName": "QDBQBM2",
              "locPlasticCard": false
            },
            {
              "accountType": "BANK_ACCOUNT",
              "productName": "Savings",
              "ocifAccountName": "Savings Amplifier Account",
              "menuOptions": "VIEW_ESTATEMENTS,CHANGE_STATEMENT_OPTION",
              "accountNumber": "0895 9982-100",
              "currency": "CAD",
              "accountIndex": 1,
              "asOfDate": "2025-11-17",
              "accountBalance": "0.01",
              "availableAmount": "0.01",
              "jumpSiteIndicator": {
                "index": 0,
                "name": "NONE",
                "code": "NONE"
              },
              "isFromAm": false,
              "ocifShortName": "IT4QBM3",
              "locPlasticCard": false
            }
          ]
        },
        {
          "categoryName": "CC",
          "groupHeadTitle": "Credit Cards",
          "groupTotal": []
        },
        {
          "categoryName": "LM",
          "groupHeadTitle": "Loans & Mortgages",
          "groupTotal": []
        },
        {
          "categoryName": "IN",
          "groupHeadTitle": "Investments",
          "groupTotal": []
        }
      ],
      "profileReviewRequired": false,
      "loginHistory": {
        "channelType": "OLB",
        "deviceType": "web",
        "cardType": "FBCP",
        "successfulLoginDateTime": "Sun Nov 16 08:11:21 EST 2025"
      },
      "ownerInd": "",
      "showSSOSetupBanner": false,
      "showSSOJumpBanner": true,
      "addressReviewRequired": false,
      "sbauthSignOTPEligible": false,
      "sbphoneOTPEligible": false
    }
  }
}
```

**Response Structure**:

- `GetMySummaryRs.HdrRs.callStatus`: `"Success"` or error status
- `GetMySummaryRs.HdrRs.mfaDeviceToken`: Updated MFA device token (save to `PMData` cookie)
- `GetMySummaryRs.BodyRs.categories[]`: Array of account categories
  - `categories[].products[]`: Individual accounts
    - `accountIndex`: Zero-based index for API #2 (required)
    - `accountNumber`: Display account number (format: `"{transit} {account}"`)
    - `productName`: Account type ("Chequing", "Savings", etc.)
    - `menuOptions`: Check for `"VIEW_ESTATEMENTS"` to verify eStatement support

---

### 2. Get E-Statements Encrypted Data

**Purpose**: Retrieve encrypted token for a specific account. This token must be passed to the decryption endpoint to get the actual statement list.

**Endpoint**: `POST /banking/services/estatements/getEStatementsEncryptedData`

**Request Parameters**:

- `EStatementsEncryptedDataRq.HdrRq`: Standard header (same structure as API #1)
- `EStatementsEncryptedDataRq.BodyRq`:
  - `acctType`: Account category code (`"BA"` for bank accounts, `"CC"` for credit cards, etc.)
  - `inquiryAccountIndex`: Account index as integer (from `getMySummary` response)

**Request Payload**:

```json
{
  "EStatementsEncryptedDataRq": {
    "HdrRq": {
      "ver": "1.0",
      "channelType": "OLB",
      "appName": "OLB",
      "hostName": "BDBN-HostName",
      "clientDate": "2025-11-16T13:15:42.620",
      "rqUID": "REQ_gd114g8a35785dbd",
      "clientSessionID": "session-id",
      "userAgent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36",
      "clientIP": "127.0.0.1",
      "mfaDeviceToken": "SOX9N19dxFevWsZWpW3TjWP78Aady0NUz7Rkv6HMVtFWzNI%2BlhLDvgCHm54xhmU%2Fm%2FxDsSIu65z3uGYMpDpNWzPjOzzz%3D%3D"
    },
    "BodyRq": {
      "acctType": "BA",
      "inquiryAccountIndex": 0
    }
  }
}
```

**Response Sample**:

```json
{
  "GetEStatementsEncryptedDataRs": {
    "HdrRs": {
      "callStatus": "Success",
      "hostName": "colctddtqsdps02",
      "serverDate": "2025-11-16T08:15:42.601",
      "rqUID": "REQ_gd114g8a35785dbd",
      "mfaDeviceToken": "SOX9N19dxFevWsZWpW3TjWP78Aady0NUz7Rkv6HMVtFWzNI%2BlhLDvgCHm54xhmU%2Fm%2FxDsSIu65z3uGYMpDpNWzPjOzzz%3D%3D",
      "mfaDeviceTokenExpire": 365
    },
    "BodyRs": {
      "introduction": "View and save your eStatements by selecting a time period or date range.",
      "isConsolidated": "N",
      "isAnnualStatement": "N",
      "mainAccount": {
        "name": "Chequing",
        "number": "0895 4905-784"
      },
      "memberAccountsList": [],
      "ecryptedData": "265d91be0bdbc1cbgdgb2g1b37gf1f8ecbc9780857f2g36169c9dd62g829c4008d93e1g204d86b878db66c4ce7c3g1d66f37f9b915g766f8073b87e5d1bgd61145f46e4d53ede165bg912g9f1e5e604b47966696g2990f77933b0gb29576fb92g8g4226g1f71379c61a0b30437b10bf582c3bd215gbf4639b1644beb9b8d08007816857c8fe2cc3g7c038b78cdbc7g0f3310f50d30e252ee409d89b88410c0b5816feeb35d830291650fc8443fe634607016efb4e04d6ea6f5bedc682dc9945ef33f4bcee0a8bdc6c85ff1g139ge9cf91g6f81gg72c1bfe1dg098f60db87e44bc13gg99bfb38f6cd83c37bfe3103905d16676cba078ed448405bd4f5c9e174dde94g9c2cdde8g2c5dgg07g122ba0g1b7f7259f68de02b53cg8fcg9d83198bd43gcf19c78ged6f557c4eg929f5f3bc9dec832d39e61g04b57gc3fcegf3bbe67cf08cbdfc83d5df19c58ed6b0c93g89e55046c6f6326615c3gc7bgdge4g40b3718ec4de1c370fcf26ge0c8fc51c21bgfb42g0248cb26b48d4ea87gb2d1bd954e8g3g44ed251f480fc06fd67280g1b8bd9db0d0f9b1079g4bcb58b5cc4de0093fb37g094bb37881d408a35de8b14e24dc016c2d34881c4088b598ec9d0f8078fb1814d97d0ed151589"
    }
  }
}
```

**Response Structure**:

- `GetEStatementsEncryptedDataRs.HdrRs.callStatus`: `"Success"` or error status
- `GetEStatementsEncryptedDataRs.BodyRs.ecryptedData`: Hex-encoded encrypted token (note the typo!)

**Important Notes**:

- Pass the `ecryptedData` value to API #3 for server-side decryption
- No client-side decryption needed

---

### 3. Get Statement List (Decrypt Encrypted Data)

**Purpose**: Decrypt the encrypted token from API #4 to get the actual list of available statements.

**Endpoint**: `GET /WebContentManager/getEDocumentsJSONList`

**Query Parameters**:

- `encrypted_data`: The hex-encoded encrypted token from `GetEStatementsEncryptedDataRs.BodyRs.ecryptedData`

**Example URL**:

```
GET https://www1.bmo.com/WebContentManager/getEDocumentsJSONList?encrypted_data=265d91be0bdbc1cbgdgb2g1b37gf1f8ecbc9780857f2g36169c9dd62g829c4008d93e1g204d86b878db66c4ce7c3g1d6...
```

**Request Headers**:

```
Cookie: JSESSIONID={session-id}; XSRF-TOKEN={token}; APIC-XSRF-TOKEN={token}; ...
User-Agent: Mozilla/5.0 ...
```

**Response Sample**:

```json
{
  "eDocuments": [
    {
      "date": "2025-10-17",
      "dummyParams": "4ed1c5e0-e3bf-5d0e-b74f-f1gg45fcfc83",
      "token": "-213382375997849",
      "econfirmation": "false"
    },
    {
      "date": "2025-09-18",
      "dummyParams": "ge0bg6d5-47df-589d-0f94-d60081700881",
      "token": "-213382375997849",
      "econfirmation": "false"
    },
    {
      "date": "2025-08-18",
      "dummyParams": "b606d139-gg40-5e2e-bb3f-5d9e9431db5e",
      "token": "-213382375997849",
      "econfirmation": "false"
    }
  ]
}
```

**Response Structure**:

- `eDocuments[]`: Array of available statements
  - `date`: Statement date (`YYYY-MM-DD`)
  - `dummyParams`: Unique UUID for this statement (required for API #4)
  - `token`: Authorization token (shared across all statements in this response)

**Key Points**:

- Use `dummyParams` and `token` from each statement to download PDFs (API #4)
- The `token` is request-specific and changes each time you call this API

---

## Statement Download Flow

The complete PDF statement download flow:

1. Call `getMySummary` (API #1) to get account list and verify eStatement support via `menuOptions`
2. Call `getEStatementsEncryptedData` (API #2) to get encrypted token
3. Call `getEDocumentsJSONList` (API #3) with encrypted token to get statement list
4. For each statement, call `DownloadEStatementInPDFBOSServlet` (API #4) with `dummyParams` and `token`

### 4. Download Statement PDF

**Purpose**: Download a specific statement as a PDF file.

**Endpoint**: `GET /WebContentManager/DownloadEStatementInPDFBOSServlet`

**Query Parameters**:

- `dummyParams`: Encrypted statement identifier (from decrypted `ecryptedData`)
- `token`: Security token (from decrypted `ecryptedData`)
- `econfirmation`: Confirmation flag (typically `"false"`)

**Example URL**:

```
GET https://www1.bmo.com/WebContentManager/DownloadEStatementInPDFBOSServlet?dummyParams=4ed1c5e0-e3bf-5d0e-b74f-f1gg45fcfc83&token=-213382375997849&econfirmation=false
```

**Request Headers**:

```
Cookie: JSESSIONID={session-id}; XSRF-TOKEN={token}; APIC-XSRF-TOKEN={token}; ...
User-Agent: Mozilla/5.0 ...
```

**Response**:

- **Status**: `200 OK`
- **Content-Type**: `application/pdf`
- **Content-Disposition**: `attachment; filename=eStatement_2025-10-17.pdf`
- **Body**: Binary PDF file data

**Key Points**:

- Both `dummyParams` and `token` come from API #3 response
- Each statement has unique `dummyParams`; `token` is shared within the same API #3 response
- Returns PDF file with name format: `eStatement_{YYYY-MM-DD}.pdf`
