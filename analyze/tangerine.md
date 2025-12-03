# Tangerine Bank API Analysis

**Bank**: Tangerine Bank  
**Bank URL**: https://www.tangerine.ca  
**Analysis Date**: November 20, 2025  
**HAR File**: `analyze/tangerine_1763673817887.har`

## Overview

Tangerine Bank is a Canadian direct bank owned by Scotiabank. Their online banking platform uses RESTful APIs for account management, transactions, and document retrieval. The platform is built with Angular/React and uses secure.tangerine.ca as the API base domain.

## Session Management

### Session ID

Tangerine uses **cookie-based session management** for authentication. The session is maintained through browser cookies after login.

**Key Session Cookies:**

- `TRANSACTION_TOKEN`: HttpOnly authentication cookie (automatically sent by browser)
- `CTOK`: Accessible cookie containing user's Orange Key (format: `P|<OrangeKey>`)
- Additional tracking cookies: `rxVisitor`, `dtCookie`, `bm_sv`, etc.

**Implementation Approach:**

- Use `CTOK` cookie as session identifier (accessible via `document.cookie`)
- The HttpOnly `TRANSACTION_TOKEN` cookie handles actual authentication automatically
- All requests use `credentials: 'include'` to send cookies automatically
- No need to manually extract or send the `TRANSACTION_TOKEN`

## User Profile Information

### Retrieve User Profile

**Endpoint**: `GET https://secure.tangerine.ca/web/rest/v1/customers/my?include-servicing-systems=true`

**HTTP Method**: GET

**Required Headers**:

```
Accept: application/json
x-web-flavour: fbe
x-dynatrace-service: /web/rest/v1/customers/my?include-servicing-systems=
```

**Authentication**: Session cookies (automatically sent by browser)

**Query Parameters**:

- `include-servicing-systems`: Boolean (true to include servicing systems)

**Response Structure**:

```json
{
  "response_status": {
    "status_code": "SUCCESS"
  },
  "customer": {
    "first_name": "JOHN",
    "last_name": "DOE",
    "title": "Mr",
    "email": "john.doe@example.com",
    "client_number": "72413508",
    "sin": "***-***-789",
    "date_of_birth": "1990-01-01",
    "client_since_date": "2020-06-19",
    "orange_key": "81919892T2",
    "last_login": "October 11, 2025 at 5:26 AM ET",
    "langauge": "ENGLISH",
    "phone_list": [
      {
        "sequence_number": 35622894,
        "number": "123-456-7890",
        "type": "CELL",
        "last_updated_date": 1687060800000
      }
    ],
    "address_list": [
      {
        "country": "CA",
        "province": "ON",
        "address_type": "HOME",
        "city": "Anytown",
        "address_line1": "123 Main St",
        "postal_code": "A1B 2C3"
      }
    ],
    "servicing_systems": ["CHEQUING", "SAVINGS"],
    "employment_status": "EMPLOYED",
    "employer": {
      "company_name": "Acme Corp"
    },
    "occupation": {
      "industry_code": "ABIFA",
      "occupation_code": "INVAN"
    },
    "interest_paid_lifetime": 5359.68,
    "fees_saved": 447.77,
    "monthly_fee": 15.4
  }
}
```

**Important Fields**:

- `customer.first_name`: User's first name
- `customer.last_name`: User's last name
- `customer.title`: User's title (Ms, Mr, etc.)
- `customer.email`: User's email address
- `customer.client_number`: Unique customer identifier
- `customer.orange_key`: Referral key
- `customer.phone_list[]`: Array of phone numbers
- `customer.address_list[]`: Array of addresses
- `customer.servicing_systems[]`: Account types user has access to
- `customer.last_login`: Last login timestamp

**Notes**:

- This API returns complete user profile information including name, contact details, and employment
- The `x-transaction-token` header may be required for authenticated requests
- SIN is masked for security

## List All Accounts

### Get All Accounts

**Endpoint**: `GET https://secure.tangerine.ca/web/rest/pfm/v1/accounts`

**HTTP Method**: GET

**Required Headers**:

```
Accept: application/json
x-web-flavour: fbe
x-dynatrace-service: /web/rest/pfm/v1/accounts
```

**Authentication**: Session cookies (automatically sent by browser)

**Request Parameters**: None required

**Response Structure**:

