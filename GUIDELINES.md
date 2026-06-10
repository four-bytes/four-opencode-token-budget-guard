# Coding Guidelines

## Tech Stack
- **Runtime:** Bun (≥1.x)
- **Language:** TypeScript strict mode
- **Module:** ESM only (`"type": "module"`)
- **Source:** `src/four-opencode-token-budget-guard.ts` (NOT `src/index.ts`)
- **npm name:** `@four-bytes/four-opencode-token-budget-guard`

## Code Style
- No `any` unless absolutely necessary
- Prefer `const` over `let`
- Use `async`/`await` — no raw promises
- Error handling: typed catch blocks, meaningful messages
- Output: compact, no unnecessary verbosity

## Token Budget Principles
Every tool in this plugin exists to save tokens:
- Tools should return only what the agent needs — not full command output
- Parsed, structured output preferred over raw text
- Error messages should be specific and actionable
- No redundant tool functionality — one tool, one clear purpose

## Build Discipline (MANDATORY)
- EVERY code change ends with: version bump in `package.json` + `mise run build`
- No merge without current `dist/`
- `dist/` is gitignored, freshly built before `npm publish`

## File Conventions
- LF line endings
- UTF-8 encoding
- `.local.md` files are gitignored — use for personal dev config
- No personal paths in committed code

## Plugin Structure
```
src/
├── four-opencode-token-budget-guard.ts   # Plugin entry — registers all tools
├── tools/
│   ├── apply-patch.ts            # Unified diff patch application
│   ├── batch-edit.ts             # Multi-file search and replace
│   ├── lint-file.ts              # Single-file linting
│   └── run-tests.ts              # Targeted test execution
└── lib/
    ├── diff-parse.ts             # Unified diff parser
    ├── diff-apply.ts             # Hunk application engine
    └── debug-logger.ts           # JSONL debug logger
```

## License Header
All new source files must include:
```typescript
// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2025-2026 Four Bytes
```
