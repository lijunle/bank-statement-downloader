# BMO Canada - Bank Statement API Analysis

**Analysis as of:** 2026-09-25

## Summary

BMO Canada's online banking platform uses JSON POST requests for account summary
and statement-list references, followed by GET requests for document lists and PDFs.
The POST APIs retain the `HdrRq` / `BodyRq` and `HdrRs` / `BodyRs` envelopes.

## Scope and evidence

Bank identifier: `bmo`. Current observations come from the authenticated BMO Canada
website at `https://www1.bmo.com`, using its account overview and the checking and
savings Statements tabs and PDF links. Both products are eligible for eStatements.
Credit cards, loans, investments, and consolidated statements have not been
exercised in this investigation.

Opening the authenticated account overview in the bank UI issued
`POST /api/cdb/customer-product-and-service-directory/mysummary/getMySummary`,
returning HTTP 200 and `GetMySummaryRs.HdrRs.callStatus: "Success"`. The existing
integration's historical `/banking/services/mysummary/getMySummary` returned HTTP
400 with an Access Denied response in the same authenticated browser. This is
evidence of different routes, not proof of which individual header is mandatory.

Historical payload examples below describe the retained envelope and field names;
they are not a claim that all product types or historical authentication
assumptions were revalidated.

## Key Findings

- **Authentication**: Current summary and statement-list UI requests include browser cookies, `X-XSRF-TOKEN`,
  `Authorization: dpop <access-token>`, and a `DPoP` proof. Cookie-only authentication
  is no longer an established description of the observed request.
- **Base URL**: `https://www1.bmo.com`
- **API Pattern**: POST for summary/reference requests; GET for document lists/PDFs
- **Request Format**: Consistent `HdrRq` (header) and `BodyRq` (body) structure
- **Response Format**: POST envelopes use `HdrRs` / `BodyRs`; the list GET returns
  `eDocuments`, and the download GET returns PDF bytes.

## Authentication observations and open questions

- The current bank requests carry `authorization`, `dpop`,
  `x-bmo-user-session-id`, `x-bmo-device-fingerprint`, and
  `x-bmo-mfa-device-token`, in addition to the historical UI and XSRF headers.
  Their presence alone does not establish necessity. No header-removal experiment
  has established a minimal accepted request.
- A single read-only diagnostic request to the observed new summary endpoint used
  the historical JSON body and XSRF/UI headers with browser cookies, but no
  `Authorization` or `DPoP`. It returned HTTP 401 with
  `{"httpCode":"401","httpMessage":"Unauthorized","moreInformation":"<diagnostic>"}`.
  A subsequent normal bank-UI overview request returned HTTP 200 and displayed
  the accounts. Thus a path-only change is insufficient for that exercised
  request; this does not isolate which additional headers are required.
- The decoded proof metadata identifies `typ: "dpop+jwt"` and `alg: "PS256"`,
  with a public `jwk`. Claims include `htu`, `htm`, `jti`, `iat`, and `ath`.
  The observed statement POST and list GET use a relative API pathname for `htu`,
  without the query string. No live proof, token, or public/private key material
  is retained here.
- `sessionStorage.sessionTokens` has access/refresh/ID-token field names and expiry
  metadata. Its `accessToken` value was empty in the inspected page. The bank's
  public application code stores the access token on an in-memory service property
  while writing an empty access-token field to session storage.
- The bank's public web signing implementation reads `biometric-plugin` IndexedDB,
  store `dpop-keys`, keyed by `userId`. The active record corresponds to the
  JSON-decoded `localStorage.dpopUserId`. It contains a public JWK and a
  non-exportable signing `CryptoKey` using RSA-PSS/SHA-256; the public signer uses
  a 32-byte salt.
- Session expiry has required signing in again. A normal page reload performs
  the refresh-token exchange described below.
- The observed checking and savings PDF GETs did **not** send `Authorization` or
  `DPoP`. They carried normal cookies/UI headers and the document query references.
  Do not carry the summary/list authentication assumptions over to PDF downloads.

### Access-token issuance and page-reload recovery

The access token is issued in a JSON HTTP response, not recovered as a persistent
access-token value from the page's storage.

**Endpoint**: `POST https://authentication.bmo.com/isvaop/oauth2/token`

**Observed request type**: `application/x-www-form-urlencoded`.

Two bank-driven flows were captured:

