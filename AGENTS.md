# AGENTS

This file is the entry point for agents and defines the durable principles they follow in this repository. Keep task workflows, harness-specific procedures, and operator guides in `docs/` and `.agents/skills/`.

## Principles

- **Write documentation in English.** Use English for repository documentation, skills, analysis notes, and technical guides.
- **Keep this file principle-only.** Put project workflows, browser-operating procedures, and implementation playbooks outside `AGENTS.md`.
- **Protect sensitive data.** Replace personal data, credentials, cookies, session tokens, and other banking secrets with scrubbed or placeholder values before they enter the repository.
- **Keep bank logic isolated.** Implement bank-specific behavior in `bank/*.mjs` against the shared contract in `bank/bank.types.ts`, and avoid leaking one bank's assumptions into another bank's module.
- **Prefer small, reversible changes.** Make focused edits that preserve existing behavior unless the task explicitly requires broader architectural work.
- **Keep dependency scopes separate.** Run repository commands from the repository root and use `npm ci` when root dependencies need restoring. Skill-local dependencies are installed separately in their skill folders.
- **Verify with evidence.** Run checks relevant to the change and report the checks actually run. Use `npm run check` after code changes, and use `npm run test` when behavior or tests change. Report failures explicitly and never treat incomplete or skipped checks as passing.
- **Separate user and agent documentation.** Keep `README.md` focused on the product and its users. Use `AGENTS.md` for agent principles and links to technical guidance in `docs/`. Do not add agent workflow or skill introductions to `README.md`.
- **Maintain ordered data deterministically.** Keep sorted lists sorted, especially manifest host permissions, match patterns, and web-accessible resource arrays.

## Agent documentation

- [Bank Development Workflow](docs/bank-development.md) - From an authenticated session and network evidence to implementation and real-download validation.
- [Bank Analysis Format](docs/bank-analysis-format.md) - Required report content, evidence standards, and redaction rules.
- [Extension Architecture](docs/architecture.md) - Components, message flow, and caching.

## Important paths

- `bank/` — bank-specific implementations
- `tests/` — bank unit tests
- `extension/` — browser extension runtime
- `analyze/` — scrubbed bank API analysis notes
- `.agents/skills/` — Pi skill workflows for this repo
- `docs/` — technical and operator documentation
