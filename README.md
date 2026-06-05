# @four-bytes/four-opencode-token-budget-guard

opencode-Plugin: counts estimated tokens per chat message (chars/4 heuristic), warns at soft-limit, enforces at hard-limit, writes JSONL diary per day.

**Status:** Beta v0.1.0 — Hello-World Sprint 1 (see [four-bytes/opencode-plugins](https://github.com/four-bytes/opencode-plugins)).

## Installation

```bash
bun add -d @four-bytes/four-opencode-token-budget-guard
```

In `opencode.json`:
```json
{
  "plugins": ["@four-bytes/four-opencode-token-budget-guard"]
}
```

## Configuration

Via ENV variables (all optional):

| Variable | Default | Description |
|---|---|---|
| `FOUR_TBG_SOFT_LIMIT` | `50000` | Soft-warning at cumulative tokens/session |
| `FOUR_TBG_HARD_LIMIT` | `100000` | Hard-limit — throws `TokenBudgetExceededError` on exceed |
| `FOUR_TBG_MAX_SESSIONS` | `1000` | LRU cap — max active sessions in cache |
| `FOUR_TBG_SESSION_TTL_MS` | `3600000` | TTL of a session entry (1h) |
| `FOUR_TBG_ENABLED` | `true` | `false` disables the plugin completely |
| `XDG_DATA_HOME` | `~/.local/share` | Base path for diary directory |

## Diary

One JSONL file per day at:
```
${XDG_DATA_HOME:-~/.local/share}/four-opencode-token-budget-guard/diary/YYYY-MM-DD.jsonl
```

Sample-Entry:
```json
{"ts":"2026-05-31T12:34:56.789Z","sessionID":"ses_abc","msgRole":"user","tokensApprox":234,"cumulative":1234,"softLimit":50000,"hardLimit":100000}
```

## Limitations v0.2.0

- Token estimation is heuristic (chars/4), not real tokenization

## License

Apache-2.0 — Copyright 2025 Four Bytes
