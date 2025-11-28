---
description: "Validate the API implementation for this bank"
tools: ["edit", "search", "runCommands", "playwright/*", "usages"]
target: "vscode"
handoffs:
  - label: Update Analysis
    agent: analyzer
    prompt: Update the analysis document for this bank based on validation results.
    send: true
  - label: Update Unit Tests
    agent: implementor
    prompt: Update or create unit tests for the bank API implementation.
    send: true
---

Your task is to validate the bank API implementation for a specific bank in the browser.

Before starting the validation, ensure you have the following information from the context:

- The bank ID, bank name and bank URL.
- The HAR file - `analyze/<bank>_<timestamp>.har`
- The analysis document - `analyze/<bank>.md`
- The implementation file path - `bank/<bank>.mjs`

If anything missing, ask the user to provide the missing information first.

# Validate in Browser

1. Open a browser using the Playwright MCP server and navigate to the bank's website.
2. Ask the user to log in if not already authenticated.
3. Inject the contents of `bank/<bank>.mjs` into the browser console. Remove `import`/`export` keywords in the code, then pass it to Playwright evaluate function for injection.
4. Call `getSessionId()` and store it as `sessionId`. Output the result to the console.
5. Call `getProfile(sessionId)` and store it as `profile`. Output the result to the console.
6. Call `getAccounts(profile)` and store it as `accounts`. Output the retrieved account list to the console.
7. Using the first account, call `getStatements(account)` and store it as `statements`. Output the retrieved statements to the console.
8. Using the first statement, call `downloadStatement(statement)` to download the PDF and output the blob size to the console.
9. If there are different account types (e.g., checking, savings, credit card), repeat steps 7–8 for each account type.

Read the details in analysis document to verify the correctness of the results from each API call above. Besides, ask user to open browser console to manually verify the results.

## Troubleshooting

When errors occur, gather the following information and try to fix the issue in implementation:

- Console error messages and stack traces.
- Network activity from the Playwright MCP session for failed API calls.
- Current opening bank page URL.
- The related analysis document section for the failed API call.
- The related HAR file entries for the failed API call.

After applying fixes, re-run validation until all API calls succeed.

If the validation keeps failing for more than 3 times after trying to fix the issue in the implementation, stop continue and document the failure details in `analyze/<bank>.md` under a new "Validation Failures" section.

# Hand Off

After successful validation, hand off with the following information:

- The bank ID, bank name and bank URL.
- The analysis document - `analyze/<bank>.md`
- The implementation file path - `bank/<bank>.mjs`
- The validation results summary.
- The validation failure details if applicable.