| Action | Grant type | Observed form field names |
| ------ | ---------- | ------------------------- |
| Complete interactive sign-in | `authorization_code` | `code`, `code_verifier`, `client_id`, `grant_type`, `redirect_uri` |
| Reload an authenticated bank page | `refresh_token` | `refresh_token`, `code_verifier`, `client_id`, `grant_type`, `redirect_uri` |

Both returned HTTP 200 with this field structure:

```json
{
  "access_token": "<access-token>",
  "expires_in": 609,
  "id_token": "<id-token>",
  "refresh_token": "<refresh-token>",
  "scope": "<scope>",
  "token_type": "DPoP"
}
```

`expires_in` was approximately ten minutes in the observed responses; this is not
an independently measured lifetime guarantee.

The reload was correlated without recording token values:

1. The request's `refresh_token` matched the value in
   `sessionStorage.sessionTokens.refreshToken` before reload.
2. The response's `access_token` matched the token used in the subsequent
   successful `getMySummary` request's `Authorization: dpop ...` header.
3. The response's `refresh_token` matched session storage after reload and differed
   from the pre-reload token: refresh-token rotation was observed.
4. `sessionStorage.sessionTokens.accessToken` remained empty before and after.
   The public token-storage service keeps access-token data on its in-memory
   `_accessToken` property and blanks that field when serializing the other token
   metadata to session storage.

For the observed refresh request, `client_id` matched
`JSON.parse(localStorage.ciam_mfe).clientId`, and `redirect_uri` matched its
`callbackUrl`. `code_verifier` was present but empty for this refresh request;
this does not establish its source or necessity in the initial sign-in flow.

The token request carried a PS256 `DPoP` proof, with `htu`, `htm`, `jti`, and
`iat`, and no `Authorization` header. Its `htu` was the **absolute token endpoint
URL**, unlike the relative path in business API proofs. No `ath` claim or response
`DPoP-Nonce` header was observed in this exchange.

An extension-initiated refresh returned HTTP 200 and its new access token succeeded
on summary requests. However, subsequent bank-UI account-detail requests using the
previous bank-issued access token returned HTTP 401 while its JWT `exp` was still
approximately seven minutes in the future. Merely updating the rotated refresh
token in storage does not keep the page's in-memory access token usable. This
rules out independent refresh as a compatible integration strategy for the
observed session.

### Existing page token-sharing events

The bank's public application code registers a listener for
`TRANSMIT_CLIENT_ACCESS_TOKEN_REQUEST` through its `customEventService`. That
service uses `window.dispatchEvent(new CustomEvent(name, {detail: payload}))`.
The listener answers with `TRANSMIT_CLIENT_ACCESS_TOKEN_RESPONSE`, whose detail
has `action: "response"`, `accessToken`, and `idToken`, reading the current
`ciamService.tokens` instead of starting a new token refresh.

A read-only event probe received that response with a populated access-token
field. This offers a way to request the page's existing token without exporting
the value to reports, intercepting network requests, or rotating refresh tokens.
The normal isolated content script also consumed this response and used the token
for successful summary and checking/savings statement-list requests. The bank UI
continued to retrieve account details and reload its overview after these requests.
No additional token-endpoint request was observed during the extension's scoped
operations. A subsequent extension account refresh also succeeded after the bank
page reloaded, without another token-endpoint request. Missing/unusable responses
remain explicit session errors.

## API Endpoints

### 1. Get Account Summary

**Purpose**: Retrieve comprehensive account summary including customer information, all bank accounts, credit cards, loans, mortgages, and investments with balances and details.

**Endpoint**: `POST /api/cdb/customer-product-and-service-directory/mysummary/getMySummary`

**Observed Request Headers** (not a proven minimal set):

- `Content-Type`: `application/json` - Indicates JSON payload
- `Accept`: `application/json, text/plain, */*` - Accepts JSON response
- `X-XSRF-TOKEN`: CSRF protection token from `XSRF-TOKEN` cookie
- `X-ChannelType`: `OLB` (Online Banking) - Channel identifier
- `X-Request-ID`: Unique request identifier (format: `REQ_` + random hex)
- `X-UI-Session-ID`: UI session identifier (typically `0.0.1`)
- `Cookie`: Session cookies including `JSESSIONID`, `PD-S-SESSION-ID`, `XSRF-TOKEN`, `PMData`
- `Authorization`: `dpop <access-token>`
- `DPoP`: `<signed-proof>`
- Additional observed session/device headers are described above.

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
      "mfaDeviceToken": "<mfa-device-token>"
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
      "mfaDeviceToken": "<mfa-device-token>",
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
- `GetMySummaryRs.HdrRs.mfaDeviceToken`: Returned MFA device token; the bank manages
  its session. Cookie-update requirements have not been isolated.