```json
{
  "response_status": {
    "status_code": "SUCCESS"
  },
  "restrictions": [],
  "accounts": [
    {
      "number": "42434445464748495041424344454647ec3ed5211eb03c795g2bcf46d25dd4e1",
      "account_balance": 0,
      "currency_type": "CAD",
      "nickname": "",
      "description": "Tangerine Chequing Account",
      "goal_account": false,
      "display_name": "5129315461",
      "type": "CHEQUING",
      "product_code": "4000"
    },
    {
      "number": "4243444546474849504142434445464798e287b4b55d6bce90dfb545cfg2e8f3",
      "account_balance": 0,
      "currency_type": "CAD",
      "nickname": "",
      "description": "Tangerine Savings Account",
      "goal_account": false,
      "display_name": "4151189461",
      "type": "SAVINGS",
      "product_code": "3000"
    }
  ]
}
```

**Account Types**:

- `CHEQUING`: Chequing accounts (product_code: 4000)
- `SAVINGS`: Savings accounts (product_code: 3000)
- `RSP_SAVINGS`: RSP Savings accounts (product_code: 3100)
- `TFSA_SAVINGS`: TFSA Savings accounts (product_code: 3200)
- `RIF_SAVINGS`: RIF Savings accounts (product_code: 3400)
- `GIC`: Guaranteed Investment Certificates
- `CREDIT_CARD`: Credit card accounts
- `LINE_OF_CREDIT`: Line of credit accounts
- `MORTGAGE`: Mortgage accounts

**Notes**:

- Single API call returns all account types
- No pagination required
- Account `number` field is used as account identifier in subsequent API calls

### Alternative Account API

**Endpoint**: `GET https://secure.tangerine.ca/web/rest/v1/customers/my/accounts`

**Query Parameters** (optional):

- `type`: Filter by account type (e.g., `SAVINGS`)
- `GIC_only`: Boolean to filter only GIC accounts

**Sample Request**:

```
GET https://secure.tangerine.ca/web/rest/v1/customers/my/accounts?type=SAVINGS&GIC_only=true
```

## List Available Statements

### Get All Statements and Available Periods

**Endpoint**: `GET https://secure.tangerine.ca/web/rest/v1/customers/my/documents/statements`

**HTTP Method**: GET

**Required Headers**:

```
Accept: application/json
x-web-flavour: fbe
x-dynatrace-customer: <customer_id>
x-dynatrace-service: /web/rest/v1/customers/my/documents/statements
```

**Authentication**: Session cookies (automatically sent by browser)

