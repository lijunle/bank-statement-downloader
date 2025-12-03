# SoFi Bank API Analysis

## Bank Information

- **Bank ID**: `sofi`
- **Bank Name**: SoFi
- **Bank URL**: https://www.sofi.com
- **Login URL**: https://login.sofi.com

## Session ID

### Cookie-Based Session

SoFi uses multiple cookies to maintain session state:

1. **Primary Session Cookie**: `SOFI_SESSION`

   - Contains UUID, fingerprint session ID, and TMX session ID
   - Format: `{hash}-uuid={uuid}-global&fpSessionId={fpSessionId}&TMX_SESSION={tmxSessionId}`
   - **HttpOnly: YES** - Not accessible via JavaScript in browser
   - Example: `bd0fb21ce7d8dd4g18077eeec017g5c4gd712833-uuid=sofi-apps-36088926-f6eg4c24-6d45-59bd-0654-3630e601126c-global&fpSessionId=2g606274-22fd-5ee3-927f-f365555b45eg...`

2. **Login Status Cookie**: `SOFI_LOGIN`

   - Value: `1` when logged in
   - **HttpOnly: YES** - Not accessible via JavaScript in browser

3. **Authentication Token**: `SOFI` ⚠️ **HttpOnly in Content Script Context**

   - Contains encrypted authentication data
   - **HttpOnly: YES in content script context** - Not accessible via JavaScript in browser extension content scripts
   - **HttpOnly: NO in page context** - Accessible in Playwright/page console
   - Automatically sent with API requests using `credentials: 'include'`
   - Example: `2L8DB413rNbR9JM3Yo0OUhyLuwe2+fWm1KvTIbtthBUOJPOir7daU1BR4fLKe91ID0Utk+24Ffr8UIqof2GqIlvKH/HnU1p6yV4qRZfcW3EW78czkoNTMpo9Bk4C1YXahN7FYrqF06hvYO0g1BElVeaurjfy4ZdXP0uMZMXN1JJBQQLyccrWphxW8SQbJdsXdcJis0VORe3HfL3Gh1Bz-VB_UUID%3D0d7f7g52-3bc0-5g04-c129-09361818463b...`

4. **CSRF Token Cookies**: `SOFI_R_CSRF_TOKEN` ✅ **Used as Session Identifier**

   - Generated per session for CSRF protection
   - **HttpOnly: NO** - Accessible via JavaScript
   - Used as fallback session identifier in browser extensions
   - Example: `43758d8df0b712f04114615f621gecc6280992c5-1763669570635-5C5EF61F5GF28036E3C38C81`

5. **Session ID Cookie**: `ab.storage.sessionId.55c370dd-bb3f-475c-8a54-50403ffea8cc`
   - Application-level session tracking
   - **HttpOnly: NO** - Accessible via JavaScript
   - Can be used as alternative session identifier

**Important**:

- **Playwright/Page Context**: The `SOFI` authentication cookie is accessible and can be read via `document.cookie`
- **Browser Extension Content Script**: The `SOFI` cookie is NOT accessible via `document.cookie`, likely due to domain/SameSite restrictions
- **Solution**: Use `SOFI_R_CSRF_TOKEN` or session storage cookie as session identifier, while actual authentication happens via HttpOnly cookies automatically sent by the browser with `credentials: 'include'`

## Retrieve User Profile Information

### API Endpoint

- **URL**: `https://www.sofi.com/banking-service/api/public/v2/customer`
- **Method**: `GET`
- **Authentication**: Cookie-based (automatically sent with `credentials: 'include'`)

### Response Structure

```json
{
  "firstName": "string",
  "lastName": "string",
  "customerNumber": "string",
  "onboardingStatus": "COMPLETE",
  "directoryOptIn": boolean,
  "hasDoneBillPay": boolean,
  "phoneNumber": "string",
  "email": "string",
  "sofiId": "string",
  "twoFactor": {
    "twoFactorType": "SMSV1",
    "twoFactorData": "string"
  },
  "addresses": [
    {
      "line1": "string",
      "line2": null,
      "city": "string",
      "state": "string",
      "postalCode": "string",
      "country": "US",
      "addressType": "HOME"
    }
  ],
  "activeTier": null,
  "overrideTier": null,
  "mostRecentlyDeterminatedTier": null,
  "passedKyc": boolean,
  "hasCreatedVault": boolean,
  "partner": "SOFI",
  "partnerV2": "BANK",
  "accountFunded": boolean,
  "accountFundedDate": "YYYY-MM-DD",
  "onboardingStatusMessage": null,
  "ssnDobUpdatable": boolean,
  "grandfatheredUser": boolean
}
```

