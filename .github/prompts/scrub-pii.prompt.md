---
agent: agent
---

Scan the provided file for any personal information and scrub it with fake data.

- User name. Replace with "John Doe"
- Birthday. Replace with "January 1, 1990"
- Email. Replace with "john.doe@example.com"
- Address. Replace with "123 Main St, Anytown, USA" or similar format
- Phone number. Replace with "1234567890"
- Social Security Number (SSN) or equivalent. Replace with "123-45-6789"
- Various ID and token. Replace each digit with a random digit and each letter with a random letter, preserving length and format
  - Account ID
  - Account number
  - Account mask
  - Account key
  - Account token
  - Client ID
  - Device ID
  - Device token
  - MFA token

Ensure that the replacements maintain the original formatting and structure of the codebase.

If you find any personal information not listed above, please report it and suggest a suitable fake replacement.

Make sure `npm run test` passes after your changes.
