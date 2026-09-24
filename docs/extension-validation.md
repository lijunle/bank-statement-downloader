# Extension Validation Workflow

Use this standalone workflow to determine whether the actual extension works for
an explicitly scoped bank/account flow: open an authenticated bank page, use the
real toolbar popup, inspect its UI, and verify the resulting downloaded document.
It requires no development, code changes, unit tests, or new bank API analysis.
It also serves as the final acceptance step of the
[Bank Development Workflow](bank-development.md).

Follow the [repository principles](../AGENTS.md). Use the
[Chrome extension control skill](../.agents/skills/chrome-extension-control/SKILL.md)
for browser setup, extension loading, toolbar actions, and inspection commands;
use the pinned CLI reference linked there for command syntax. This document
defines acceptance evidence, not tool- or platform-specific procedures.

## 1. Define the scope and confirm access

Agree on the bank, supported account type/flow, and a representative statement
the user approves downloading. Keep the actual account and period selection
private; use neutral aliases such as `account A` and `statement A` in reports.
Use the bank's UI and any existing reference in [analyze/](../analyze/) to establish
expected behavior and supported limits. Existing analysis is useful context,
not proof that the integration currently works, and creating new analysis is not
a prerequisite.

For a quick check, default to one representative statement for one explicitly
scoped flow. Cover additional materially different flows only if claiming them
as validated, for example separate account types or consolidated statements.
Choose popup reopening, account switching, and cache-lifecycle checks when they
matter to the scope; do not automatically expand every smoke check into all
possible lifecycle cases. List excluded operations in the result.

Have the user complete authentication, MFA, CAPTCHA, and consent directly in the
visible browser when needed. Never request credentials or verification codes in
chat or put them in records. Confirm that the intended authenticated account or
statement page is accessible. A persistent browser profile does not guarantee a
valid session.

If login, bank access, or the required statement is unavailable, identify the
blocked check and ask for user intervention when appropriate. A bank or login
failure is not proof of an extension bug.

## 2. Open the actual popup and refresh accounts

Verify that the intended extension is loaded using the browser skill. Reload it
only when needed, such as after source changes. After a reload, reopen the popup;
reload existing bank pages when current content scripts need to be injected, and
reconfirm authentication. Unchanged installations do not need a reload for every
validation.

Keep the intended bank tab active and open the extension's real toolbar action.
Do not open the popup's extension URL as an ordinary tab: that changes the active
tab context used to select the bank. Keep the bank tab active while interacting
with the popup.

Once the initial load finishes, click the header refresh icon titled
**Refresh accounts**. Wait for refresh to finish and the button to become enabled
again. This clears the extension's cached account and statement results and
reloads accounts; refreshing the bank page alone does not clear those caches.
Do not accept an indefinitely loading popup as a successful refresh.

## 3. Check account mapping

Compare the refreshed account list with the supported scope and the bank's UI or
known analysis:

- Account names and displayed masks identify the expected accounts. Compare
  these privately without copying names or masks into the report.
- Each entry is associated with the correct account or documented consolidated
  group; there is no stale or cross-account data.
- There are no unexplained missing or duplicate supported accounts within scope.
  Do not require unsupported account types to appear.

The popup shows account names and masks in expandable headers; it does not expose
every bank-side account field. Use the expected mapping rather than requiring
additional UI fields. **No accounts found** can be a legitimate empty state if
there are no supported accounts, but it is a discrepancy if supported accounts
are expected. An account-load error is not an empty state.

## 4. Check the selected account's statements

Click the selected account header to expand it and wait for **Loading
statements...** to resolve. Verify:

- The displayed statement dates, ordering, and available PDF periods match the
  bank's UI or established behavior within the supported history window. The
  popup presents dated statement rows, not separate period filters or PDF
  availability controls.
- The list belongs to the selected account or consolidated group, without
  unexplained omissions, duplicates, stale results, or cross-account statements.
- **No statements available** is consistent with the bank's actual PDF
  availability. Do not treat **Failed to load statements** or an unresolved
  loading state as a normal empty list.

Account visibility alone proves neither statement listing nor downloads. If no
PDF is available, report the empty-state/UI check separately; it cannot establish
a successful PDF-download end-to-end (E2E) result.

## 5. Download and inspect the selected document

1. Before clicking, establish the current browser download state so that an
   existing file cannot be mistaken for this action's result. Arrange a private
   destination outside the repository.
2. Click the user-approved statement row through the real popup. Observe its
   **Downloading...** state and any result or error, then verify a new browser
   download starts and completes. Correlate that download with this click using
   the browser's download entry, timing, and local file. Avoid concurrent downloads
   that make attribution ambiguous; if attribution cannot be established, the
   download check is incomplete. Do not inspect an arbitrary latest or older PDF.
