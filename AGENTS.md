# AGENTS

This file defines the durable principles the agent follows in this repository. Keep task workflows, harness-specific procedures, and operator guides in `docs/` and `.agents/skills/`.

## Principles

- **Write documentation in English.** Use English for repository documentation, skills, analysis notes, and technical guides.
- **Keep this file principle-only.** Put project workflows, browser-operating procedures, and implementation playbooks outside `AGENTS.md`.
- **Protect sensitive data.** Replace personal data, credentials, cookies, session tokens, and other banking secrets with scrubbed or placeholder values before they enter the repository.
- **Keep bank logic isolated.** Implement bank-specific behavior in `bank/*.mjs` against the shared contract in `bank/bank.types.ts`, and avoid leaking one bank's assumptions into another bank's module.
- **Prefer small, reversible changes.** Make focused edits that preserve existing behavior unless the task explicitly requires broader architectural work.
- **Verify with evidence.** Run checks relevant to the change and report the checks actually run. Use `npm run check` after code changes, and use `npm run test` when behavior or tests change.
- **Keep repository details in the right place.** Use `README.md` for human-facing product overview, and use `docs/` for technical or operator-facing details.
- **Maintain ordered data deterministically.** Keep sorted lists sorted, especially manifest host permissions, match patterns, and web-accessible resource arrays.

## Important paths

- `bank/` — bank-specific implementations
- `tests/` — bank unit tests
- `extension/` — browser extension runtime
- `analyze/` — scrubbed bank API analysis notes
- `.agents/skills/` — Pi skill workflows for this repo
- `docs/` — technical and operator documentation