- `GetMySummaryRs.BodyRs.categories[]`: Array of account categories
  - `categories[].products[]`: Individual accounts
    - `accountIndex`: Zero-based index for API #2 (required)
    - `accountNumber`: Display account number (format: `"{transit} {account}"`)
    - `productName`: Account type ("Chequing", "Savings", etc.)
    - `menuOptions`: Check for `"VIEW_ESTATEMENTS"` to verify eStatement support

---

### 2. Get E-Statements Encrypted Data

**Purpose**: Retrieve encrypted token for a specific account. This token must be passed to the decryption endpoint to get the actual statement list.

**Endpoint**: `POST /api/cdb/document-services/estatements/getEStatementsEncryptedData`

**Observed UI action**: Open a checking account and select its Statements tab.
The current request uses `acctType: "BA"` and `inquiryAccountIndex: 0`, sourced
from the selected product's summary category and account index. It returns HTTP
200 and `HdrRs.callStatus: "Success"`. The observed checking response has
`isConsolidated: "N"`, an empty `memberAccountsList`, and an opaque `ecryptedData`
string. Treat the historical `/banking/services/estatements/` route as superseded.

**Request authentication**: The bank-owned access token and DPoP proof are used
here as in the summary request, not just the historical cookie/UI headers.

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
      "mfaDeviceToken": "<mfa-device-token>"
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
      "mfaDeviceToken": "<mfa-device-token>",
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
      "ecryptedData": "<statement-list-reference>"
    }
  }
}
```

**Response Structure**:

- `GetEStatementsEncryptedDataRs.HdrRs.callStatus`: `"Success"` or error status
- `GetEStatementsEncryptedDataRs.BodyRs.ecryptedData`: Opaque statement-list reference (note the spelling)

**Important Notes**:

- Pass the `ecryptedData` value to API #3 for server-side decryption
- No client-side decryption needed

---

### 3. Get Statement List (Decrypt Encrypted Data)

**Purpose**: Exchange the opaque reference from API #2 for the list of available statements.

**Endpoint**: `GET /api/cdb/document-services/WebContentManager/getEDocumentsJSONList`

**Query Parameters**:

- `encrypted_data`: The opaque string from `GetEStatementsEncryptedDataRs.BodyRs.ecryptedData`

**Example URL**:

```
GET https://www1.bmo.com/api/cdb/document-services/WebContentManager/getEDocumentsJSONList?encrypted_data=<statement-list-reference>
```

**Observed Request Headers** (not a proven minimal set):

```
Authorization: dpop <access-token>
DPoP: <signed-proof>
Cookie: JSESSIONID={session-id}; XSRF-TOKEN={token}; APIC-XSRF-TOKEN={token}; ...
User-Agent: Mozilla/5.0 ...
```

**Response Sample**:

```json
{
  "eDocuments": [
    {
      "date": "2025-10-17",
      "dummyParams": "<document-reference-1>",
      "token": "<document-token>",
      "econfirmation": "false"
    },
    {
      "date": "2025-09-18",
      "dummyParams": "<document-reference-2>",
      "token": "<document-token>",
      "econfirmation": "false"
    },
    {
      "date": "2025-08-18",
      "dummyParams": "<document-reference-3>",
      "token": "<document-token>",
      "econfirmation": "false"
    }
  ]
}
```

**Response Structure**:

- `eDocuments[]`: Array of available statements
  - `date`: Statement date (`YYYY-MM-DD`)
  - `dummyParams`: Opaque reference for this statement (required for API #4)
  - `token`: Authorization token (shared across all statements in this response)

**Key Points**:

- Use `dummyParams` and `token` from each statement to download PDFs (API #4)
- The current checking request returned HTTP 200 with 11 `eDocuments` entries
  spanning two calendar years. The UI initially showed only the selected year's
  six entries; a year filter is not evidence of API pagination.
- The savings flow used the same reference/list endpoints with
  `acctType: "BA"` and `inquiryAccountIndex: 1`. The reference response was
  successful and nonconsolidated with no member accounts; its list contained
  eight documents across two years, with three visible in the selected year.
- Switching accounts can leave the previous account's hidden panels in the DOM.
  Compare only the currently visible statement panel, not all page links.
- Entries contain `date`, `dummyParams`, `token`, and `econfirmation`. Dates use
  `YYYY-MM-DD`; download identifiers and tokens are strings. Preserve the values
  returned for the selected document without inferring their format.
- Historical captures described `token` as changing on every call. Rotation and
  expiry were not isolated in the current investigation, so do not rely on a
  particular lifetime or reuse guarantee.

---

## Statement Download Flow

The complete PDF statement download flow:

1. Call `getMySummary` (API #1) to get account list and verify eStatement support via `menuOptions`
2. Call `getEStatementsEncryptedData` (API #2) to get encrypted token
3. Call `getEDocumentsJSONList` (API #3) with encrypted token to get statement list
4. For each statement, call `DownloadEStatementInPDFBOSServlet` (API #4) with `dummyParams` and `token`

### 4. Download Statement PDF

**Purpose**: Download a specific statement as a PDF file.

**Endpoint**: `GET /api/cdb/document-services/WebContentManager/DownloadEStatementInPDFBOSServlet`

**Observed UI action**: Click the latest checking or savings statement link in the bank's
Statements tab. The browser saved a PDF through this endpoint with HTTP 200 and
`Content-Type: application/pdf`. Its query contained only `dummyParams`, `token`,
and `econfirmation=false`. Both captured download requests omitted `Authorization`
and `DPoP`; `Sec-Fetch-Mode` was `cors` and `Sec-Fetch-Dest` was `empty`.
Do not assume one authentication/header recipe applies to every endpoint.

**Query Parameters**:

- `dummyParams`: Statement reference from `eDocuments[].dummyParams`
- `token`: Document token from `eDocuments[].token`
- `econfirmation`: Confirmation flag (typically `"false"`)

**Example URL**:

```
GET https://www1.bmo.com/api/cdb/document-services/WebContentManager/DownloadEStatementInPDFBOSServlet?dummyParams=<document-reference>&token=<document-token>&econfirmation=false
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

