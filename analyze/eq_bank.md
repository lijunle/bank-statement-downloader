# EQ Bank API Analysis

## Bank Information

- **Bank ID**: eq_bank
- **Bank Name**: EQ Bank
- **Bank URL**: https://www.eqbank.ca
- **Secure Portal URL**: https://secure.eqbank.ca
- **API Base URL**: https://web-api.eqbank.ca/web/v1.1

## Session Management

### Session ID / Authentication

EQ Bank uses JWT (JSON Web Token) based authentication via OAuth 2.0 flow.

**Authentication Flow**:

1. User logs in via Auth0 at `https://auth.eqbank.ca`
2. After successful authentication, receives authorization code
3. Exchanges code for access token
4. Access token is stored encrypted in sessionStorage and used for API calls

**Implementation Method**:

The extension uses **direct token decryption** from sessionStorage:

- **Storage Location**: `sessionStorage['ZXFUb2tlbg==']` (base64 for "eqToken")
- **Encryption**: CryptoJS AES with OpenSSL-compatible format
- **Encryption Key**: Cookie `eq_uuid{sessionId}` (base64-encoded)
- **Key Derivation**: OpenSSL's EVP_BytesToKey with MD5 (single iteration)
- **Decryption**: Web Crypto API (AES-CBC with derived key/IV)

**Token Storage Format**:

```
Base64("Salted__" + 8-byte-salt + AES-encrypted-JWT)
```

**Token Properties**:

- **Authorization Header**: `Bearer {JWT_TOKEN}`
- JWT token contains user identity and permissions
- Token is **accessible via JavaScript** (not HttpOnly)
- Token has **15-minute expiry** (exp claim in JWT payload)
- Automatic token refresh on 401 Unauthorized responses
- Token cached in memory with 60-second expiry buffer

**Key APIs for Session**:

- **POST** `https://api.eqbank.ca/auth/v3/access-token` - Exchange auth code for access token
- **GET** `https://api.eqbank.ca/auth/v3/login-details` - Get login session details

**Error Handling**:

- On 401 Unauthorized: Clear cache, re-decrypt token from sessionStorage, retry request
- Token validity check: Verify expiry with 60-second buffer before using cached token
- Automatic retry mechanism ensures seamless operation across token expiry

## User Profile Information

### API: Retrieve User Profile (via login-details)

**Implementation Note**: The extension uses the `login-details` endpoint instead of the `/v3/customers` endpoint for better compatibility and simpler response structure.

**Endpoint**: `GET https://api.eqbank.ca/auth/v3/login-details`

**HTTP Method**: GET

**Query Parameters**: None required

**HTTP Headers**:

- `Authorization`: Bearer {JWT_TOKEN}
- `Accept`: application/json, text/plain, _/_
- `Accept-Language`: en-CA
- `Channel`: WEB
- `correlationid`: UUID v4 format
- `Origin`: https://secure.eqbank.ca
- `Referer`: https://secure.eqbank.ca/

**Response Structure**:

```json
{
  "data": {
    "customerDetails": {
      "mnemonic": "ABC123XYZ",
      "email": "user@example.com",
      "customerFirstName": "John",
      "customerLastName": "Doe",
      "customerName": "John Doe"
    }
  }
}
```

**Important Fields**:

- `data.customerDetails.mnemonic`: Unique user identifier (used as base profileId)
- `data.customerDetails.email`: User's email address
- `data.customerDetails.customerName`: Full name for display
- `data.customerDetails.customerFirstName`: User's first name
- `data.customerDetails.customerLastName`: User's last name

**Implementation Details**:

- Profile ID format: `{mnemonic}|{email}` (pipe-separated)
- Email is encoded into profileId for compatibility with standard Profile type
- Profile name falls back to `{firstName} {lastName}` or `User {mnemonic}` if customerName is not available
- Automatic 401 error handling with token refresh and retry

## List All Accounts

### API: List Accounts

**Endpoint**: `GET https://web-api.eqbank.ca/web/v1.1/accounts/v2/accounts`

**HTTP Method**: GET

**Query Parameters**: None required for listing all accounts

**Optional Query Parameters**:

- `productType`: Filter by product type (e.g., "CARD")
- `accountType`: Filter by account type (e.g., "PPC")
- `accountStatusList`: Filter by status (e.g., "ACTIVE", "CLOSED")
- `refreshBalance`: true/false - Refresh balance data

