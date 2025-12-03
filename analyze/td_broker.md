# TD Direct Investing (WebBroker) API Analysis

## Bank Information

- **Bank ID**: `td_broker`
- **Bank Name**: TD Direct Investing (WebBroker)
- **Bank URL**: https://webbroker.td.com/
- **HAR File**: `analyze/td_broker_1764055743651.har`
- **Validation Status**: ✅ Validated on 2025-11-25

## Session Identification

### Session Cookie

The session is maintained via HTTP cookies. The primary session cookies are:

| Cookie Name          | Description                                  | HttpOnly |
| -------------------- | -------------------------------------------- | -------- |
| `JSESSIONID`         | Java session ID for the application server   | Yes      |
| `WBT-JSESSIONID`     | WebBroker session ID (mirrors JSESSIONID)    | Yes      |
| `com.td.wb.SSO_GUID` | SSO GUID token containing authorization info | Yes      |
| `XSRF-TOKEN`         | CSRF protection token                        | No       |
| `com.td.last_login`  | Last login timestamp                         | No       |

**Important**: The session cookies (`JSESSIONID`, `WBT-JSESSIONID`, `com.td.wb.SSO_GUID`) are HttpOnly and cannot be accessed via JavaScript. Use `XSRF-TOKEN` or `com.td.last_login` to verify logged-in status. The actual session is handled automatically via `credentials: 'include'` in fetch requests.

The `com.td.wb.SSO_GUID` cookie contains an authorization token in format:

```
SOC||{timestamp}||{uuid}
```

Example: `SOC||1764055752336||2254f485-1g60-5282-b388-cc7d0dg630fc`

### Authorization Token

All API responses include an `authorizationToken` field that matches the SSO_GUID format. This token is also returned in API responses and can be used for subsequent requests.

---

## API Endpoints

### 1. Retrieve User Profile Information

**Endpoint**: `GET /waw/brk/wb/services/rest/v1/eservices/profile`

This API returns user profile information including email address and subscription status. Does not require additional parameters.

#### Request

```
GET https://webbroker.td.com/waw/brk/wb/services/rest/v1/eservices/profile?AJAXREQUEST=1
```

#### Headers

| Header   | Value                              |
| -------- | ---------------------------------- |
| `Cookie` | Session cookies (JSESSIONID, etc.) |
| `Accept` | `application/json`                 |

#### Response

The API may return responses in two formats:

**Format 1 - Wrapped Response (HAR observation)**:

```json
{
  "version": "v1.0",
  "correlationId": "1e6e0053-bf2d-37d5-4g97-30403c55b286",
  "authorizationToken": "SOC||{timestamp}||{uuid}",
  "systemTimestamp": "2025-11-25T02:30:23-0500",
  "timeTaken": 160,
  "locationId": "wmwbrjbpzpxb0.prd.vmc2.td.com",
  "errors": [],
  "warnings": [],
  "payload": {
    "connectId": "I185L5R6",
    "subscriptions": ["STATEMENT", "CONFIRMATION", "TAX"],
    "status": "REGISTERED",
    "email": "john.doe@example.com",
    "taxFreezeToDate": "2025-05-01T00:00:00-0400",
    "taxFreezeFromDate": "2025-01-01T00:00:00-0500",
    "taxFreeze": false
  },
  "links": {},
  "metaInformations": [],
  "status": "SUCCESS"
}
```

**Format 2 - Direct Payload (Browser validation)**:

```json
{
  "connectId": "I185L5R6",
  "subscriptions": ["STATEMENT", "CONFIRMATION", "TAX"],
  "status": "REGISTERED",
  "email": "john.doe@example.com",
  "taxFreezeToDate": "2025-05-01T00:00:00-0400",
  "taxFreezeFromDate": "2025-01-01T00:00:00-0500",
  "taxFreeze": false
}
```

**Note**: In Format 2, the `status` field is the user's registration status (e.g., "REGISTERED"), not an API status. Implementation should handle both formats: `data.payload || data`.

