# BMO Statement API Analysis

**Analysis as of:** 2026-09-25

## Scope and evidence

**Bank ID:** `bmo`
**Domains:** `https://www1.bmo.com` hosts account servicing and business APIs;
`https://authentication.bmo.com` issues the bank page's OAuth tokens.

| Account type / flow | Evidence basis and source | Scope boundary |
| --- | --- | --- |
| Checking and savings | Observed: authenticated overview, selected account's Statements tab and PDF link | Nonconsolidated `BA` accounts, summary, statement references, lists and PDFs |
| Cards, loans, investments | Code-derived: [BMO module](../bank/bmo.mjs) category mapping | Populated products and document flows are untested |
| Consolidated statements | Unverified | Group/member selection rules need evidence |

## Authentication and session context

**Session ownership:** let the bank page establish and renew authentication.
The module requests its current access token through OP-1 and signs business JSON
requests through OP-2. Session recovery is a bank-page reload/sign-in operation.
**Execution context:** the normal isolated content script on `www1.bmo.com` reads
the page's accessible storage and events. All business requests include browser
credentials. PDF retrieval uses document references and cookies, while JSON
operations also carry `Authorization: dpop <access-token>` and `DPoP`.

| Material / context | Source | Use |
| --- | --- | --- |
| Session association / XSRF | Decoded `XSRF-TOKEN` cookie | Shared session ID, POST `X-XSRF-TOKEN`, OP-2 session check |
| Active user ID | JSON-decoded `localStorage.dpopUserId` | Select OP-2 signing record and detect user changes |
| Current access token | Bank service's event response in OP-1 | Authorization and proof token hash |
| Signing key | Existing IndexedDB record in OP-2 | RSA-PSS proof signing |
| MFA device value | Decoded `PMData` cookie | POST envelope `HdrRq.mfaDeviceToken` |

**Bank-owned token lifecycle (Observed):** the page calls
`POST https://authentication.bmo.com/isvaop/oauth2/token` with
`application/x-www-form-urlencoded`.

- Interactive sign-in uses `grant_type=authorization_code`, `code`,
  `code_verifier`, `client_id`, and `redirect_uri`. Authorization-code/PKCE
  acquisition details are outside the module's flow.
- Reload uses `grant_type=refresh_token`, the stored
  `sessionStorage.sessionTokens.refreshToken`, `client_id` and `redirect_uri`
  matching JSON-decoded `localStorage.ciam_mfe.clientId` and `.callbackUrl`.
  The observed reload form includes an empty `code_verifier`.
- The response contains `access_token`, rotated `refresh_token`, `id_token`,
  `token_type: "DPoP"`, `expires_in`, and `scope`. The observed advertised lifetime
  is about ten minutes; effective validity is controlled by the bank.
- The page keeps the access token in its in-memory service and serializes an empty
  `sessionTokens.accessToken`. OP-1 obtains the usable token.
- The token endpoint's PS256 proof uses its absolute URL as `htu`, plus `htm`,
  `jti`, and `iat`; the observed exchange uses neither `ath` nor Authorization.
  This differs from the business proof defined in OP-2.

The integration leaves token exchange and storage updates to the bank. Exact
minimum headers and token/reference reuse guarantees are Unknown.

## API flow

**Sequence:** before every JSON request, OP-1 obtains the page token and OP-2 signs
the target request. OP-3 supplies profile/accounts, OP-4 obtains the selected
account's list reference, OP-5 exchanges it for documents, and OP-6 fetches one PDF.
OP-6 uses neither OP-1 nor OP-2.

### OP-1: Request the page's current access token

**Evidence basis:** Observed: bank token-sharing events; Code-derived: public
`initTransmitClientAccessTokenListener` and module `getAccessToken`.
**Context and prerequisites:** authenticated `www1.bmo.com` page with the bank's
event listener initialized.
**Source and extraction:**

1. Subscribe on `window` to `TRANSMIT_CLIENT_ACCESS_TOKEN_RESPONSE`.
2. Dispatch `TRANSMIT_CLIENT_ACCESS_TOKEN_REQUEST`; an ordinary `Event` with no
   detail is sufficient.
3. Accept the bank's `CustomEvent.detail` when `action === "response"`:

```json
{"action":"response","accessToken":"<access-token>","idToken":"<id-token>"}
```

**Outputs:** retain only a nonempty string `accessToken` in the request context.
**Errors and empty results:** ignore unrelated actions. Reject missing tokens,
dispatch errors or a five-second response timeout; remove the listener and timer.
**State and timing:** request the current token for each JSON operation. The event
is page-visible, not a cryptographically authenticated channel. Tokens remain
local to the request and are excluded from profile/account output.

### OP-2: Read the existing key and sign the JSON request

**Evidence basis:** Observed: key storage and proof format in the bank application;
Code-derived: module signing and bounded reads.
**Context and prerequisites:** capture the active user ID and XSRF session before
OP-1. Use the current token, target API URL and HTTP method.
**Source and extraction:** open IndexedDB `biometric-plugin`, use a readonly
transaction on `dpop-keys`, and retrieve the record keyed by the active user ID.
The record's `userId` corresponds to JSON-decoded `localStorage.dpopUserId`.
Its `jwk` is a public JSON Web Key and `privateKey` is a non-exportable Web Crypto
`CryptoKey` using RSA-PSS/SHA-256 with `sign` usage.