3. Inspect that exact completed file locally. Record its byte count, then open it
   with a local PDF viewer or renderer and check that its pages render/read
   correctly, rather than containing an HTML login page, JSON error, or truncated
   document. Parser checks can supplement rendering; a text-extraction failure
   or lack of extracted text alone does not prove corruption. Blank or image-only
   pages are not automatically invalid; inspect them in context with a local
   viewer or renderer.
   The standalone [PDF validation skill](../.agents/skills/pdf-validation/SKILL.md)
   provides a local parser/renderer for this step. Pass the exact file correlated
   with the download; its file-level result does not establish extension E2E
   success or replace the account/period check.
4. Privately verify that the document corresponds to the selected account or
   documented consolidated group and statement period. Check the document itself,
   not just its filename. Report only whether these checks matched, not account
   details or statement contents.

The popup's **Downloaded** status means it triggered a download, not that the
browser finished saving a valid statement. A success message, HTTP 200, `.pdf`
filename, byte-size threshold, or `%PDF-` magic header alone is insufficient.
No fixed file-size threshold establishes readability or correctness.

A quick check does not require a full network capture, another download through
the bank's UI, or byte-for-byte identity with a bank-UI download. Use targeted
comparison only when needed to resolve a discrepancy. Keep PDFs, rendered pages,
raw diagnostics, and personal filenames private and outside the repository;
do not upload them to external inspection services.

## 6. Decide and report the outcome

Assign outcomes to the checks actually attempted and state the overall scope:

- **PASS:** all checks required by the stated scope have evidence of correct
  behavior. A **PDF-download E2E PASS** requires the real toolbar flow, refreshed
  account mapping, statement listing, the new completed download attributable to
  the selected row, local readability/rendering, and account/group and period
  correspondence. It covers only the exercised flow.
- **FAIL:** observed extension behavior contradicts the scoped expectation, such
  as wrong account mapping, missing available statements, an extension download
  failure, or an unreadable or mismatched downloaded document. State the failed
  stage and evidence; do not invent a root cause.
- **BLOCKED:** a prerequisite or required evidence is unavailable, for example
  expired authentication, bank unavailability, no user-approved PDF available,
  browser download restrictions, or inability to inspect or attribute the file.
  Explain what is needed to resume. An unresolved bank-versus-extension cause
  must not be reported as a confirmed extension bug.

A correct no-PDF state can receive **PASS (empty-state/UI only)**. If a PDF-download
E2E check was requested, report that check as **BLOCKED** when no PDF is available,
not as passed. Partial UI success cannot substantiate full E2E PASS. Retain any
observed failures even when another stage is blocked.

Separately list **untested** operations (not exercised or not completed) and
**inapplicable** operations (unsupported or not relevant to this flow), with
reasons. Additional accounts, periods, flows, or lifecycle cases must not inherit
a PASS from the representative check.

Use a concise sanitized result in the task response, for example this template:

```text
Scope: <bank>; <supported account type/flow>; account A; statement A
Checks: authenticated page <result>; real toolbar + refresh <result>;
        account mapping <result>; statement dates/order/availability <result>
Download evidence: <new completed download correlated with the popup click, or gap>;
                   bytes=<count or not obtained>; local viewer/renderer=<tool>;
                   rendering/readability=<result>; account/group match=<result>;
                   period match=<result>
Result: <PASS (PDF-download E2E) | PASS (UI only) | FAIL | BLOCKED>; <reason>
Untested: <operations and limitations>
Inapplicable: <operations and reasons>
Next action: <only if needed>
```

Do not include credentials, cookies, tokens, session identifiers, personal
filenames or paths, account details, statement contents, or unsanitized errors.
Routine validation-run logs do not belong in [analyze/](../analyze/); update a
bank's analysis only for new bank/API observations, following the
[Bank Analysis Format](bank-analysis-format.md). Remove only task-created temporary
artifacts when no longer needed; do not clear the user's profile or downloads.

## On discrepancies: targeted diagnostics

Diagnostics are not a prerequisite for a normal quick check. Use the browser
skill and its pinned CLI reference for commands, and the
[architecture](architecture.md) to locate the relevant component:

- **Popup:** inspect the actual popup's UI, errors, and console to distinguish
  rendering or click handling from a failed response. A transient success status
  is not file evidence.
- **Bank page/content script:** reconfirm authenticated bank-UI behavior, then
  inspect relevant console messages and requests for content-script availability,
  account/session association, and bank API errors.
- **Extension service worker:** inspect message routing, cache behavior, and
  worker-side errors. The `requestFetch` route issues requests in the worker, so
  they may not appear in the bank tab's network list. The pinned CLI's network
  tools are page-scoped; do not assume they accept `--serviceWorkerId`. Use the
  worker's Chrome DevTools target if worker network details are needed.
- **File/download:** distinguish a failed API response or document transformation
  from a browser save failure, then inspect the exact downloaded file locally.

Keep inspection targeted and retain only sanitized findings. Main-world page
evaluation does not run in the content script's isolated world. Direct bank-module
or API invocation can help diagnose a discrepancy but bypasses the actual
extension flow and cannot replace its acceptance evidence.

If new or unknown bank/API behavior requires implementation work, hand off to
the relevant stages of the [Bank Development Workflow](bank-development.md).
After a fix, rerun the affected scope through this workflow; diagnostic success
alone is not a PDF-download E2E PASS.
