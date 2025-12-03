# First Tech Federal Credit Union - API Analysis

**Bank ID:** `first_tech_fcu`  
**Bank Name:** First Tech Federal Credit Union  
**Bank URL:** https://banking.firsttechfed.com  
**HAR File:** `analyze/first_tech_fcu.har`

---

## Session Management

First Tech FCU uses standard HTTP session cookies for authentication. All session cookies are HttpOnly and Secure.

**Key Identifiers:**

- **Session:** Maintained via cookies (automatic with each request)
  - Authentication cookies (`ASP.NET_SessionId`, `.ASPXAUTH`) are httpOnly and not accessible to JavaScript
  - Use `cdContextId` cookie as a session identifier (accessible via `document.cookie`)
- **User ID:** Available in script URLs as `userId` parameter (e.g., `b7319426-f52d-48c6-82a1-cdf8b9ea462c`)

---

## API Endpoints

### 1. Retrieve User Profile Information

**Note:** Profile information is retrieved from two sources: dashboard HTML for user name, and documents API for account/statement data.

**Endpoint 1:** `/DashboardV2`

**HTTP Method:** GET

**URL:** `https://banking.firsttechfed.com/DashboardV2`

**Response:**

- **Status:** 200 OK
- **Content-Type:** `text/html; charset=utf-8`

**Profile Data Extraction:**

Parse the HTML response to extract:

1. **User Name:** From profile menu HTML

   ```html
   <span class="profile-menu__text font-subtitle-1">John Doe</span>
   ```

**Endpoint 2:** `/eDocs/GeteDocs?accountIdentifier=undefined`

**HTTP Method:** GET

**Request Headers:**

- `x-requested-with: XMLHttpRequest`
- `accept: */*`
- `referer: https://banking.firsttechfed.com/eDocs`

**Response:**

- **Status:** 200 OK
- **Content-Type:** `application/json; charset=utf-8`

**Profile Implementation:**

The entire JSON response from `/eDocs/GeteDocs` is serialized and stored as the `profileId` field. This allows subsequent calls to `getAccounts()` and `getStatements()` to deserialize the data without making additional API calls.

**Profile Image:** `GET /Image/UserPortrait?width={w}&height={h}&CacheIdentifier={token}`

- Returns PNG image (~3.3 KB)

---

### 2. List All Accounts

**Implementation Note:** Account data is retrieved from the `profileId` field (obtained during `getProfile()`), not from a separate API call.

**Data Source:** Deserialized from `profile.profileId` (JSON string)

**Response Structure:**

```json
{
  "Accounts": [
    {
      "ID": 2847193,
      "AccountIdentifier": "e9a47c81-3f26-49d8-a7b5-18294d6e53fb",
      "AccountNumber": "7428163954",
      "DisplayAccountNumber": "*3954",
      "DisplayName": "Dividend Rewards Checking",
      "ThemeColorIndex": "1"
    }
  ],
  "DocumentListings": [...]
}
```

**Key Fields:**

- `ID`: Internal account ID
- `AccountIdentifier`: Unique GUID for the account
- `AccountNumber`: Full account number
- `DisplayAccountNumber`: Masked account number (last 4 digits)
- `DisplayName`: Account name

**Alternative Endpoint (with balances):** `/Mobile/BillPayV2/api/FundingAccounts`

**HTTP Method:** GET

**Response:**

```json
[
  {
    "AccountNumber": "7428163954",
    "DisplayAccountNumber": "*3954",
    "Name": "Dividend Rewards Checking",
    "AvailableBalance": 2431.25,
    "AccountType": "Checking"
  }
]
```

---

### 3. List Available Statements

**Implementation Note:** Statement data is retrieved from the `profileId` field (obtained during `getProfile()`), not from a separate API call.

**Data Source:** Deserialized from `account.profile.profileId` (JSON string)

**Response Structure:**

```json
{
  "Accounts": [...],
  "DocumentListings": [
    {
      "Account": "7428163954",
      "AccountDisplayName": "Dividend Rewards Checking",
      "DisplayAccountNumber": "*3954",
      "DocumentDate": "2025/10/31",
      "Name": "Member Combined Statement",
      "Type": "STMT",
      "DocumentTypeId": 1,
      "Url": "eDocs/GetDocument?providerId=818&documentKey=8B759E623...",
      "ProviderId": 818,
      "Key": "8B759E623...",
      "IsSingleUseUrl": true
    }
  ]
}
```

**Key Fields:**

- `Account`: Full account number
- `AccountDisplayName`: Account name
- `DocumentDate`: Statement date (format: `YYYY/MM/DD`)
- `Name`: Document name
- `Type`: Document type code (`STMT`, `TAX`, `NSF`, `1099`)
- `ProviderId`: Document provider ID (typically `818`)
- `Key`: Encrypted document key (required for download)

