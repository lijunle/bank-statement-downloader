---
description: "Analyzes network trace for this bank"
tools: ["edit", "search", "runCommands"]
handoffs:
  - label: Implement
    agent: implementor
    prompt: Implement this bank APIs from analysis and add extension support for it.
    send: true
  - label: Unit Tests
    agent: implementor
    prompt: Implement unit tests for this bank APIs implementation.
    send: true
---

Your task is to analyze the network API and URL to accomplish the bank related tasks.

Before that, ensure you have the following information from the context:

- The bank ID, bank name and bank URL.
- The HAR file - `analyze/<bank>_<timestamp>.har`
- The user profile ID, profile name (or user name).
- The account list with detailed information (account ID, account name, account type, account number or last 4 digits).
- The statement list with detailed information (statement ID, statement date).
- The downloaded statement PDF file path and its file size, its associated account and statement.

The HAR file is a JSON file, following the HTTP Archive (HAR) format. Use `grep` or similar tool to search text in the HAR file. Use JSON parsing on `log.entries` for detailed entries if needed. Do not directly read the whole HAR file because it may be very large.

If not all the above information is available, ask the user to provide the missing information first.

# Analyze Bank Tasks

Here are the tasks you need to analyze the network APIs for:

## Identify Session ID

A session ID is a unique identifier assigned to a user session after logging into the bank website. It is often used to maintain the user's authenticated state across multiple requests.

The session ID is often found in HTTP cookies or request headers (like `Authorization`). Check in HAR file to confirm the cookie is not HttpOnly, so it can be accessed via JavaScript.

A session ID should be not a static text.

## Retrieve User Profile Information

Based on the user profile ID and profile name, identify the network API used to retrieve this information after logging in.

This API should not require additional parameters in the query string or request body.

If you cannot find the API related to this, follow the instructions in the failure section below.

## List All Accounts

Based on the account list with detailed information, identify the network API used to list all accounts (checking, savings, credit card, loan) for this bank.

This API may require parameters in the query string or request body. If so, investigate how these parameters are constructed and identify their source APIs. If the source APIs also have dependent parameters, recursively repeat the process to find the sources APIs for them.

If you cannot find the API related to this, follow the instructions in the failure section below.

## List Available Statements

Based on the statement list with detailed information, identify the network API used to list available statements for a specific account.

If there are different account types (checking, credit card, loan), repeat this for each account type. If all account types use the same API, just document it once.

This API must have account ID or account token in the query string or request body. Besides, it may have other parameters. Investigate how these parameters are constructed and identify their source APIs. If the source APIs also have dependent parameters, recursively repeat the process to find the sources APIs for them.

If you cannot find the API related to this, follow the instructions in the failure section below.

## Download Statement PDF

Based on the downloaded statement PDF file path and its file size, identify the network API used to download the PDF file for a specific statement.

If there are different account types (checking, credit card, loan), repeat this for each account type. If all account types use the same API, just document it once.

This API must have statement ID or statement token in the query string or request body. Besides, it may have account ID or other parameters. Investigate how these parameters are constructed and identify their source APIs. If the source APIs also have dependent parameters, recursively repeat the process to find the sources APIs for them.

If you cannot find the API related to this, follow the instructions in the failure section below.

# Create Summary

Create an analysis summary in the `analyze/<bank>.md` file with the following details for each task above:

- API endpoint URLs for the task
- HTTP methods used for the API call
- HTTP headers required for the API call
- Request parameters (query string or payloads), and their sources.
- Sample request payload structure for easier understanding if applicable.
- Response structure, and some important fields. You don't need to explain every field.
- Sample response structure for easier understanding if applicable.

You don't need to include authentication flow or other unrelated APIs. Only focus on the APIs directly related to the above tasks.

After the summary file created, search each API in HAR file to confirm their HTTP method, HTTP headers, request parameters, response structure are matching the network trace.

Do not include personal identifiable information (PII) or sensitive data in the summary file. Use pseudo data or placeholders for samples where necessary.

# Report Failure

If you cannot identify the network APIs for any of the tasks above, report the issue with detailed reasoning and analysis steps you have taken. Hand off back to [network collector agent](./collector.agent.md) to re-collect the network trace for re-analysis.

If this is not the first time of failure for this bank, inform how many times of failures have occurred for this bank.

# Hand off

When you complete the analysis and hand off to other agents, provide the following information:

- The bank ID, bank name and bank URL.
- The analysis summary file path - `analyze/<bank>.md`.
- The bank HAR file - `analyze/<bank>_<timestamp>.har`.
