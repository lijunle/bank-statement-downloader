# Chime Statement API Analysis

**Analysis as of:** 2026-09-28

## Current scope and evidence

The authenticated Chime web app issued `UserQuery` and `HomeFeedAccountsQuery`
on account overview, both returning HTTP 200. Their persisted-query hashes match
the historical values below. The scoped session has a checking account; savings
and secured-credit fields are null. Other products have not been exercised.

Opening **Profile > Documents** issued `DocumentsQuery` with the same historical
hash and `account_types: ["credit", "checking", "savings", "unsecured_credit",
"line_of_credit"]`. The response contained a checking bucket with twenty monthly
periods; the UI displayed ten on its first page with a next-page control. UI
pagination is client-side for the observed list: the second page showed the
remaining ten periods without another GraphQL request.

The account overview response contains a string account ID and name but no
account-number mask. Opening **Profile > Account info** issued `AccountInfoQuery`
with hash `md5:e57adf8d54262ff92f7b952f3aac90b7`. Its
`data.me.bank_account_v2.primary_funding_account` contains `id`, `account_number`,
and `routing_number`. Its ID matched the overview checking ID; its account-number
suffix did not match the UUID suffix used by the old extension. Derive the checking
mask from this matched account number, not the UUID.

The latest bank-UI checking PDF used `GetMonthlyPdfStatementQuery`, the historical
hash below, and `{account_types: ["checking"], month: 8, year: 2026}`. One response
bucket contained `name` and `monthly_pdf_statement.encoded_pdf`. The bank UI saved
a two-page PDF that parsed and rendered without repair or warnings and matched
Chime, the Account Info number, and the selected month/year. This is bank-side
evidence, not extension acceptance.

The statement period ID has an opaque numeric prefix and a date suffix; the prefix
is not the overview UUID. The observed suffix is month-end. Use the explicit
`month`/`year` fields for requests rather than reconstructing identity from the ID.

Real statement/download validation covers checking only. Savings/credit are
absent. Savings now follows the same account-ID and account-number validation
policy as checking, using the separately validated query described below; a
non-null savings response and savings PDF download remain untested. Credit
discovery and its historical ID-suffix mask remain unchanged and unverified.

## API Endpoint

**URL**: `https://app.chime.com/api/graphql`

**Method**: POST

**Headers**:

- `Content-Type: application/json`
- `Accept: */*`
- `Accept-Encoding: gzip, deflate, br, zstd`
- `Accept-Language: en-US,en;q=0.9,zh-CN;q=0.8,zh;q=0.7`
- `Cookie: [Session cookies]`

**Authentication**: Cookie-based (session cookies from login)

**Note**: The observed bank UI uses Automatic Persisted Queries (APQ) with MD5
hashes. The extension retains those queries where applicable; its savings-detail
lookup uses full query text, which the server also accepted in a read-only probe.

## Persisted Query Mechanism

Chime's GraphQL API uses **Automatic Persisted Queries (APQ)** with MD5 hashes:

1. **Hash Format**: `"md5:{hash_value}"` - Despite the field name `sha256Hash`, Chime actually uses MD5 hashes
2. **Static Values**: The MD5 hash values are **hardcoded** in the Chime application and are the same for all users
3. **How it works**:
   - The client sends only the operation name, variables, and a hash of the query
   - The server looks up the full query text using this hash
   - This reduces request size and improves performance

**Example persisted query structure**:

```json
{
  "operationName": "UserQuery",
  "variables": {},
  "extensions": {
    "persistedQuery": {
      "version": 1,
      "sha256Hash": "md5:f4a5ebcc4103cf23f7e582af45b0edd0"
    }
  }
}
```

**Important**: These hashes identify queries in the observed application build.
They are not user credentials, but their stability across future deployments is
not guaranteed. Recheck current UI requests if an operation stops working.

---

## 1. Get User Profile Information

**Operation**: `UserQuery`

**Request Structure**:

```json
{
  "operationName": "UserQuery",
  "variables": {},
  "extensions": {
    "persistedQuery": {
      "version": 1,
      "sha256Hash": "md5:f4a5ebcc4103cf23f7e582af45b0edd0"
    }
  }
}
```

**Response Structure**:

```json
{
  "data": {
    "me": {
      "first_name": "string",
      "last_name": "string",
      "username": "string",
      "email": "string",
      "phone": "string",
      "address": "string",
      "city": "string",
      "state_code": "string",
      "zip_code": "string"
    }
  }
}
```

**Key Fields**:

- `me.first_name`, `me.last_name`: User name
- `me.email`: User email address

---

## 2. List All Accounts

**Operation**: `HomeFeedAccountsQuery`

**Request Structure**:

```json
{
  "operationName": "HomeFeedAccountsQuery",
  "variables": {},
  "extensions": {
    "persistedQuery": {
      "version": 1,
      "sha256Hash": "md5:ca98a6f37e5df3c609f762c922dd5edb"
    }
  }
}
```

**Response Structure**:

```json
{
  "data": {
    "user": {
      "bank_account_v2": {
        "savings_account": "object | null",
        "primary_funding_account": {
          "id": "string (UUID)",
          "account_name": "string",
          "display_balance": {
            "amount": {
              "value": "string (decimal)"
            }
          }
        },
        "secured_credit_account": "object | null"
      }
    }
  }
}
```

**Key Fields**:

- `bank_account_v2.primary_funding_account.id`: Account UUID
- `bank_account_v2.primary_funding_account.account_name`: Account type (e.g., "Checking")
- `bank_account_v2.savings_account`: Savings account (if exists)
- `bank_account_v2.secured_credit_account`: Credit account (if exists)

---

## 3. List Available Statements

**Operation**: `DocumentsQuery`

**Request Structure**:

```json
{
  "operationName": "DocumentsQuery",
  "variables": {
    "account_types": ["credit", "checking", "savings"]
  },
  "extensions": {
    "persistedQuery": {
      "version": 1,
      "sha256Hash": "md5:a17bd74480800ce36bfbc0c4b1516bae"
    }
  }
}
```

**Request Parameters**:

- `account_types`: Array of account types to query - `["credit", "checking", "savings"]`

**Response Structure**:

```json
{
  "data": {
    "statements": {
      "statement_accounts": [
        {
          "name": "string",
          "account_type": "string",
          "statement_periods": [
            {
              "display_name": "string (Month Year)",
              "id": "string (opaque prefix plus YYYYMMDD suffix)",
              "month": "number",
              "year": "number"
            }
          ]
        }
      ]
    }
  }
}
```

**Key Fields**:

- `statement_accounts`: Array of accounts with available statements
- `statement_periods`: Array of available statement periods for each account
- `statement_periods[].month`, `statement_periods[].year`: Used as parameters for downloading statements.
  Represent the month at UTC midnight on its first day in the shared contract and
  use UTC month/year when constructing the download request.
- `statement_periods[].display_name`: Human-readable period name (e.g., "October 2025")

---

## 4. Download Statement PDF

**Operation**: `GetMonthlyPdfStatementQuery`

**Request Structure**:

```json
{
  "operationName": "GetMonthlyPdfStatementQuery",
  "variables": {
    "account_types": ["checking"],
    "month": 10,
    "year": 2025
  },
  "extensions": {
    "persistedQuery": {
      "version": 1,
      "sha256Hash": "md5:409087bebf32f903eaab1e1498e1a724"
    }
  }
}
```

**Request Parameters**:

- `account_types`: Array with single account type - `["checking"]`, `["savings"]`, or `["credit"]`
- `month`: Month number (1-12)
- `year`: Year (e.g., 2025)

**Parameter Source**: The `month` and `year` values come from the `DocumentsQuery` response (`statement_periods` array).

**Response Structure**:

```json
{
  "data": {
    "statements": {
      "statement_accounts": [
        {
          "name": "string",
          "monthly_pdf_statement": {
            "encoded_pdf": "string (base64)"
          }
        }
      ]
    }
  }
}
```

**Key Fields**:

- `monthly_pdf_statement.encoded_pdf`: Base64-encoded PDF file content. Decode to get the actual PDF binary.

## Checking account-number lookup

`AccountInfoQuery` uses an empty variables object and persisted hash
`md5:e57adf8d54262ff92f7b952f3aac90b7`. Its observed response shape is:

```json
{
  "data": {
    "me": {
      "bank_account_v2": {
        "primary_funding_account": {
          "id": "<same-checking-id-as-overview>",
          "account_number": "<checking-account-number>",
          "routing_number": "<routing-number>"
        }
      }
    }
  }
}
```

Only the matched account number's last four digits enter the shared Account.
Do not return the full account/routing number to the popup. Missing or mismatched
checking details must fail explicitly rather than reverting to a UUID suffix.

## Savings account-number lookup

The public web application's Account Info and Account Details query definitions
select account numbers only from `primary_funding_account`. Their persisted hashes
cannot be reused as if they also selected savings details.

A read-only authenticated request with the following full query returned HTTP 200,
no GraphQL errors, and `data.me.bank_account_v2.savings_account: null` in the
checking-only session:

```graphql
query SavingsAccountInfoQuery {
  me {
    bank_account_v2 {
      savings_account {
        id
        account_number
      }
    }
  }
}
```

This verifies that the endpoint accepts full query text and these savings fields,
not that populated savings details or downloads have been tested. When the
overview contains a savings account, issue this query, require the same account
ID and a digit-only account number, and expose only its last four digits. Missing
or mismatched details must fail explicitly, never fall back to the UUID suffix.
Do not reuse the checking account number for savings. An explicitly null overview
savings account requires no additional request.

## Mapping and failure handling

The existing readable-cookie session/profile mapping is retained. Login,
refresh, cross-user switching, and the historical `__Host-authn` fallback were
not independently validated. The extension does not manage authentication.

Profile and account responses must contain their expected objects. Only an explicit
`primary_funding_account: null` or `savings_account: null` means that respective
account is absent. A missing field, malformed account object, or missing/blank/
non-string ID must fail before requesting its details; otherwise the extension
could cache a false "no accounts" result. This validation applies to checking and
savings, not the unchanged credit mapping.

A missing statement list is not equivalent to an empty one; an explicit empty array or
absent type bucket can legitimately mean no statements. Invalid period IDs or
month/year fields must fail rather than silently dropping rows or normalizing
an invalid month. The shared statement date is the first day of the selected
month at UTC midnight; download month/year are read in UTC.

The download requests one account type. An ambiguous multi-account response must
not select whichever PDF appears first. Decode the single result and reject
non-PDF bytes; a `%PDF-` signature alone does not establish complete PDF acceptance.
