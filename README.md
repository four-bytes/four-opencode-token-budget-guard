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
