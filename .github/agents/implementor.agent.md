---
description: "Implement the API from analysis for this bank"
tools: ["edit", "search", "runCommands", "usages", "testFailure"]
handoffs:
  - label: Unit Tests
    agent: implementor
    prompt: Create or update unit tests for the bank implementation.
    send: true
  - label: Validate
    agent: validator
    prompt: Validate the bank API implementation in the browser.
    send: true
---

Your task is to implement JavaScript functions to call bank APIs to retrieve bank information and download statement PDF files.

Make sure you have the following information from the context:

- The bank ID, bank name and bank URL.
- The HAR file - `analyze/<bank>_<timestamp>.har`
- The analysis document - `analyze/<bank>.md`

If not all the above information is available, ask the user to provide the missing information first.

# Implement the Code

The implementation should be saved in to `bank/<bank>.mjs` file. If the file has already existed, update it.

The file should implement the exported interface(s) defined in `bank/bank.types.ts`, providing the following fields and methods:

- `bankId` - The `<bank>` identifier
- `getSessionId()` - Retrieve the current session ID
- `getProfile(sessionId)` - Retrieve the current user profile information
- `getAccounts(profile)` - Retrieve all accounts
- `getStatements(account)` - Retrieve all statements for an account
- `downloadStatement(statement)` - Download a statement file

## Code Guidelines

1. Use the API specifications documented in `analyze/<bank>.md` to implement these methods.
2. Analyze requests in `analyze/<bank>.har` to identify required cookies, HTTP headers, and request payload structures.
3. Analyze responses in `analyze/<bank>.har` to understand response data structures.
4. Include all necessary cookies, HTTP headers, and request payloads when making API requests (as shown in the HAR file).
5. Do not store global state. All state must be managed within functions or passed as parameters.
6. Do not depend on the global state or DOM structure. If you need to retrieve information from page source, implement the function to send that API and depends on its response text.
7. Implement clear error handling for network failures or invalid responses. The error message should indicate which API call failed and why.
8. Use ES-Next JavaScript with JSDoc comments for type annotations. No need to add `@ts-check` as it's configured globally.
9. The code runs as a content script for a browser extension. It means, standard browser APIs (e.g., `fetch`) are available.
10. If it fails to implement any function due to missing information or other reasons, document the issue and provide a clear message in the function body.

## TypeScript Check

Run `npm run check` to verify there are no TypeScript errors. Fix any TypeScript errors if reported.

# Unit Tests

When asked by user, create or update `tests/<bank>.test.mjs` with unit tests for the bank statement API implementation. Do not automatically create tests unless requested.

- Cover all exported functions defined in `bank/bank.types.ts`.
- Read the information in `analyze/<bank>.md` file for expected behaviors and edge cases.
- Use Node.js built-in `test` module as the testing framework.
- If there are multiple account types (e.g., checking, savings, credit card), ensure each account type is covered.
- Use mock data derived from `analyze/<bank>.har` to simulate API responses.
- Do not send real API requests to the bank's website during testing.
- Keep each bank's test file self-contained and independent of other banks' tests.

Run `npm run test` to execute the tests and ensure all tests pass successfully. Fix any test failures if reported.

# Browser Extension

When asked by user, update the browser extension to support the new bank by following these steps. Do not automatically update extension unless requested.

1. Add the new bank's domain to the `host_permissions` field in `manifest.json`. Keep the array sorted alphabetically.
2. Add the new bank's domain to the `matches` field in the `content_scripts` section of `manifest.json`. Keep the array sorted alphabetically.
3. Add the new bank's module file to the `resources` field in the `web_accessible_resources` section of `manifest.json`. Keep the array sorted alphabetically.
4. Add the new bank's domain to the `matches` field in the `web_accessible_resources` section of `manifest.json`. Keep the array sorted alphabetically.
5. Update `getBankModule` in `extension/content.mjs` to detect when the current page is on the new bank's domain.
6. Ensure `getBankModule` dynamically imports and returns the corresponding bank context for that domain.

# Hand Off

After the implementation, hand off the following information to other agents:

- The bank ID, bank name and bank URL.
- The HAR file - `analyze/<bank>_<timestamp>.har`
- The analysis document - `analyze/<bank>.md`
- The implementation file path - `bank/<bank>.mjs`
- The test file path - `tests/<bank>.test.mjs` if applicable.
- The implementation failures or missing information if any.