**HTTP Headers**:

- `Authorization`: Bearer {JWT_TOKEN}
- `Accept`: application/json, text/plain, _/_
- `Accept-Language`: en-CA
- `Channel`: WEB
- `correlationid`: UUID v4 format (e.g., "a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d")
- `traceparent`: W3C Trace Context format (e.g., "00-{32-hex-trace-id}-{16-hex-parent-id}-01")
- `email`: User's email address (extracted from profileId)
- `Origin`: https://secure.eqbank.ca
- `Referer`: https://secure.eqbank.ca/

**Response Structure**:

```json
[
  {
    "productType": "HISA",
    "accountType": "HISA",
    "accountNumber": "847293516",
    "accountName": "Chequing",
    "primaryCustomerName": "John Doe",
    "currency": "CAD",
    "currentBalance": 1.14,
    "availableBalance": 1.14,
    "goalStatus": "INACTIVE",
    "goalAmount": 0.0,
    "rate": 2.75,
    "postingRestriction": false,
    "accountOpeningMonthYear": "062025",
    "accountOpeningDate": "2025-06-06",
    "arrangementId": "KR82749FXNP5",
    "interestEarnedLastMonth": 1.15,
    "co-owners": [],
    "accountId": "c8f271a3e04b95d1627f8a39c4e50b81d362f74ac9e018b5f23d694078ab1e96",
    "restrictionStatus": "ACTIVE"
  },
  {
    "productType": "USD_HISA",
    "accountType": "USD_HISA",
    "accountNumber": "613928475",
    "accountName": "US Savings",
    "primaryCustomerName": "John Doe",
    "currency": "USD",
    "currentBalance": 11.75,
    "availableBalance": 11.75,
    "rate": 2.5,
    "arrangementId": "KR82749FXNP6",
    "accountId": "...",
    "restrictionStatus": "ACTIVE"
  },
  {
    "productType": "CARD",
    "accountType": "PPC",
    "accountNumber": "529371648",
    "accountName": "EQ Bank Card",
    "cardNumber": "4817********3945",
    "currency": "CAD",
    "currentBalance": 0.0,
    "availableBalance": 0.0,
    "arrangementId": "KR82749FXNP7",
    "accountId": "...",
    "cardStatus": "ACTIVE"
  }
]
```

**Important Fields**:

- `accountId`: Unique account identifier (hashed/encoded)
- `accountNumber`: Actual account number (visible to user)
- `accountName`: Display name for the account
- `accountType`: Type of account (HISA, USD_HISA, PPC, etc.)
- `productType`: Product type (HISA, USD_HISA, CARD, etc.)
- `currency`: Account currency (CAD, USD)
- `currentBalance`: Current account balance
- `accountOpeningDate`: Date account was opened (YYYY-MM-DD format)
- `accountOpeningMonthYear`: Month/year account opened (MMYYYY format)
- `restrictionStatus`: Account status (ACTIVE, CLOSED, etc.)
- `cardStatus`: Card status for card accounts (ACTIVE, CLOSED, etc.)

**Implementation Notes**:

- Account mask displays last 3 digits for regular accounts (e.g., "516"), last 4 for cards (e.g., "3945")
- Account opening date is encoded into accountId: `{accountId}|{accountOpeningDate}`
- Statements are filtered to exclude months before account opening
- Closed accounts are skipped (`restrictionStatus === 'CLOSED'` or `cardStatus === 'CLOSED'`)
- Account name includes currency: e.g., "Chequing (CAD)", "US Savings (USD)"
- `availableBalance`: Available balance for transactions
- `rate`: Interest rate (percentage)
- `arrangementId`: Bank's internal arrangement identifier

**Account Type Mapping**:

- `HISA` / `HISA`: Savings/Chequing Account (CAD)
- `USD_HISA` / `USD_HISA`: US Dollar Savings Account
- `CARD` / `PPC`: EQ Bank Prepaid Card
- `TFSA`: Tax-Free Savings Account
- `RRSP`: Registered Retirement Savings Plan
- `FHSA`: First Home Savings Account

### Dependent APIs

**Customer Details**:

- **GET** `https://web-api.eqbank.ca/web/v1.1/v3/customers`
  - Returns detailed customer information including name, address, contact details
  - No additional parameters required
  - Uses same Authorization header

