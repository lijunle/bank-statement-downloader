# Bank of America Statement Retrieval

Concise reference for downloading Bank of America statements (checking, savings, credit card) via extension code.

## Core Findings (Latest)

1. Single PDF endpoint (`/mycommunications/omni/statements/rest/v1/docViewDownload`) works for all account types.
2. A fresh `gatherDocuments` call (same account + target year) immediately before each PDF download improves reliability (refreshes session/cookie state).
3. `docCategoryId = DISPFLD001` is required for monthly statements.
4. `Referer` cannot be set manually and is not needed.
5. Failed downloads return small HTML (<100KB) instead of PDF; validate by size + `content-type`.
6. The `adx` (64‑hex) + `docId` pair uniquely identifies a statement for download.
7. Account type is inferred from `creditCardAccountIndicator` but is no longer needed for endpoint selection.

## Authentication Summary

Use existing logged-in browser context; rely on automatic inclusion of cookies (`SMSESSION`, `SSOTOKEN`, `CSID`, etc.). No manual token extraction required (except optional reading `CSID` for profile tracking). Always send `credentials: 'include'`.

## API Endpoints

### 1. Accounts Overview (Extract `adx` + Profile)

**Endpoint:** `GET /myaccounts/brain/redirect.go?target=accountsoverview`

**Purpose:** HTML page containing all accounts; parse to collect `adx` values and extract profile eligibility token (optional user identifier).

**HTTP Method:** GET

**Query Parameters:**

- `target`: `accountsoverview` - Target page to redirect to

**Headers:**

- `Accept: text/html,application/xhtml+xml,application/xml;q=0.9,*/*`
- `Upgrade-Insecure-Requests: 1`

**Required Cookies:** Same authentication cookies as other endpoints (SMSESSION, SSOTOKEN, GSID, CSID, etc.)

**Response:** HTML page containing information for all user accounts (checking, savings, credit cards, etc.)

**Extract `adx` values from:**

- Account list items with `data-adx` attributes:

  ```html
  <div
    class="AccountItem"
    data-adx="1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b1c2d3e4f5a6b7c8d9e0f1a2b"
  ></div>
  ```

- Account detail links with `adx` query parameters:

  ```html
  <a
    href="/myaccounts/brain/redirect.go?target=acctDetails&adx=1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b1c2d3e4f5a6b7c8d9e0f1a2b"
  ></a>
  ```

- JavaScript data embedded in the page:
  ```javascript
  "additionalParam": "adx=1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b1c2d3e4f5a6b7c8d9e0f1a2b"
  ```

**Profile Eligibility (optional):**

Regex: `/profile\.eligibility=([A-Z0-9]+)/` → 250‑char token.

```javascript
profile.eligibility=11B111B111111B1B11BB11111111B1D11111BB111B111111BB1BB1111BB11P11B1111B1B1B11111111111111111111B11111111111111111111111111111111111BB11111BBB111111111111B11111B11111111B11B11111111111111111111111111111111111111B1111111111111111111111111111B1JAN1500E11
```

- This 250-character alphanumeric string is user-specific and represents profile/eligibility settings
- Can be used to identify the user profile
- Extract using regex: `/profile\.eligibility=([A-Z0-9]+)/`

**Notes:** Must be called first to enumerate accounts. Each `adx` is 64 hex chars.

---

### 2. Gather Documents (List Statements)

**Endpoint:** `POST /mycommunications/omni/statements/rest/v1/gatherDocuments`

**Purpose:** Returns documents (`documentList`) for given account/year; also returns all accounts.

**HTTP Method:** POST

**Headers:**

- `Content-Type: application/json;charset=UTF-8`
- `Accept: */*`
- `Accept-Language: en-US`
- `Origin: https://secure.bankofamerica.com`
- `X-Requested-With: XMLHttpRequest`
- `Sec-Fetch-Dest: empty`
- `Sec-Fetch-Mode: cors`
- `Sec-Fetch-Site: same-origin`

**Cookies:** Automatically included via `credentials: 'include'`.

**Request Body (monthly statements):**

```json
{
  "adx": "1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b1c2d3e4f5a6b7c8d9e0f1a2b",
  "year": "2025",
  "docCategoryId": "DISPFLD001"
}
```

Other category IDs: `DISPFLD002`, `DISPFLD003`, `DISPFLD010` (not needed for standard statements).

**Response:** JSON containing account list, document list, and metadata

**Minimal Response Example:**