### Key Response Fields

- `sofiId`: Unique user identifier (used as profile ID)
- `firstName`, `lastName`: User's full name

## List All Accounts

### API Endpoint

- **URL**: `https://www.sofi.com/money/api/public/v2/accounts`
- **Method**: `GET`
- **Authentication**: Cookie-based (automatically sent with `credentials: 'include'`)
- **Parameters**: None (returns all accounts for authenticated user)

### Response Structure

```json
{
  "partyId": 36088926,
  "customerCombinedBalance": {
    "available": "0.00",
    "ledger": "0.00"
  },
  "accounts": [
    {
      "id": "string",
      "type": "CHECKING|SAVING",
      "number": "string",
      "routingNumber": "string",
      "nickname": "string",
      "isFunded": boolean,
      "balance": {
        "available": "string",
        "ledger": "string"
      },
      "combinedBalance": {
        "available": "string",
        "ledger": "string"
      },
      "owners": [
        {
          "partyId": "string",
          "role": "PRIMARY"
        }
      ],
      "formattedApy": "string",
      "formattedSpreadApy": null,
      "formattedBaseApy": "string",
      "interestRate": number,
      "formattedInterestRate": "string",
      "interestEffectiveDate": "YYYY-MM-DD",
      "interestEarnedLifetime": "string",
      "estimatedInterestThisMonth": "string",
      "estimatedInterestThisYear": "string",
      "status": "ACTIVE",
      "isRestricted": boolean,
      "openDate": "YYYY-MM-DD",
      "closeDate": null,
      "partner": "SOFI",
      "vaultSummary": null,
      "spendingReserveEnabled": boolean,
      "currency": "USD",
      "overdraftProtectionLinks": [],
      "hasWithHolding": boolean,
      "totalWithHeld": number,
      "closeReason": null,
      "pod": boolean,
      "isOpen": boolean
    }
  ]
}
```

### Key Response Fields

- `accounts[]`: Array of all accounts
  - `id`: Account ID (unique identifier)
  - `type`: Account type (`CHECKING` or `SAVING`)
  - `number`: Full account number (use last 4 digits as mask)
  - `nickname`: Account display name

## List Available Statements

### API Endpoint

- **URL**: `https://www.sofi.com/banking-service/api/public/v2/statements`
- **Method**: `GET`
- **Authentication**: Cookie-based (automatically sent with `credentials: 'include'`)
- **Parameters**: None (returns all available statements)

### Important Notes

⚠️ SoFi provides **combined statements only** - each PDF includes all accounts (checking and savings). Individual per-account statements are not available.

### Response Structure

```json
[
  {
    "statementDate": "YYYY-MM-DD",
    "accountNumber": null,
    "statementType": "COMBINED",
    "documentId": "uuid",
    "description": "Month YYYY Statement"
  }
]
```

### Key Response Fields

- `documentId`: Unique statement identifier (UUID) - **required for download API**
- `statementDate`: Statement date in YYYY-MM-DD format
- `statementType`: Always `COMBINED`
- `accountNumber`: Always `null` (combined statements)

## Download Statement PDF

### API Endpoint

- **URL**: `https://www.sofi.com/banking-service/api/public/v2/statements/{documentId}`
- **Method**: `GET`
- **Authentication**: Cookie-based (automatically sent with `credentials: 'include'`)
- **Path Parameter**: `documentId` - UUID from statements list API

### Required Headers

```
Accept: text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8
Referer: https://www.sofi.com/my/money/account/more/statements-documents
```

### Response

- **Content-Type**: `application/pdf`
- **Body**: PDF file binary content