```

#### Key Fields

| Field                   | Description                                        |
| ----------------------- | -------------------------------------------------- |
| `payload.connectId`     | User's Connect ID (unique identifier)              |
| `payload.email`         | User's email address                               |
| `payload.subscriptions` | List of subscribed eServices (STATEMENT, TAX, etc) |
| `payload.status`        | Registration status                                |
| `authorizationToken`    | Session authorization token                        |
| `systemTimestamp`       | Server timestamp                                   |
| `status`                | Request status ("SUCCESS" or error)                |

---

### 2. List All Accounts

**Endpoint**: `GET /waw/brk/wb/services/rest/v2/accountsV2/account-groups`

Returns all account groups for the logged-in user. Each group can contain multiple accounts.

#### Request

```

GET https://webbroker.td.com/waw/brk/wb/services/rest/v2/accountsV2/account-groups?filter=ESERVICES_STATEMENTS_FILTER&AJAXREQUEST=1

````

#### Headers

| Header   | Value              |
| -------- | ------------------ |
| `Cookie` | Session cookies    |
| `Accept` | `application/json` |

#### Parameters

| Parameter | Value                            | Description                    |
| --------- | -------------------------------- | ------------------------------ |
| `filter`  | `ESERVICES_STATEMENTS_FILTER`    | Filter for statements          |
|           | `ESERVICES_TAX_DOCUMENTS_FILTER` | Filter for tax documents       |
|           | `ESERVICES_CONFIRMATIONS_FILTER` | Filter for trade confirmations |

#### Response

The API may return responses in two formats:

**Format 1 - Wrapped Response (HAR observation)**:

```json
{
  "version": "v1.0",
  "payload": [
    {
      "favorite": true,
      "groupNumber": "80XCK0",
      "groupId": "DEY-RICe_TlQMPKhpg_gXOpXNeqWn8f0V2OYXe2xTSR",
      "businessLine": "TD Direct Investing",
      "divisionType": "RAPID_MARKET_ACCESS",
      "tradingPlatform": "WEBBROKER",
      "accountPlatform": "DIRECT_INVESTMENT"
    }
  ],
  "status": "SUCCESS"
}
````

**Format 2 - Direct Array (Browser validation)**:

```json
[
  {
    "favorite": true,
    "groupNumber": "80XCK0",
    "groupId": "DEY-RICe_TlQMPKhpg_gXOpXNeqWn8f0V2OYXe2xTSR",
    "businessLine": "TD Direct Investing",
    "divisionType": "RAPID_MARKET_ACCESS",
    "tradingPlatform": "WEBBROKER",
    "accountPlatform": "DIRECT_INVESTMENT"
  }
]
```

**Note**: Implementation should handle both formats: `Array.isArray(data) ? data : (data.payload || [])`.

```

#### Key Fields

| Field                       | Description                                       |
| --------------------------- | ------------------------------------------------- |
| `payload[].groupId`         | Account group ID (used to fetch statements)       |
| `payload[].groupNumber`     | Display group number (e.g., "79WBJ9")             |
| `payload[].businessLine`    | Business line - used as account name              |
| `payload[].divisionType`    | Division type (e.g., "RAPID_MARKET_ACCESS")       |
| `payload[].tradingPlatform` | Trading platform (e.g., "WEBBROKER")              |
| `payload[].accountPlatform` | Account platform (e.g., "DIRECT_INVESTMENT")      |

**Account Mapping**:
- `accountId` = `groupId`
- `accountName` = `businessLine` (e.g., "TD Direct Investing")
- `accountMask` = `groupNumber` (e.g., "80XCK0")
- `accountType` = "Investment"

---

### 3. List Available Statements

**Endpoint**: `GET /waw/brk/wb/services/rest/v1/eservices/statements/{groupId}`

Returns list of available statements for an account group.

#### Request

```

GET https://webbroker.td.com/waw/brk/wb/services/rest/v1/eservices/statements/{groupId}?fromDate={fromDate}&toDate={toDate}&AJAXREQUEST=1

```

