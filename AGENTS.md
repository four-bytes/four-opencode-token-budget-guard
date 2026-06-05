# four-opencode-token-budget-guard — AGENTS.md

## Project Overview
opencode-Plugin: Token-Budget-Guard with Soft/Hard-Warning + JSONL-Diary per Session.

## Tech Stack
- Runtime: Bun (ESM)
- Language: TypeScript 5.7 (strict)
- Plugin-API: `@opencode-ai/plugin` ^1.15.13
- Dependencies: zero runtime deps (except @opencode-ai/plugin)

## Git Workflow (MANDATORY)
Every task, no exceptions:
```
gh issue create → git checkout -b feat|fix|chore|docs/GH-{nr}-slug → commit → git push → gh pr create --fill → Review → gh pr merge --squash --delete-branch
```
- Branch naming: `feat/GH-{nr}-description` | `fix/GH-{nr}-description` | `chore/GH-{nr}-description`
- Conventional Commits: `feat:|fix:|chore:|docs:|refactor:` with `(#NR)` suffix
- PR body must contain `Closes #NR`
- No worktrees — work directly on feature branches from `main`
- After merge: `git checkout main && git pull --ff-only && git branch -D <branch>`

## Development
| Command | Description |
|---|---|
| `bun install` | Install deps |
| `bun run build` | Build to dist/ |
| `bun run typecheck` | Type check |
| `bun test` | Run test suite |

## Architecture
| File | Purpose |
|---|---|
| src/four-opencode-token-budget-guard.ts | Plugin entry, registers chat.message Hook |
| src/config.ts | ENV-based Config-Loader |
| src/tokens.ts | Token-Estimator (chars/4 heuristic) |
| src/diary.ts | JSONL-Diary-Writer (XDG-Path) |
| src/session-cache.ts | LRU Session-Cache with TTL |
| src/errors.ts | TokenBudgetExceededError |
| src/policy-engine.ts | Policy-Interface + runPolicyLoop |
| src/policies/max-start-tokens.ts | Early-Warning for cumulative Session-Tokens |

## Conventions
- LF, Umlaute (ä/ö/ü/ß)
- Pure ESM (`type: "module"`)
- Strict TypeScript, no `any`
- Zero deps where possible

## References
- OpenCode source: `~/four-opencode-plugins/opencode-src` — reference for Plugin-API internals and hook types

