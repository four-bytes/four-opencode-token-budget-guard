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
| `FOUR_TBG_SOFT_LIMIT` | `100000` | Warning threshold (tokens) |
| `FOUR_TBG_HARD_LIMIT` | `200000` | Cancellation limit (tokens) |
| `FOUR_TBG_MODEL_MARGIN_PCT` | `10` | Percentage of the model context window kept free below the hard limit |
| `FOUR_TBG_COMPACT_PCT` | `80` | Percentage of the effective hard limit that triggers native compaction (clamped 1–99) |
| `FOUR_TBG_COMPACT_COOLDOWN_MS` | `60000` | Minimum interval between native compaction triggers per session (ms) |
| `FOUR_TBG_COMPACT_TIMEOUT_MS` | `30000` | Upper bound for a native `session.summarize()` call (ms) |
| `FOUR_TBG_ENABLED` | `true` | Enable/disable |
| `FOUR_TBG_MAX_SESSIONS` | `1000` | Max tracked sessions before LRU eviction |
| `FOUR_TBG_SESSION_TTL_MS` | `604800000` | Idle TTL (ms) after which session metrics are dropped (7 days) |

> **Escalation ladder.** Below `FOUR_TBG_COMPACT_PCT` of the effective hard limit
> the guard stays quiet. At that threshold it triggers opencode's native
> compaction (`session.summarize()`, the same call as `/compact`) for root
> sessions only, bounded by the cooldown and timeout above. At `softLimit` it
> warns, and at `hardLimit` it cancels the request as the last resort. The guard
> does not run its own pruning engine.
>
> The effective hard limit is clamped to the context window of the model handling
> the request (minus `FOUR_TBG_MODEL_MARGIN_PCT` percent); the soft limit never
> rises above that clamped hard limit. Unknown models fall back to the configured
> values.

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
  within `projectTurns` turns.

Growth parameters (env → config-file numeric keys in `token_budget_guard` → defaults):

| Variable | Default | Description |
|----------|---------|-------------|
| `FOUR_TBG_GROWTH_PCT` | `25` | Soft-alarm growth threshold (%) over the window |
| `FOUR_TBG_GROWTH_WINDOW` | `10` | Number of turns in the growth window |
| `FOUR_TBG_PROJECT_TURNS` | `15` | Projection horizon for the hard alarm |
| `FOUR_TBG_CONTEXT_WINDOW` | `200000` | Context window size (tokens) for the hard alarm |

## Policy Engine

3 guard behaviors:

- **Warn** — Log warning when approaching soft limit
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