**Dashboard View** (aggregated data):

- **GET** `https://web-api.eqbank.ca/web/v1.1/accounts/v2/accounts/dashboard`
  - Returns accounts with dashboard-specific formatting
  - Includes totals and summary information

## List Available Statements

### API: List Statements (Checking/Savings/USD Accounts)

**Endpoint**: `GET https://web-api.eqbank.ca/web/v1.1/transaction/statements`

**HTTP Method**: GET

**Query Parameters** (Required):

- `statementMonthYear`: Statement month/year in format MMYYYY (e.g., "102025" for October 2025)
- `startDate`: Statement period start date in format YYYY-MM-DD (e.g., "2025-10-01")
- `endDate`: Statement period end date in format YYYY-MM-DD (e.g., "2025-10-31")

**HTTP Headers**:

- `Authorization`: Bearer {JWT_TOKEN}
- `accountid`: {ACCOUNT_NUMBER} (e.g., "847293516") - **Required to specify which account**
- `Accept`: application/json, text/plain, _/_
- `Accept-Language`: en-CA

**Parameter Sources**:

- `accountid` header: Retrieved from the accounts list API (`accountNumber` field)
- `statementMonthYear`, `startDate`, `endDate`: Constructed from user's month/year selection

**Response Structure**:

```json
{
  "transactions": [
    {
      "type": "DEBIT",
      "accountId": "847293516",
      "date": "01 OCT 2025",
      "amount": 2011,
      "balance": 2001.99,
      "lockedAmount": null,
      "description": "Interac e-Transfer sent to Jane Smith",
      "dateTime": "2025-10-02T04:50:00Z",
      "bookingDateTime": "2025-10-02T00:50:00-04:00",
      "exchangeRate": null
    },
    {
      "type": "CREDIT",
      "accountId": "847293516",
      "date": "31 OCT 2025",
      "amount": 1.15,
      "balance": 8011.14,
      "description": "Interest received",
      "dateTime": "2025-11-01T03:59:00Z",
      "bookingDateTime": "2025-10-31T23:59:00-04:00"
    }
  ]
}
```

**Important Fields**:

- `transactions[]`: Array of transactions for the statement period
- `accountId`: Account number the transaction belongs to
- `type`: Transaction type (DEBIT, CREDIT)
- `date`: Transaction date (display format)
- `dateTime`: Transaction timestamp (ISO format)
- `amount`: Transaction amount
- `balance`: Account balance after transaction
- `description`: Transaction description

### API: List Statements (EQ Bank Card - PPC)

**Endpoint**: `GET https://web-api.eqbank.ca/web/v1.1/transactions/statements/{accountId}/statements`

**HTTP Method**: GET

**Path Parameters**:

- `{accountId}`: Hashed/encoded account ID (not the account number)
  - Example: `f2a84b61c9e73d0528f164a8d7b309e5c4f827a1e60d9b3f17c28a490e6d5f12`

**Query Parameters** (Required):

- `fromStatementDateTime`: Start datetime in ISO format (e.g., "2025-10-01T00:00:00-07:00")
- `toStatementDateTime`: End datetime in ISO format (e.g., "2025-10-31T23:59:59-07:00")

**HTTP Headers**:

- `Authorization`: Bearer {JWT_TOKEN}
- `Accept`: application/json, text/plain, _/_
- `Accept-Language`: en-CA

**Parameter Sources**:

- `accountId`: Retrieved from the accounts list API (`accountId` field)
- DateTime parameters: Constructed from user's month/year selection with timezone

**Response Structure**:

```json
{
  "Data": {
    "Statement": [
      {
        "TotalDeposits": "0.0",
        "TotalWithdrawals": "-0.0",
        "TotalCashbackEarned": "0",
        "AccountId": "529371648",
        "StatementReference": "Statement Summary",
        "Type": "RegularPeriodic",
        "StartDateTime": "2025-10-01T00:00:00-05:00",
        "EndDateTime": "2025-10-31T00:00:00-05:00",
        "CreationDateTime": "2025-11-19T06:49:59.335850753-05:00",
        "StatementDescription": ["Statement Common Data"]
      }
    ]
  }
}
```

**Important Fields**:

- `Data.Statement[]`: Array of statement summary data
- `AccountId`: Actual account number
- `Type`: Statement type (e.g., "RegularPeriodic")
- `StartDateTime` / `EndDateTime`: Statement period
- `TotalDeposits`: Total deposits for the period
- `TotalWithdrawals`: Total withdrawals for the period
- `TotalCashbackEarned`: Total cashback earned

**Notes**:

- PPC (Prepaid Card) accounts use a different API endpoint than regular accounts
- The accountId in the path is the hashed ID, not the account number
- The account number appears in the response data

## Download Statement PDF

### Statement PDF Download API

**Observation**: The HAR file does not contain direct PDF download API calls. Based on the application behavior:

**Method 1: Client-Side Generation**
The statements appear to be generated client-side from the transaction data:

1. Fetch transaction data via `/transaction/statements` or `/transactions/statements/{accountId}/statements` API
2. Client JavaScript generates PDF from the transaction JSON data
3. PDF is downloaded via browser download mechanism (blob URL or data URL)

**Method 2: Server-Side Generation (Inferred)**
There may be a server endpoint for pre-generated PDFs, but it was not captured in this session. Likely pattern would be:

**Potential Endpoint**: `GET https://web-api.eqbank.ca/web/v1.1/statements/{accountId}/pdf` or similar

**Potential Query Parameters**:

- `statementMonthYear`: MMYYYY format
- `accountNumber`: Account number
- `startDate` / `endDate`: Statement period dates

**HTTP Headers**:

- `Authorization`: Bearer {JWT_TOKEN}
- `Accept`: application/pdf

**Response**: PDF binary data with `Content-Type: application/pdf`

**Notes**:

- The actual PDF generation mechanism requires further investigation
- May need to intercept download events or check for additional XHR/fetch calls
- Could also be using a service worker or background download mechanism

### Account Type Variations

**For Regular Accounts** (HISA, USD_HISA):

- Use `/transaction/statements` endpoint
- Requires: `statementMonthYear`, `startDate`, `endDate` parameters
- Returns transaction list that can be used to generate PDF

**For Card Accounts** (PPC):

- Use `/transactions/statements/{accountId}/statements` endpoint
- Requires: `accountId` (hashed), `fromStatementDateTime`, `toStatementDateTime`
- Returns statement summary data

## PDF Generation Analysis

### Challenge: No Reliable PDF Replication Method

After extensive analysis of EQ Bank's PDF generation code, we found that **replicating their exact PDF format is not feasible** for the following reasons:

#### 1. Client-Side PDF Generation

- EQ Bank uses **Angular framework** with **jsPDF library**
- PDF generation code is in minified JavaScript: `4720.af03ebf91ee36048.js` (5.1MB)
- Process: API data → Angular template → Hidden HTML elements → jsPDF conversion

#### 2. Extracted Implementation Details

```javascript
// From deobfuscated code:
const doc = new jsPDF();
doc.addImage(logo, "PNG", 13, 15, 24, 10);
doc.fromHTML(container, 13, 38, { width: 170 });
doc.setFont(undefined, "bold");
doc.text(197, 142.3, accountText, null, null, "right");
doc.autoTable(columns, data, {
  startY: 152,
  styles: { lineColor: 210, lineWidth: 0.4 },
  columnStyles: {
    0: { columnWidth: 27 },
    1: { columnWidth: "auto" },
    2: { columnWidth: "auto" },
    3: { columnWidth: 27 },
  },
});
```

#### 3. Why Replication Fails

**Technical Obstacles**:

- ❌ **Custom Fonts**: OpenSans font embedded as base64 (normal, bold, semibold variants)
- ❌ **Logo Extraction**: EQ Bank logo encoded in JavaScript, extraction unreliable
- ❌ **HTML-to-PDF Conversion**: `doc.fromHTML()` renders differently across jsPDF versions
- ❌ **Angular Template Dependencies**: Hidden DOM elements require Angular's rendering engine
- ❌ **Precise Positioning**: Pixel-perfect layout requires exact font metrics and spacing
- ❌ **Version Compatibility**: jsPDF API differences (e.g., `setFontType` vs `setFont`)

**Test Result**:
When testing with real transaction data, the generated PDF was **visually completely different** from EQ Bank's original PDF, despite using their extracted code structure.

#### 4. Available Options

**Option A: Intercept EQ Bank's PDF (Recommended)**