## Shared contract mapping and remaining evidence gaps

The existing [BMO module](../bank/bmo.mjs) maps the retained data shapes to the
[shared bank contract](../bank/bank.types.ts):

- `Profile.sessionId` comes from the readable `XSRF-TOKEN` cookie.
  `GetMySummaryRs.BodyRs.credential` supplies `profileId`; `customerName`, or
  `firstName` and `lastName`, supplies `profileName`.
- Accounts are products whose `menuOptions` contains `VIEW_ESTATEMENTS`.
  `accountId` combines the enclosing `categoryName` and `accountIndex`;
  these also supply the statement-reference request's `acctType` and
  `inquiryAccountIndex`. They are session-context selectors, not established
  permanent identifiers.
- `productName` (with `ocifAccountName` as fallback) supplies `accountName`.
  The last four digits of `accountNumber`, ignoring formatting, supply
  `accountMask`. Category and product name determine the contract account type.
- Each document's `date` supplies the ISO statement date; `dummyParams` and
  `token` are serialized together as the statement identifier and passed back
  unchanged in the PDF query. The browser response body supplies the PDF Blob.

The data-field mappings remain consistent with the checking/savings UI evidence.
The current module uses the observed API paths and the bank-owned token interface
described above, while PDF downloads use document references and cookies.

Remaining gaps are the exact minimum required headers, statement-reference expiry
and reuse guarantees, and unobserved account types and consolidated flows. The
extension does not implement refresh or relogin; those remain bank-page operations.

## Integration direction

Use the bank's existing token-sharing events from the normal BMO content-script
module. Obtain the current token for each JSON request and create the observed
DPoP proof using the browser's existing non-exportable key. Bound the IndexedDB
lookup so blocked storage does not leave authentication pending, and verify the
session again after signing, immediately before sending the request. The extension
must not perform its own refresh-token exchange, change the bank's session storage,
install a main-world helper, or intercept the bank's network requests.

Only the access token is needed from the event response; do not persist or report
either token. Missing event responses and rejected authenticated requests must
surface as errors, not trigger independent refresh. Session recovery belongs on
the bank page through reload/sign-in. PDF downloads continue to use their returned
document references and ordinary page cookies without DPoP.
