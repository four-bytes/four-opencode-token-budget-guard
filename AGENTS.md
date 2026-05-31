# four-opencode-token-budget-guard — AGENTS.md

## Project Overview
opencode-Plugin: Token-Budget-Guard mit Soft/Hard-Warning + JSONL-Diary pro Session.

## Tech Stack
- Runtime: Bun (ESM)
- Language: TypeScript 5.7 (strict)
- Plugin-API: `@opencode-ai/plugin` ^1.15.10
- Dependencies: zero runtime deps (außer @opencode-ai/plugin)

## Development
| Command | Description |
|---|---|
| `bun install` | Install deps |
| `bun run build` | Build to dist/ |
| `bun run typecheck` | Type check |

## Architecture
| File | Purpose |
|---|---|
| src/index.ts | Plugin-Entry, registriert chat.message Hook |
| src/config.ts | ENV-basierter Config-Loader |
| src/tokens.ts | Token-Estimator (chars/4) |
| src/diary.ts | JSONL-Diary-Writer (XDG-Pfad) |

## Conventions
- LF, Umlaute (ä/ö/ü/ß)
- Conventional Commits mit (#NR)
- Pure ESM (`type: "module"`)
- Strict TypeScript, no `any`
- Zero deps wo möglich

## Known Limitations
- Token-Estimation heuristisch
- Hard-Cancel TODO (opencode-API)
- Keine Tests v0.1.0