```javascript
// Monkey-patch jsPDF.prototype.save to capture their PDF
window.jsPDF.prototype.save = function (filename) {
  const pdfBlob = this.output("blob");
  // Capture the blob - this IS the exact EQ Bank PDF
  capturePDF(pdfBlob, filename);
  // Optionally call original save
};
```

- ✅ Gets **exact** EQ Bank PDF
- ⚠️ Requires user to trigger PDF generation manually
- ⚠️ Browser automation/extension context needed

**Option B: Generate Custom PDF**

```javascript
// Use transaction data from API to generate own PDF
const data = await fetch("/transaction/statements?...");
const customPDF = await generateCustomPDF(data);
```

- ✅ Full control over format
- ✅ No dependency on EQ Bank's code
- ❌ Won't match EQ Bank's exact format
- ✅ Good enough for personal records

**Option C: Direct API Call + Parse (No PDF)**

- Just use the transaction JSON data directly
- Skip PDF generation entirely
- Import into personal finance apps (CSV, JSON, OFX)

### Recommendation

**For this extension project**: Use **Option A** (intercept) or **Option B** (custom PDF).

Do not attempt to replicate EQ Bank's exact PDF format - it's not worth the effort and will never be pixel-perfect.

### Related Documentation

- `analyze/eq_bank_hookability.md` - Detailed hook point analysis
- `analyze/eq_bank_function_call.md` - Angular component access attempts
- `analyze/eq_bank_pdf_extraction.md` - PDF template extraction details
- `bank/eq_bank_pdf_template.mjs` - Test implementation (produces different output)

---

## Summary

### Key Findings

1. **Authentication**: OAuth 2.0 with JWT Bearer tokens

   - Token accessible via JavaScript (used in Authorization header)
   - No HttpOnly cookie for API authentication

2. **User Profile**:

   - **GET** `/v3/customers` - Complete user profile (returns name, address, contact details) ✓
   - **POST** `/party/profiles?relationshipIndex=0` - Profile type and relationship metadata

3. **Account List**:

   - **GET** `/accounts/v2/accounts` - Lists all accounts
   - Returns account IDs, numbers, names, balances, and types
   - Supports filtering by product type and account type

4. **Statements List**:

   - **Regular accounts**: `GET /transaction/statements?statementMonthYear={MMYYYY}&startDate={date}&endDate={date}`
   - **Card accounts**: `GET /transactions/statements/{accountId}/statements?fromStatementDateTime={iso}&toStatementDateTime={iso}`
   - Returns transaction data for specified period

5. **PDF Download**:
   - **⚠️ No reliable PDF generation method available**
   - EQ Bank generates PDFs client-side using Angular + jsPDF
   - JavaScript file: `4720.af03ebf91ee36048.js` contains PDF generation logic
   - Uses jsPDF with autoTable plugin to convert HTML templates to PDF
   - **Problem**: Attempting to replicate their exact PDF layout produces visually different results
   - **Reasons**:
     - Complex HTML-to-PDF conversion with custom fonts (OpenSans embedded)
     - Angular template rendering with hidden DOM elements
     - Precise positioning and styling difficult to replicate exactly
     - Logo, fonts, and exact spacing cannot be reliably extracted
   - **Recommendation**: Use Option 2 (Monkey-patch) to capture PDFs generated by EQ Bank's own code
   - **Alternative**: Generate custom PDF with transaction data (won't match EQ Bank's format exactly)
   - See `analyze/eq_bank_hookability.md` and `analyze/eq_bank_function_call.md` for detailed analysis

### API Base URLs

- **Auth APIs**: `https://api.eqbank.ca/auth/v3/`
- **Web APIs**: `https://web-api.eqbank.ca/web/v1.1/`
- **APM (Monitoring)**: `https://apm.eqbank.ca/intake/v2/rum/events`

### Account Types Supported

- **HISA**: High Interest Savings Account (CAD)
- **USD_HISA**: US Dollar Savings Account
- **PPC**: Prepaid Card (EQ Bank Card)
- **TFSA**: Tax-Free Savings Account
- **RRSP**: Registered Retirement Savings Plan
- **FHSA**: First Home Savings Account
- **GIC**: Guaranteed Investment Certificate

All APIs require `Authorization: Bearer {JWT_TOKEN}` header for authenticated access.