```json
{
  "documentList": [
    {
      "insertList": [],
      "docTypeId": "CRDMNST001",
      "docId": "202509741025091806453836866421121161",
      "docDisplayName": "September Statement",
      "productCode": "CCP",
      "source": "GCA",
      "archivedIndicator": false,
      "adx": "1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b1c2d3e4f5a6b7c8d9e0f1a2b",
      "accountDisplayName": "Cash Rewards XX 5678",
      "docCategory": "Statements",
      "docCategoryId": "DISPFLD001",
      "date": "2025-09-18T00:00:00.000+0000",
      "dateString": "Sep 18, 2025",
      "docColorCode": "#0467B6",
      "isDownloadOnly": false
    },
    {
      "insertList": [],
      "docTypeId": "CRDMNST001",
      "docId": "202508281025081706564947977532232272",
      "docDisplayName": "August Statement",
      "productCode": "CCP",
      "source": "GCA",
      "archivedIndicator": false,
      "adx": "1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b1c2d3e4f5a6b7c8d9e0f1a2b",
      "accountDisplayName": "Cash Rewards XX 5678",
      "docCategory": "Statements",
      "docCategoryId": "DISPFLD001",
      "date": "2025-08-18T00:00:00.000+0000",
      "dateString": "Aug 18, 2025",
      "docColorCode": "#0467B6",
      "isDownloadOnly": false
    }
  ],
  "accountList": [
    {
      "locationList": [],
      "accountDisplayName": "Cash Rewards XX 5678",
      "productCode": "CCP",
      "productSubCode": "ZZ",
      "groupCode": "CCA",
      "adx": "1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b1c2d3e4f5a6b7c8d9e0f1a2b",
      "selected": true,
      "requestStmtEligibleIndicator": true,
      "creditCardAccountIndicator": true
    },
    {
      "locationList": [],
      "accountDisplayName": "Checking",
      "productCode": "PER",
      "productSubCode": "SD",
      "groupCode": "DDA",
      "adx": "2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b1c2d3e4f5a6b7c8d9e0f1a2b3c",
      "selected": false,
      "requestStmtEligibleIndicator": true,
      "creditCardAccountIndicator": false
    }
  ],
  "documentCategoryList": [
    {
      "docCategoryName": "Statements",
      "docCategoryId": "DISPFLD001",
      "colorCode": "#0467B6",
      "isDownloadOnly": false
    },
    {
      "docCategoryName": "Credit Card Year-end Summary",
      "docCategoryId": "DISPFLD003",
      "colorCode": "#00A9E0",
      "isDownloadOnly": false
    },
    {
      "docCategoryName": "Notifications and Letters",
      "docCategoryId": "DISPFLD002",
      "colorCode": "#F5BD20",
      "isDownloadOnly": false
    },
    {
      "docCategoryName": "Other Account Documents",
      "docCategoryId": "DISPFLD010",
      "colorCode": "#9b9b9b",
      "isDownloadOnly": false
    }
  ],
  "yearList": ["2025", "2024", "2023", "2022", "2021", "2020", "2019", "2018"],
  "errorInfo": [],
  "status": "SUCCESS",
  "adaEnabledIndicator": false,
  "oboUserIndicator": false,
  "familyBankingYouthFlag": false,
  "requestedStmtsIndicator": false
}
```

**Important Fields:**

- `documentList[].docId` (needed for download)
- `documentList[].date` / `dateString`
- `accountList[].adx`
- `accountList[].creditCardAccountIndicator` (informational only)
- `status` must be `SUCCESS`.

**Notes:** Call for multiple years (e.g. current year and previous two). Use fresh call before each download (see below).

---

### 3. Download PDF

**Endpoint:** `GET /mycommunications/omni/statements/rest/v1/docViewDownload`

**Purpose:** Retrieve binary PDF.

**HTTP Method:** GET

Query params: `adx`, `documentId`, `adaDocumentFlag=N`, `menuFlag=download`, `request_locale=en-US`.

**Headers:**

- `Accept: text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8`
- `Accept-Language: en-US`
- `Sec-Fetch-Dest: document`
- `Sec-Fetch-Mode: navigate`
- `Sec-Fetch-Site: same-origin`
- `Sec-Fetch-User: ?1`

**Required Cookies:** Same as Gather Documents API

**Response:**

- Content-Type: `application/pdf`
- Content-Disposition: `attachment; filename=eStmt-2025-09-18.pdf`
- Binary PDF file data

**Notes:** Always call `gatherDocuments` with matching year immediately before downloading. Validate by size + content type.

---

## Minimal Flow

1. Fetch overview → parse `adx` set.
2. For each target year: `gatherDocuments(adx, year, DISPFLD001)` → collect `docId`s.
3. Before downloading each statement: repeat `gatherDocuments(adx, statementYear)`.
4. Download via `docViewDownload`.
5. Validate: size > ~100KB AND `content-type` includes `pdf`.

```javascript
await gatherDocuments(adx, year); // build list
await gatherDocuments(adx, stmtYear); // refresh before download
const pdf = await downloadPdf(adx, docId);
if (pdf.size < 100000 || !contentType.includes("pdf"))
  throw new Error("Bad download");
```

## Security Notes

Rely on browser-managed cookies (HttpOnly + Secure). No custom header hacks needed.

## Document Categories (Reference)

- `DISPFLD001`: Monthly statements (primary)
- Others: `DISPFLD002`, `DISPFLD003`, `DISPFLD010` (not currently used)

## Quick Implementation Checklist

- Parse overview → collect `adx`.
- Loop years → `gatherDocuments` for statements.
- Refresh via `gatherDocuments` before each download.
- Download with navigation headers.
- Validate blob.

---

Last updated: aligned with unified download endpoint + pre-download refresh behavior.