#### Path Parameters

| Parameter | Description      | Source                                        |
| --------- | ---------------- | --------------------------------------------- |
| `groupId` | Account group ID | From account-groups API (`payload[].groupId`) |

#### Query Parameters

| Parameter  | Format                | Description                     |
| ---------- | --------------------- | ------------------------------- |
| `fromDate` | `YYYY-MM-DDT00:00:00` | Start date for statement search |
| `toDate`   | `YYYY-MM-DDT00:00:00` | End date for statement search   |

#### Example

```

GET https://webbroker.td.com/waw/brk/wb/services/rest/v1/eservices/statements/DEY-RICe_TlQMPKhpg_gXOpXNeqWn8f0V2OYXe2xTSR?fromDate=2025-10-01T00:00:00&toDate=2025-10-01T00:00:00&AJAXREQUEST=1

````

#### Response

The API may return responses in two formats:

**Format 1 - Wrapped Response (HAR observation)**:

```json
{
  "version": "v1.0",
  "payload": {
    "documents": [
      {
        "documentType": "STATEMENT",
        "id": "GB70F821BFB87C59DB7532DCG3261EE6...",
        "seq": "taM2sGr1ndBxg1I-RYOKIPu56HIw74jyLFkoakRBTcV",
        "fileType": "PDF",
        "runDate": "2025-11-05T18:58:00-0500",
        "states": {
          "PERFORMANCE_AND_FEES": false,
          "REVISED": false,
          "DORMANT": false
        },
        "descriptionCode": "DIRECT_TRADE_CAD",
        "stmtDate": "2025-10-01T00:00:00-0400",
        "mimeType": "application/pdf",
        "docType": "STATEMENT",
        "groupNumber": "80XCK0",
        "rrCode": "RM01"
      }
    ]
  },
  "status": "SUCCESS"
}
````

**Format 2 - Direct Object (Browser validation)**:

```json
{
  "documents": [
    {
      "documentType": "STATEMENT",
      "id": "GB70F821BFB87C59DB7532DCG3261EE6...",
      "seq": "taM2sGr1ndBxg1I-RYOKIPu56HIw74jyLFkoakRBTcV",
      "fileType": "PDF",
      "runDate": "2025-11-05T18:58:00-0500",
      "states": {
        "PERFORMANCE_AND_FEES": false,
        "REVISED": false,
        "DORMANT": false
      },
      "descriptionCode": "DIRECT_TRADE_CAD",
      "stmtDate": "2025-10-01T00:00:00-0400",
      "mimeType": "application/pdf",
      "docType": "STATEMENT",
      "groupNumber": "80XCK0",
      "rrCode": "RM01"
    }
  ]
}
```

**Note**: Implementation should handle both formats: `data.documents || data.payload?.documents || []`.

```

#### Key Fields

| Field                         | Description                                   |
| ----------------------------- | --------------------------------------------- |
| `documents[].id`              | Statement document ID (required for download) |
| `documents[].seq`             | Sequence identifier (required for download)   |
| `documents[].stmtDate`        | Statement date                                |
| `documents[].descriptionCode` | Statement type code                           |
| `documents[].groupNumber`     | Account group number                          |

---

### 4. Download Statement PDF

**Endpoint**: `GET /waw/brk/wb/services/rest/v1/export`

Downloads the statement PDF file.

#### Request (GET Method - Inline View)

```

GET https://webbroker.td.com/waw/brk/wb/services/rest/v1/export?exportRequest={exportRequest}&exportParams={exportParams}&x-consumer-name=com-td-brk-wb-webbroker

```

#### Request (POST Method - Download)

```

POST https://webbroker.td.com/waw/brk/wb/services/rest/v1/export
Content-Type: application/x-www-form-urlencoded

````

#### Query/Form Parameters (URL-encoded JSON)

**exportRequest**:

```json
{
  "type": "ESERVICES",
  "fileFormat": "PDF",
  "contentDisposition": "INLINE" // or omit for download
}
````

**exportParams**:

```json
{
  "documentList": [
    {
      "documentType": "STATEMENT",
      "id": "{statement_id}",
      "seq": "{statement_seq}",
      "fileType": "PDF",
      "runDate": "2025-11-06T02:58:00.000Z",
      "states": {
        "PERFORMANCE_AND_FEES": false,
        "REVISED": false,
        "DORMANT": false
      },
      "descriptionCode": "DIRECT_TRADE_CAD",
      "stmtDate": "2025-10-01T07:00:00.000Z",
      "mimeType": "application/pdf",
      "docType": "STATEMENT",
      "groupNumber": "80XCK0",
      "rrCode": "RM01",
      "description": "Direct Trading - Canadian Dollar"
    }
  ]
}
```

#### Parameter Sources

| Parameter         | Source                                                       |
| ----------------- | ------------------------------------------------------------ |
| `id`              | From statements API response (`documents[].id`)              |
| `seq`             | From statements API response (`documents[].seq`)             |
| `runDate`         | From statements API response (`documents[].runDate`)         |
| `states`          | From statements API response (`documents[].states`)          |
| `descriptionCode` | From statements API response (`documents[].descriptionCode`) |
| `stmtDate`        | From statements API response (`documents[].stmtDate`)        |
| `groupNumber`     | From statements API response (`documents[].groupNumber`)     |
| `rrCode`          | From statements API response (`documents[].rrCode`)          |

#### Response

- **Content-Type**: `application/pdf`
- **Body**: Binary PDF file

---

## Additional APIs (Reference)

### Get Account Positions/Holdings

**Endpoint**: `GET /waw/brk/wb/services/rest/v2/accountsV2/{accountId}/positions`

```
GET https://webbroker.td.com/waw/brk/wb/services/rest/v2/accountsV2/{accountId}/positions?includeQuotes=false&retrieveDataWhenMarketIsClosed=true&AJAXREQUEST=1
```

#### Path Parameters

| Parameter   | Source                               |
| ----------- | ------------------------------------ |
| `accountId` | From accountsV2 API (`payload[].id`) |

### Get Account Activity

**Endpoint**: `GET /waw/brk/wb/services/rest/v2/accountsV2/{accountId}/activity`

```
GET https://webbroker.td.com/waw/brk/wb/services/rest/v2/accountsV2/{accountId}/activity?AJAXREQUEST=1
```

Returns transaction history for the past 60 days.

### Get Aggregated Balances

**Endpoint**: `GET /waw/brk/wb/services/rest/v2/portfolio/aggregated-balances`

```
GET https://webbroker.td.com/waw/brk/wb/services/rest/v2/portfolio/aggregated-balances?aggregationType=PORTFOLIO_INVESTMENT_TYPE_TOTAL&aggregationType=ACCOUNT_DATA_GROUPED_BY_NUMBER_TYPE&AJAXREQUEST=1
```

Returns portfolio-level balance summaries.

---

## API Flow Summary

```
1. Login (handled by TD authentication)
   ↓
2. GET /eservices/profile
   → Get user profile (email, subscriptions)
   ↓
3. GET /accountsV2/account-groups?filter=ESERVICES_STATEMENTS_FILTER
   → Get list of account groups with groupId
   ↓
4. GET /eservices/statements/{groupId}?fromDate=...&toDate=...
   → Get list of available statements for date range
   ↓
5. GET/POST /export?exportRequest=...&exportParams=...
   → Download statement PDF using document details from step 4
```

---

## Notes

1. All API endpoints require the `AJAXREQUEST=1` query parameter for JSON responses.
2. Session is maintained via cookies; no explicit Authorization header is required.
3. The `groupId` is used for fetching statements - it represents an account group that may contain multiple currency accounts.
4. Statement dates use ISO 8601 format with timezone offset.
5. The export API supports both GET (inline view) and POST (download) methods.
6. Account groups typically contain multiple currency accounts (CAD and USD) under the same group number.
7. API responses may come in two formats (wrapped or direct) - implementations should handle both.
