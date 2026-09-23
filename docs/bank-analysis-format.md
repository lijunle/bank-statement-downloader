# Bank Analysis Format

This document defines the information expected in `analyze/<bank>.md`. It is a
content standard, not a fixed heading template. Organize each report around the
bank's actual API flow and preserve valid existing analysis when updating it.
If required information is unknown, record the gap instead of inventing a value.
This is an API reference, not a test-run report.

## Analysis date

Every report must have exactly one analysis date, directly below its title:

```markdown
**Analysis as of:** YYYY-MM-DD
```

Use an ISO 8601 calendar date for the latest substantive investigation based on
bank website or API evidence. Advance it only when new evidence is incorporated,
not for editorial, formatting, or code-only changes. It does not mean that every
account type or API path was revalidated on that date.

For historical reports, prefer an explicit, reliable analysis or observation date;
otherwise use a capture date that represents the report's evidence. If no reliable
full date is available, use the author date of the Git commit that first introduced
the report, following renames. This is a best-effort historical fallback, not a
confirmed observation date: imported repositories may lack the original history.
Do not use the latest file modification or commit date as a substitute.

Replace other analysis-time labels such as `Analysis Date`, `Last Updated`,
`Captured`, `Browser Observation Date`, and `Trace Date`, including dates in section
headings or observation prose. Keep historical context and evidence references
without additional analysis dates. Preserve business dates in API examples,
statement periods, and request parameters.

## Required information

- **Scope and provenance:** bank identifier, relevant site/API domains, the single
  `Analysis as of` date, and account types investigated. Link each observed UI action
  to the corresponding request method, endpoint, and sanitized response excerpt.
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
- Distinguish current evidence from historical findings in the prose, without
  adding separate observation dates.
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