**Statement Types:**

- `STMT`: Monthly statements (checking, savings, credit cards)
- `TAX`: Tax documents (1099 forms)
- `NSF`: Notices (NSF, overdraft, etc.)

**Notes:**

- Single API returns statements for all account types
- `IsSingleUseUrl: true` indicates the download link expires after use

---

### 4. Download Statement PDF

**Endpoint:** `/eDocs/GetDocument?providerId={providerId}&documentKey={documentKey}`

**HTTP Method:** GET

**Query Parameters:**

- `providerId`: Document provider ID (typically `818`)
- `documentKey`: Encrypted document key (hex-encoded string)

**Parameter Source:**
Both parameters come from `/eDocs/GeteDocs` response:

- `ProviderId` field → use as `providerId`
- `Key` field → use as `documentKey`

**Response:**

- **Status:** 200 OK
- **Content-Type:** `application/pdf`
- **Body:** PDF file binary data

**Notes:**

- The `documentKey` is a long hex-encoded encrypted token unique to each statement
- `IsSingleUseUrl: true` indicates the download URL may expire after first use
- Must call `/eDocs/GeteDocs` first to obtain the document keys

**Download Flow:**

1. Call `/eDocs/GeteDocs?accountIdentifier=undefined` to list statements
2. Find desired statement in `DocumentListings` array
3. Extract `ProviderId` and `Key` fields
4. Call `/eDocs/GetDocument?providerId={ProviderId}&documentKey={Key}` to download

---

## Summary

### Complete Workflow

1. **Session Authentication**

   - Authentication handled via HTTP session cookies (automatic)
   - All subsequent API calls use these cookies

2. **Retrieve Profile Information**

   - GET `/DashboardV2` → Parse HTML for user name
   - GET `/eDocs/GeteDocs?accountIdentifier=undefined` → Fetch all accounts and statements data
   - Store entire JSON response as serialized `profileId`

3. **List Accounts**

   - Deserialize data from `profile.profileId`
   - Extract accounts from `Accounts` array
   - Alternative: GET `/Mobile/BillPayV2/api/FundingAccounts` → Returns accounts with balances

4. **List Statements**

   - Deserialize data from `account.profile.profileId`
   - Extract statements from `DocumentListings` array
   - Filter by account, date, or document type as needed

5. **Download PDF**
   - Extract `ProviderId` and `Key` from statement object
   - GET `/eDocs/GetDocument?providerId={ProviderId}&documentKey={Key}` → Returns PDF binary

### Key Characteristics

- **Unified API:** Single endpoint (`/eDocs/GeteDocs`) returns both accounts and statements
- **All Account Types:** No separate APIs for checking, savings, credit cards, loans
- **Session-Based:** All authentication via HTTP cookies, no tokens in headers
- **Encrypted Keys:** PDF downloads require encrypted document keys from statement list
- **Single-Use URLs:** Download links expire after use (`IsSingleUseUrl: true`)
- **HTML Profile Data:** User profile information embedded in HTML, not available as JSON
- **Efficient Design:** The `/eDocs/GeteDocs` endpoint is called once in `getProfile()`, with data passed through `profileId` to avoid repeated API calls

### Implementation Notes

**Account Matching:**

- Documents use different formats for the `Account` field:
  - Deposit accounts (checking/savings): Full account number (e.g., `"7428163954"`)
  - Credit cards: Masked with asterisks (e.g., `"************2847"`)
- Matching strategy:
  1. Match by `DisplayAccountNumber` (e.g., `"*2847"`)
  2. Match by full account number
  3. Match by last 4 digits suffix for masked credit card accounts

**Data Flow:**

- `getProfile()` fetches `/eDocs/GeteDocs` and serializes the entire JSON response as `profileId`
- `getAccounts()` deserializes data from `profile.profileId` (no API call)
- `getStatements()` deserializes data from `account.profile.profileId` (no API call)
- This approach eliminates the need for sessionStorage caching

**Statement ID Format:**

- Format: `{ProviderId}_{Key}_{Date}`
- Example: `818_8B759E623...._20251031`
- Parsed in `downloadStatement()` to extract `ProviderId` and `Key`

### API Dependencies

| API                                     | Dependencies               | Parameters Source                                    | Called By             |
| --------------------------------------- | -------------------------- | ---------------------------------------------------- | --------------------- |
| `/DashboardV2`                          | None                       | None                                                 | `getProfile()`        |
| `/eDocs/GeteDocs`                       | None                       | Use `accountIdentifier=undefined`                    | `getProfile()`        |
| `/eDocs/GetDocument`                    | Requires `/eDocs/GeteDocs` | `providerId` and `documentKey` from statement object | `downloadStatement()` |
| `/Mobile/BillPayV2/api/FundingAccounts` | None                       | None                                                 | (not used)            |
