# Bank Development Workflow

Use this workflow to add a bank, investigate an API change, or validate an existing
integration. Follow the [repository principles](../AGENTS.md) and consult the
[architecture](architecture.md) for component responsibilities.

The sequence is: prepare an authenticated session, collect network evidence, update
the bank analysis, implement the change, and verify a real statement download.
For an existing integration, reuse evidence that is still valid and repeat only the
stages needed for the task. A live-validation-only task does not require code changes.

## 1. Prepare an authenticated session

Identify the bank, account types, and operation being investigated. Read its existing
document in [analyze/](../analyze/) and implementation in [bank/](../bank/) before
opening the site; historical validation is not proof of current behavior.

Follow the [Chrome extension control skill](../.agents/skills/chrome-extension-control/SKILL.md)
for machine setup, a visible persistent browser, and loading this repository's extension.
Use the pinned upstream reference linked there for browser commands rather than
duplicating its instructions here.

Have the user complete login and any MFA, CAPTCHA, or consent prompts directly in
the browser. Do not request passwords or verification codes in chat, or export
authentication values. Keep the bank tab open and confirm that an authenticated
account or statement page is accessible.

If login is unavailable or the session expires, report the workflow as blocked and
ask the user to resume authentication. Do not assume that the persistent profile
guarantees a valid session.

**Ready when:** the intended bank tab is authenticated and the extension is loaded.

## 2. Collect network evidence

Use the bank's own UI first to establish the expected behavior. Prepare network
inspection on the relevant page before performing each operation:

1. Open the account overview and identify the profile/account requests.
2. Open the statement list, including any required account, date, or pagination filters.
3. Download a user-approved statement to a private location outside the repository.
4. Repeat for materially different account types or download flows within scope.

Use upstream `list_network_requests` and `get_network_request` to inspect the
requests and responses associated with each action, then write sanitized findings
directly into `analyze/<bank>.md` as observations are made. No intermediate
trace export or conversion is needed. Prefer targeted inspection over dumping an
entire session. Include redirects, document responses, and relevant secondary
domains; a PDF need not arrive as a fetch request on the bank's main domain.
Re-select the page if the site opens a new tab.

In the pinned CLI, network listings default to the current navigation;
`includePreservedRequests` covers only the last three navigations. Inspect and
record sanitized findings after each action, before navigating further or
restarting the browser. Request IDs are session-local references, not durable
identifiers.

Raw captures and PDFs are private artifacts, not repository deliverables. If raw
artifacts must be saved locally, keep them outside the repository and do not paste
their contents into reports. Sanitize excerpts before recording them.

**Complete when:** evidence covers the scoped operations, or explicitly identifies
what must be recaptured. Missing evidence must not be replaced with guessed endpoints.

## 3. Update the bank analysis

Maintain `analyze/<bank>.md` using the existing bank's filename convention. Update
the relevant sections instead of replacing valid analysis wholesale. Keep bank
details here, not in the generic browser skill.

Reconcile new observations with existing findings and review the report against
the [Bank Analysis Format](bank-analysis-format.md). Return to the browser for
missing evidence before relying on an uncertain conclusion to implement an API call.

**Complete when:** the document explains where each required dynamic value comes
from and how the scoped flow works, with uncertainty visible rather than hidden.

## 4. Implement or update the integration

Follow the shared [bank contract](../bank/bank.types.ts) and existing patterns in
[bank/](../bank/). Keep bank-specific behavior in that bank's module and update its
tests in [tests/](../tests/) with synthetic or scrubbed examples. Cover the changed
behavior and relevant failures, without copying live authentication material.

For a new bank or changed domain, check all registration surfaces:

- [Content script](../extension/content.mjs): hostname detection and module import.
- [Background worker](../extension/background.mjs): supported-URL detection for the icon.
- [Manifest](../manifest.json): content-script matches, web-accessible module
  resources, and host permissions where required. Keep ordered lists deterministic
  and do not broaden permissions unnecessarily.
- [README](../README.md): supported capabilities and known limitations.

**Complete when:** the scoped change is wired through the extension, its analysis
is consistent with the implementation, and applicable local checks pass. These
checks do not replace the real download in the next stage.

## 5. Verify a real statement download

Use the actual extension, not just a direct API call or injected bank function:

1. Reload the unpacked extension after source edits, then reload the bank tab so
   its content script is current. Confirm that the authenticated session still works.
2. Keep the bank tab active and open the extension's toolbar action. An extension
   popup opened as an ordinary tab can see a different active-tab context.
3. Click the popup's Refresh accounts button to clear the extension's account and
   statement caches; reloading the bank page alone does not clear them. Expand the
   intended account and verify its statement list.
4. Select a user-approved statement and wait for the actual browser download.
5. Inspect the downloaded file locally with a PDF viewer or parser. Confirm that
   it is a readable PDF, not an HTML login page, JSON error, or truncated payload,
   and that it corresponds to the selected account or consolidated group and period.
6. Repeat for distinct flows within the agreed scope. Leave untested variants
   explicitly unverified.

A success message, HTTP 200, `.pdf` filename, file-size threshold, or `%PDF-` prefix
alone is insufficient. Record the file's byte count and the local readability and
selection checks without publishing statement contents, personal filenames, or
account details. Keep downloaded statements outside the repository.

Report the live-validation outcome and exercised scope in the task response.
Distinguish an observed implementation failure from a blocked session that needs
user intervention. Keep test-run results out of the bank analysis; update it only
when testing provides new API observations.

Return to evidence collection if a failure exposes an unknown API behavior.
Report local test results separately from live-validation results, and do not
claim broader coverage than was exercised. Remove only task-created temporary
artifacts when no longer needed; do not clear the user's profile or downloads.