**Response and processing:** construct a PS256 JWT using:

| Part | Value / source |
| --- | --- |
| Header | `typ: "dpop+jwt"`, `alg: "PS256"`, public `jwk` from the record |
| `htu` | Relative business API pathname, excluding query string |
| `htm` | Actual HTTP method |
| `jti` | Fresh random UUID |
| `iat` | Current epoch seconds as an integer |
| `ath` | Base64url SHA-256 hash of the UTF-8 access token |
| Signature | RSA-PSS, salt length 32 bytes; sign the base64url header/payload joined by a dot |

Serialize the header and payload as UTF-8 JSON and base64url-encode each without
padding. Sign the UTF-8 bytes of `encodedHeader.encodedPayload`, then append the
base64url-encoded signature as the third dot-separated JWT component.

**Outputs:** set `Authorization: dpop <access-token>` and `DPoP: <signed-proof>`.
**Errors and empty results:** report missing/blocked database, store, record, or
unsupported key as errors. Bound open/read operations to five seconds, close
connections, and abort a pending read on timeout. Abort creation if opening the
database would require an upgrade.
**State and timing:** after signing, reread user/session identifiers immediately
before fetch. Reject a changed context rather than sending the prepared request.
Use the existing key; key provisioning remains the bank's responsibility.

### OP-3: Read account summary and profile

**Evidence basis:** Observed: account overview calls `getMySummary`.
**Context and prerequisites:** authenticated page; prepare OP-1/OP-2.
**Request:** `POST https://www1.bmo.com/api/cdb/customer-product-and-service-directory/mysummary/getMySummary`,
JSON body:

```json
{
  "MySummaryRq": {
    "HdrRq": {
      "ver": "1.0",
      "channelType": "OLB",
      "appName": "OLB",
      "hostName": "BDBN-HostName",
      "clientDate": "2000-03-01T00:00:00.000",
      "rqUID": "REQ_0000000000000001",
      "clientSessionID": "session-id",
      "userAgent": "<browser-user-agent>",
      "clientIP": "127.0.0.1",
      "mfaDeviceToken": "<PMData-value>"
    },
    "BodyRq": {"refreshProfile":"N"}
  }
}
```

**Inputs:** the example's constants are module request values. Generate `clientDate`
from current UTC ISO time without its `Z`, and a fresh `REQ_`-prefixed random-hex
`rqUID`; use `navigator.userAgent` and decoded `PMData` (empty if unavailable).

**Headers:** in addition to OP-2, the module POST helper supplies:

| Header | Value / source |
| --- | --- |
| `Content-Type` / `Accept` | `application/json` / `application/json, text/plain, */*` |
| `X-XSRF-TOKEN` | Decoded session cookie |
| `X-ChannelType` / `X-UI-Session-ID` | `OLB` / `0.0.1` |
| `X-Request-ID` | Same value as body `HdrRq.rqUID` |
| `X-App-Version` / `X-App-Current-Path` | `session-id` / `/banking/digital/accounts` |
| `X-Original-Request-Time` | Current UTC date string |

The bank UI also sends session/device headers such as `x-bmo-user-session-id`,
`x-bmo-device-fingerprint`, and `x-bmo-mfa-device-token`. Their individual
necessity is Unknown; the table describes the module's request context.

**Response and processing:** HTTP 200 JSON:

```json
{
  "GetMySummaryRs": {
    "HdrRs": {"callStatus":"Success"},
    "BodyRs": {
      "credential":"<profile-id>",
      "customerName":"Test User",
      "categories":[{
        "categoryName":"BA",
        "products":[{
          "accountIndex":0,
          "productName":"Chequing",
          "accountNumber":"0000 0001-234",
          "menuOptions":"VIEW_ESTATEMENTS,CHANGE_STATEMENT_OPTION"
        }]
      }]
    }
  }
}
```

**Outputs:** profile fields and category/product account selectors.
**Selection and association:** include products whose `menuOptions` contains
`VIEW_ESTATEMENTS`; combine category and product index as `BA:0`, for example.
`categoryName` and `accountIndex` are selectors within the current session;
their stability across sessions is Unknown. The module calls this shared operation
for both profile and account retrieval.
**Errors and empty results:** report HTTP errors and non-`Success` call status.
Code-derived: absent category/product arrays become empty collections; missing
profile fields use the defaults listed in the contract table.
**Pagination and statement coverage:** no continuation parameter is established.

### OP-4: Obtain an account's statement-list reference

**Evidence basis:** Observed: checking/savings Statements tabs.
**Context and prerequisites:** selected OP-3 account; prepare OP-1/OP-2.
**Request:** `POST https://www1.bmo.com/api/cdb/document-services/estatements/getEStatementsEncryptedData`.
Use OP-3's `HdrRq` construction and POST headers with this envelope/body:

```json
{
  "EStatementsEncryptedDataRq": {
    "HdrRq": {"rqUID":"REQ_0000000000000002"},
    "BodyRq": {"acctType":"BA","inquiryAccountIndex":0}
  }
}
```

The example abbreviates `HdrRq`; supply its full OP-3 fields in the request.
**Inputs:** split shared `accountId` into category and numeric index.
**Response and processing:** HTTP 200 JSON:

```json
{
  "GetEStatementsEncryptedDataRs": {
    "HdrRs":{"callStatus":"Success"},
    "BodyRs":{
      "isConsolidated":"N",
      "memberAccountsList":[],
      "mainAccount":{"name":"Chequing","number":"0000 0001-234"},
      "ecryptedData":"<statement-list-reference>"
    }
  }
}
```

**Outputs:** opaque `ecryptedData` with the bank's exact spelling.
**Errors and empty results:** require successful call status and a nonempty
reference; report failure before OP-5.
**State and timing:** obtain the reference for the selected account. Consolidated
group handling and reference expiry/reuse rules are Unknown.

### OP-5: Exchange the reference for a document list

**Evidence basis:** Observed: selected account's Statements tab loads document dates.
**Context and prerequisites:** OP-4 reference; prepare OP-1/OP-2 for this GET.
**Request:** `GET https://www1.bmo.com/api/cdb/document-services/WebContentManager/getEDocumentsJSONList?encrypted_data=<encoded-reference>`.
URL-encode the entire reference once; body is empty. Use
`Accept: application/json, text/plain, */*` plus OP-2 headers and credentials.
**Response and processing:** HTTP 200 JSON:

```json
{"eDocuments":[{"date":"2000-03-31","dummyParams":"<document-reference>","token":"<document-token>","econfirmation":"false"}]}
```

**Outputs:** document date and exact `dummyParams`/`token` pair.
**Selection and association:** associate all returned documents with OP-4's
selected account. For UI evidence, use the visible selected-account panel;
inactive panels can remain in the DOM.
**Errors and empty results:** surface HTTP and parse failures. Code-derived:
the module maps absent/falsy `eDocuments` to an empty list; schema guarantees
for such responses are Unknown.
**Pagination and statement coverage:** the returned array spans calendar years;
the UI filters a year from that array. The module retains the response order and
converts each `YYYY-MM-DD` date to ISO. Retention guarantees are Unknown.

### OP-6: Download the selected PDF

**Evidence basis:** Observed: checking/savings PDF links on the Statements tab.
**Context and prerequisites:** selected OP-5 document; browser cookies and document
references supply this operation's request context.
**Request:** `GET https://www1.bmo.com/api/cdb/document-services/WebContentManager/DownloadEStatementInPDFBOSServlet`
with individually URL-encoded `dummyParams` and `token`, and `econfirmation=false`.
Use `Accept: application/pdf`, an empty body and browser credentials. Authorization
and DPoP are omitted for this PDF flow.
**Response and processing:** HTTP 200, `application/pdf`, binary body.
**Delivery and outputs:** read the response as a Blob.
**Errors and empty results (Code-derived):** report HTTP failures or a Blob whose
MIME is not `application/pdf` or whose first bytes are not `%PDF-`.

## Shared contract mapping

| Contract field / flow | Source operation and field | Meaning, conversion and runtime checks |
| --- | --- | --- |
| Profile.sessionId | Authentication `XSRF-TOKEN` | Session association; used for context-change detection |
| Profile.profileId | OP-3 `GetMySummaryRs.BodyRs.credential` | Default to an empty string when absent |
| Profile.profileName | OP-3 `GetMySummaryRs.BodyRs.customerName`, `firstName`, `lastName` | Use customerName when populated; otherwise join firstName and lastName with a space and trim the result, treating missing components as empty |
| Account.profile / Statement.account | Caller profile / selected account | Preserve association |
| Account.accountId / accountName | OP-3 `categories[].categoryName` and `products[].accountIndex` / `products[].productName` | Session-context `categoryName:accountIndex`; name falls back to `ocifAccountName`, then `Unknown Account` |
| Account.accountMask | OP-3 `accountNumber` | Remove nondigits and take last four; missing source yields empty mask |
| Account.accountType | OP-3 category and name | `CC -> CreditCard`, `LM -> Loan`, `IN -> Investment`; checking/savings name matching for BA, default Checking |
| Statement.statementId | OP-5 `dummyParams`, `token` | Serialize pair as JSON for OP-6 |
| Statement.statementDate | OP-5 `date` | ISO conversion of calendar date |
| Downloaded Blob | OP-6 | Direct PDF body with MIME/signature guards |

## Limitations and open questions

- **Untested:** cards, loans, investments and consolidated statements. Their OP-4
  selectors, member associations and document routing need product-specific evidence.
- **Unknown:** exact minimum request headers, token/proof expiry behavior beyond
  the page-owned lifecycle, and OP-4/OP-5 reference/token lifetimes.
- **Unknown:** completeness semantics for missing collections and account fields
  in OP-3/OP-5. The code-derived defaults above are not a bank error contract.
