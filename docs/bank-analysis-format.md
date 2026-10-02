# Bank Analysis Format

This file defines the writing rules and template for `analyze/<bank>.md`.
Use it with the [Bank Development Workflow](bank-development.md); field mappings
follow the [shared bank contract](../bank/bank.types.ts).

## Writing rules

- **Current API only:** explain how the API works and how to use it. Do not include
  past behavior, before/after comparisons, migration history, discarded approaches,
  or investigation chronology. Delete those narratives when updating a reference.
- **No execution reports in analysis:** exclude test counts, PASS/FAIL verdicts,
  downloaded-file sizes/page counts, parser/render or content-match results, and
  commit records. Sanitized validation results belong in the PR description or
  validation handoff, not in the analysis document.
- **Actionable wording:** lead with what to call or read, input sources,
  transformations, and result handling. Pair restrictions with the supported
  action or explicit failure behavior.
- **Evidence and uncertainty:** identify current claims as Observed, Code-derived,
  or Unverified, citing the UI trigger or code source. Write `Unknown` with the
  needed evidence when information is unavailable. Describe protocol behavior
  (status codes, fields, empty results), not the outcome of a test run. A header
  observed in a request is not automatically a demonstrated requirement.
- **One definition per fact:** define each operation and transformation once,
  then reference its operation ID. Replace superseded and duplicate descriptions
  in place. Describe simultaneous variants by their applicable conditions.
- **Redaction:** applies to all prose, examples, PR descriptions, and handoffs.
  Replace actual credentials, cookies, tokens, session identifiers, account details,
  signed URL values, and personal data with consistent placeholders or clearly
  synthetic values, including within URLs and error messages. Exclude private
  local paths, personal filenames, raw captures, private statement contents, and
  unsanitized errors. Preserve relevant field types and relationships in examples;
  examples must parse in their declared format. Use neutral aliases for accounts
  and documents in validation reports.
- **One analysis date:** place `Analysis as of` directly below the title. Advance
  it only for substantive bank/API evidence, not formatting or code-only changes.
  Keep business dates in examples and parameters separate from this metadata.

For an existing document with an unknown analysis date, use a reliable observation
or capture date; otherwise use its original Git author date as a best-effort
metadata fallback, following renames. Record only the resulting date, not the
recovery process. The latest file modification or commit date is not a substitute.

## Using the template

Keep all five sections, the scope table, and a compact contract-mapping table.
Repeat the operation block for distinct operations; one operation may provide
both profile and account data. Split rows or operations when product flows differ.

Fields marked **if** or **for** apply only under that condition. Omit inapplicable
fields; fill applicable unknowns explicitly. Other fields are required.
Authentication, inputs, headers, and limitations may use prose or a table,
whichever is clearer. Replace instructional placeholders when filling the
template; retain redaction placeholders in sanitized examples.

## Reference template

```markdown
# <Bank> Statement API Analysis

**Analysis as of:** YYYY-MM-DD

## Scope and evidence

**Bank ID:** <bank-id>
**Domains:** <site/API origins and their roles>

| Account type / flow | Evidence basis and source | Scope boundary |
| --- | --- | --- |
| <flow> | <Observed UI trigger / Code-derived source / Unverified> | <established behavior and limits> |

## Authentication and session context

**Session ownership:** <how the bank establishes/renews the session and what the integration does>
**Authentication material:** <cookie/token/CSRF/key names, exact sources, and operations using them>
**Lifecycle:** <expiry/recovery behavior or Unknown>
**Execution context:** <required page/origin/runtime and operation-specific differences>
**Acquisition or signing procedure, if needed:** <operation references for events, storage reads, or signing>

## API flow

**Sequence:** <operation IDs covering profile, accounts, statement listing and PDF retrieval; include branches and required repetition>

### OP-1: <Operation name>

**Purpose and flow:** <role and applicable products>
**Evidence basis:** <Observed UI trigger / Code-derived source / Unverified; use durable references, not browser request IDs>
**Context and prerequisites:** <execution origin/runtime, selected account, required state, preceding operations>

**Request, for HTTP:** <method, origin, endpoint, format and body; explicitly state an empty body>
**Query, for GraphQL:** <operation name, variables, persisted-query version/hash or full query text>
**Source and extraction, for non-HTTP operations:** <DOM/storage/event/computation source and extraction procedure>
**Inputs:** <fixed values and dynamic inputs, exact sources, transformations and optionality; or None>
**Headers, for HTTP:** <relevant application headers with values/sources and requirement evidence; reference shared authentication>

**Response and processing:** <status/content type where applicable; raw structure -> parsing/decoding -> usable fields; minimal sanitized example>
**Outputs:** <fields or values consumed by later operations or contract mapping>
**Errors and empty results:** <recognition and handling, including business errors within successful HTTP responses>

**Selection and association, if choosing accounts/documents:** <ID matching, eligibility, exclusions, deduplication, ambiguity, consolidated-account relationships>
**Pagination and statement coverage, for lists:** <filters, continuation, termination, ordering, available date range; distinguish UI and API paging>
**State and timing, if stateful:** <mutations, account reselection, reissue/refresh timing, reuse and concurrency constraints>
**Delivery, for downloads:** <selected reference -> request/generation -> redirects/secondary origins -> decoding -> PDF bytes; reference earlier definitions>

## Shared contract mapping

| Contract field / flow | Source operation and field | Meaning, conversion and runtime checks |
| --- | --- | --- |
| Profile.sessionId | <source> | <session association> |
| Profile.profileId / profileName | <source> | <identity/display rules> |
| Account.profile / Statement.account | <source> | <profile/account association> |
| Account.accountId / accountName | <source> | <selector/display rules> |
| Account.accountMask / accountType | <source> | <actual number suffix and classification> |
| Statement.statementId | <source> | <document identity and request use> |
| Statement.statementDate | <source> | <listing/closing/due date or represented month; format, timezone and conversion> |
| Downloaded Blob | <source> | <binary conversion and runtime checks> |

**Mapping assumptions, if any:** <label inferences beyond the cited operation evidence>

## Limitations and open questions

<List each Unsupported, Untested, or Unknown topic, the affected operation/flow,
and its current boundary or evidence needed. Reference earlier definitions.
If no gaps are known, state that for the defined scope.>
```