**Request Parameters**: None (returns only the most recent month's statements)

**Important**: To retrieve historical statements, use query parameters to specify the month (see "Filter Statements by Specific Period" below).

**Response Structure**:

```json
{
  "response_status": {
    "status_code": "SUCCESS"
  },
  "months": [
    {
      "month": "2025-10",
      "description": "October 2025"
    },
    {
      "month": "2025-09",
      "description": "September 2025"
    },
    {
      "month": "2025-08",
      "description": "August 2025"
    }
  ],
  "statements": [
    {
      "end_date": "2025-10-31",
      "description": "Mr JOHN DOE - Oct 2025",
      "statement_id": "NzI0MTM1MDgtNzg2MTAtVE5HLTIz",
      "statement_type": "CHQ",
      "statement_filename": "Tangerine-Chequing_Oct25.pdf"
    },
    {
      "end_date": "2025-10-31",
      "description": "Mr JOHN DOE - Oct 2025",
      "statement_id": "NzI0MTM1MDgtNzg2MTAtVE5HLTIy",
      "statement_type": "BSTMT",
      "statement_filename": "Tangerine-eStatement_Oct25.pdf"
    }
  ]
}
```

**Important Fields**:

- `months[]`: Array of all available statement periods (e.g., 29 months of history)
  - `month`: Period in YYYY-MM format
  - `description`: Human-readable period name
- `statements[]`: Array of all statement records across all accounts
  - `statement_id`: Unique statement identifier (base64 encoded, used for downloads)
  - `statement_type`: Account type identifier (CHQ, BSTMT, etc.)
  - `statement_filename`: Suggested filename for the PDF
  - `description`: Statement description including customer name and period
  - `end_date`: Statement end date in YYYY-MM-DD format

**Statement Types**:

- `CHQ`: Chequing account statement
- `BSTMT`: Bank statement (Savings)
- `VISA`: Credit card statement
- `LOC`: Line of credit statement
- `MTG`: Mortgage statement

**Notes**:

- Returns `months[]` array with all available periods (e.g., 29 months)
- Returns `statements[]` array with only the most recent month's statements
- To get historical statements, must iterate through months using query parameters

### Filter Statements by Specific Period (Required for Historical Data)

**Endpoint**: `GET https://secure.tangerine.ca/web/rest/v1/customers/my/documents/statements`

**Query Parameters** (all optional):

- `need-statement-months`: Boolean (set to false to exclude months array from response)
- `start-month`: Start month in format YYYY-MM (e.g., "2025-09")
- `end-month`: End month in format YYYY-MM (e.g., "2025-09")

**Sample Request**:

```
GET https://secure.tangerine.ca/web/rest/v1/customers/my/documents/statements?need-statement-months=false&start-month=2025-09&end-month=2025-09
```

**Response**: Same structure as above, but `statements[]` array contains statements only for the specified month range

**Implementation Strategy**:

1. Make initial call without parameters to get `months[]` array
2. Iterate through desired months (recommend limiting to last 12 months for performance)
3. For each month, make a request with `start-month` and `end-month` query parameters
4. Combine all statements from multiple requests

## Download Statement PDF

### Download Statement

**Endpoint**: `GET https://secure.tangerine.ca/web/docs/rest/v1/customers/my/documents/statements/{statement_id}`

**HTTP Method**: GET

**Required Headers**:

```
Accept: application/pdf
```

**Authentication**: Session cookies (automatically sent by browser)

**Path Parameters**:

- `{statement_id}`: The `statement_id` value from statement list response

**Query Parameters** (required):

- `statement-type`: Statement type (CHQ, BSTMT, VISA, etc.)
- `file-name`: Desired filename for the PDF
- `language`: Language code (EN or FR)

**Sample Request for Chequing Statement**:

```
GET https://secure.tangerine.ca/web/docs/rest/v1/customers/my/documents/statements/NzI0MTM1MDgtNzg2MTAtVE5HLTIz?statement-type=CHQ&file-name=Tangerine-Chequing_Oct25.pdf&language=EN
```

**Sample Request for Savings Statement**:

```
GET https://secure.tangerine.ca/web/docs/rest/v1/customers/my/documents/statements/NzI0MTM1MDgtNzg2MTAtVE5HLTIy?statement-type=BSTMT&file-name=Tangerine-eStatement_Oct25.pdf&language=EN
```

**Response**:

- Content-Type: `application/pdf`
- Binary PDF file content

**Parameter Sources**:

- `statement_id`: From `statements[].statement_id` in statement list response
- `statement-type`: From `statements[].statement_type` in statement list response
- `file-name`: From `statements[].statement_filename` or construct manually
- `language`: User preference (EN or FR)

**Important**: To get statement details (type and filename), you must query the statements API for the specific month containing that statement. Extract the month from the statement date (YYYY-MM-DD → YYYY-MM) and use it in the query parameters.

### Account Type Variations

All account types use the same download endpoint with different `statement-type` values:

| Account Type   | statement-type | File Name Pattern                |
| -------------- | -------------- | -------------------------------- |
| Chequing       | CHQ            | Tangerine-Chequing\_{date}.pdf   |
| Savings        | BSTMT          | Tangerine-eStatement\_{date}.pdf |
| Credit Card    | VISA           | Tangerine-CreditCard\_{date}.pdf |
| Line of Credit | LOC            | Tangerine-LOC\_{date}.pdf        |
| Mortgage       | MTG            | Tangerine-Mortgage\_{date}.pdf   |

## API Summary

| Task               | Endpoint                                               | Method | Parameters Required                               |
| ------------------ | ------------------------------------------------------ | ------ | ------------------------------------------------- |
| Get User Profile   | `/rest/v1/customers/my`                                | GET    | include-servicing-systems (optional)              |
| List Accounts      | `/rest/pfm/v1/accounts`                                | GET    | None                                              |
| List Statements    | `/rest/v1/customers/my/documents/statements`           | GET    | start-month, end-month (for historical data)      |
| Download Statement | `/docs/rest/v1/customers/my/documents/statements/{id}` | GET    | statement_id, statement-type, file-name, language |

## Implementation Summary

**Session Management**: Use accessible `CTOK` cookie as session identifier. HttpOnly `TRANSACTION_TOKEN` handles authentication automatically.

**Account Type Mapping**:

- CHEQUING → Checking
- SAVINGS/RSP_SAVINGS/TFSA_SAVINGS/RIF_SAVINGS/GIC → Savings
- CREDIT_CARD → CreditCard
- LINE_OF_CREDIT/MORTGAGE → Loan

**Statement Type Mapping**:

- Checking → CHQ
- Savings → BSTMT
- CreditCard → VISA
- Loan → LOC/MTG

**Historical Statements**: Must iterate through months individually. Recommend limiting to last 12 months for performance (29 months available).

**Download Requirements**: Query the specific month (extract from statement date) to get statement details before constructing download URL.
