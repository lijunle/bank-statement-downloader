# Bank Analysis Format

This document defines the information expected in `analyze/<bank>.md`. It is a
content standard, not a fixed heading template. Organize each report around the
bank's actual API flow and preserve valid existing analysis when updating it.
If required information is unknown, record the gap instead of inventing a value.
This is an API reference, not a test-run report.

## Required information

- **Scope and provenance:** bank identifier, relevant site/API domains, observation
  date, and account types investigated. Link each observed UI action to the
  corresponding request method, endpoint, and sanitized response excerpt.
- **Authentication:** how the authenticated page supplies session and CSRF
  material, where those values come from, and observed expiration behavior.
  Describe mechanisms and field names, not live credentials or token values.
- **API sequence:** profile, account list, statement list, and download operations.
  For each operation, record the method, endpoint, relevant headers, request
  parameters/body, response status and structure, and sanitized examples. Identify
  the source of every dynamic value and dependencies on earlier responses, page
  state, or user selections. If no request is involved, document the actual source.
- **Contract mapping:** explain how source fields map to the
  [bank contract](../bank/bank.types.ts), including profile/account/statement
  identifiers, account types and masks, date conversions, and the downloaded Blob.

## Bank-specific details

Include these when applicable, without adding empty sections for every possibility:

- GraphQL operation names, variables, and the response fields used.
- Pagination, date filters, and other limits on account or statement listings.
- Separate APIs or authentication contexts for different account types.
- Consolidated statements and how they relate to individual accounts.
- Download redirects, secondary domains, encoded PDF payloads, or client-side
  generation, including transformations needed to obtain the final document.
- Observed error responses, unsupported operations, and unresolved questions.

## Evidence rules

- Distinguish direct observations, conclusions derived from code, and untested
  assumptions. Record the basis for a conclusion so another agent can check it.
- A header appearing in a request does not establish that it is required.
- A successful request proves only the exercised path, not all account types.
- Date observations so readers can distinguish current evidence from historical
  findings.
- Browser request IDs are useful during inspection but are not durable evidence
  references. Retain the action, method, endpoint, and relevant sanitized structure.
- When new observations contradict older findings, update the affected conclusion
  and explain the changed evidence rather than leaving both as current facts.

## Redaction rules

Before recording examples, replace passwords, verification codes, cookies, tokens,
signed URL values, account identifiers, and personal data with consistent
placeholders. Preserve field names, types, nesting, and relationships needed to
understand the flow; use synthetic values when a particular format matters.

Do not embed raw session dumps, statement PDFs, or their encoded contents. Describe
binary or encoded response fields without including the private document payload.
Reports must remain useful without access to the author's private captures.
