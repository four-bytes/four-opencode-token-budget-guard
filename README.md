# @four-bytes/four-opencode-token-budget-guard

opencode-Plugin: zählt pro Chat-Message die geschätzten Token (chars/4 Heuristik), warnt bei Soft-Limit, dokumentiert beim Hard-Limit, schreibt JSONL-Diary pro Tag.

**Status:** Beta v0.1.0 — Hello-World Sprint 1 (siehe [four-bytes/opencode-plugins](https://github.com/four-bytes/opencode-plugins)).

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

## Konfiguration

Via ENV-Variablen (alle optional):

| Variable | Default | Beschreibung |
|---|---|---|
| `FOUR_TBG_SOFT_LIMIT` | `50000` | Soft-Warning ab kumulierten Tokens/Session |
| `FOUR_TBG_HARD_LIMIT` | `100000` | Hard-Warning (Cancel ist TODO) |
| `FOUR_TBG_MAX_SESSIONS` | `1000` | LRU-Cap — max aktive Sessions im Cache |
| `FOUR_TBG_SESSION_TTL_MS` | `3600000` | TTL einer Session-Eintrag (1h) |
| `FOUR_TBG_ENABLED` | `true` | `false` deaktiviert das Plugin komplett |
| `XDG_DATA_HOME` | `~/.local/share` | Basis für Diary-Pfad |

## Diary

Pro Tag eine JSONL-Datei unter:
```
${XDG_DATA_HOME:-~/.local/share}/four-opencode-token-budget-guard/diary/YYYY-MM-DD.jsonl
```

Sample-Entry:
```json
{"ts":"2026-05-31T12:34:56.789Z","sessionID":"ses_abc","msgRole":"user","tokensApprox":234,"cumulative":1234,"softLimit":50000,"hardLimit":100000}
```

## Limitationen v0.1.0

- Token-Schätzung ist Heuristik (chars/4), keine echte Tokenisierung
- Hard-Cancel ist nur Logging — echte Request-Cancellation hängt von opencode-API ab (Follow-up-Issue geplant)
- Keine Tests (Sprint 2)

## License

Apache-2.0 — Copyright 2025 Four Bytes
