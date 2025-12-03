# Chime Statement API Analysis

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

**Note**: Chime uses Automatic Persisted Queries (APQ) with MD5 hashes. All requests include an `extensions.persistedQuery` field instead of full query text.

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

**Important**: The MD5 hash values below are **static and can be used directly** - you don't need to compute them or worry about how they're generated. Simply use these exact values in your requests.

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
              "id": "string (format: {account_id}_{YYYYMMDD})",
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
- `statement_periods[].month`, `statement_periods[].year`: Used as parameters for downloading statements
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
