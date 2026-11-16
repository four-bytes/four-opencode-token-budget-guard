# @four-bytes/four-opencode-token-budget-guard

> Token budget guard for opencode — soft/hard limits, policy engine, and usage diary.

[![npm](https://img.shields.io/npm/v/@four-bytes/four-opencode-token-budget-guard)](https://www.npmjs.com/package/@four-bytes/four-opencode-token-budget-guard)
[![license](https://img.shields.io/badge/license-Apache%202.0-blue)](LICENSE)
[![bun](https://img.shields.io/badge/runtime-bun-orange)](https://bun.sh)

## Why?

LLM sessions can silently burn through token budgets. Token Budget Guard counts estimated tokens before each request and enforces limits: soft warnings at configurable thresholds, hard cancellation at limit. Includes a token usage diary for session statistics.

## Quickstart

```bash
opencode plugin @four-bytes/four-opencode-token-budget-guard -g
```

Restart opencode.

## Configuration

Environment variables:

| Variable | Default | Description |
|----------|---------|-------------|
| `FOUR_TBG_SOFT_LIMIT` | `8000` | Warning threshold (tokens) |
| `FOUR_TBG_HARD_LIMIT` | `16000` | Cancellation limit (tokens) |
| `FOUR_TBG_ENABLED` | `true` | Enable/disable |

## Per-agent budgets & context-growth alarm

Per-turn budgets are resolved **per agent** from `opencode.json` / `opencode.jsonc`
in the project directory (JSONC comments allowed). Resolution order: agent entry →
`default` → hardcoded fallback (`softPerTurn: 60000`, `hardPerTurn: 120000`).
Unknown agents fall back to `default` and are logged once.

```jsonc
// opencode.json
{
  "token_budget_guard": {
    "default":   { "softPerTurn": 60000,  "hardPerTurn": 120000 },
    "architect": { "softPerTurn": 120000, "hardPerTurn": 190000 },
    "build":     { "softPerTurn": 80000,  "hardPerTurn": 150000 },
    "explore":   { "softPerTurn": 25000,  "hardPerTurn": 50000 }
  }
}
```

The guard also watches **context-growth rate** (cumulative context size per turn
boundary) and warns when it grows faster than expected:

- **soft** — cumulative context grew by more than `growthPct`% over the last
  `growthWindow` turns.
- **hard** — projected context at the current slope reaches the context window
  within `projectTurns` turns (names the top pruned source from the
  context-curator diary, e.g. `· top source: run_tests (41%)`).

Growth parameters (env → config-file numeric keys in `token_budget_guard` → defaults):

| Variable | Default | Description |
|----------|---------|-------------|
| `FOUR_TBG_GROWTH_PCT` | `25` | Soft-alarm growth threshold (%) over the window |
| `FOUR_TBG_GROWTH_WINDOW` | `10` | Number of turns in the growth window |
| `FOUR_TBG_PROJECT_TURNS` | `15` | Projection horizon for the hard alarm |
| `FOUR_TBG_CONTEXT_WINDOW` | `200000` | Context window size (tokens) for the hard alarm |

## Policy Engine

4 policies configurable per session:

- **Warn** — Log warning when approaching soft limit
- **Compaction** — Trigger context compaction at soft limit
- **Hard Stop** — Cancel request at hard limit
- **Diary** — Record token statistics to diary file

## Contributing

PRs welcome! See [CONTRIBUTING.md](CONTRIBUTING.md).

```bash
bun install
bun run build
bun test
```

## License

Apache-2.0 — see [LICENSE](LICENSE)

---

> If this plugin saves you tokens, consider leaving a ⭐ on [GitHub](https://github.com/four-bytes/four-opencode-token-budget-guard).
