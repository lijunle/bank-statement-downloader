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

The agent performs the checks below, compares observations with the bank's UI and
expected behavior, and determines the scoped outcome; skills provide operations
and evidence, not the final verdict. The user handles authentication and consent.

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

1. Download a user-approved statement through the real popup to a private location
   outside the repository. Confirm that the completed file belongs to this click,
   not an earlier download.
2. Use the [PDF validation skill](../.agents/skills/pdf-validation/SKILL.md) to
   inspect that exact file, verify every page can render, and search its text for
   the bank name, account name or account number/mask, and statement period.
   For consolidated statements, verify the expected account group. Obtain
   expectations from the selected bank account and statement, not the candidate PDF.
   The agent must choose these expected values from the bank UI, invoke the skill,
   and verify that its results confirm the selected bank, account/group, and period.
3. Keep the same unchanged file throughout these checks. Record its byte count and
   whether the document and content checks completed successfully; retain only
   sanitized evidence in the result.

All three PDF capabilities are required for a download E2E pass. A PDF requiring
an opening password fails this workflow; do not request a password. Repairs,
warnings, or unconfirmed content must not be treated as a pass. Technical
renderability and text matches do not establish visual layout correctness.
Use the skill and its command help for invocation and result details.

A popup success message, HTTP status, filename, file size, or command exit code
alone is not sufficient evidence. A quick check does not require another bank-UI
download or a full network capture; investigate discrepancies only as needed.
Keep PDFs, expected values, and raw diagnostics private and outside the repository.

## 6. Decide and report the outcome

Assign outcomes to the checks actually attempted and state the overall scope:

- **PASS:** all checks required by the stated scope have evidence of correct
  behavior. A **PDF-download E2E PASS** requires the real toolbar flow, refreshed
  account mapping, statement listing, the new completed download attributable to
  the selected row, local parsing/in-memory rendering, and required text matches
  consistent with the selected account/group and period. It covers only the
  exercised flow, not visual layout or completeness.
- **FAIL:** observed extension behavior contradicts the scoped expectation, such
  as wrong account mapping, missing available statements, an extension download
  failure, or an unreadable or mismatched downloaded document. State the failed
  stage and evidence; do not invent a root cause. A downloaded statement that
  requires an opening password also fails this workflow's acceptance policy;
  that does not by itself prove a bank API or extension implementation bug.
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
                   bytes=<count or not obtained>; local parser/renderer=<tool>;
                   document checks=<result>; content checks=<result>;
                   account/group match=<result>; period match=<result>
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
