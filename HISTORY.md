# Project Change History

## v0.1.1 — 2026-05-31

### Fixed
- Source-Datei `src/index.ts` → `src/four-opencode-token-budget-guard.ts` (opencode-Plugin-Naming-Konvention, siehe rag/memory)
- package.json `main`, `types`, `exports`, build-script entsprechend angepasst

## v0.1.0 — 2026-05-31

### Added
- Initial skeleton (Sprint 1 der opencode-plugins Strategy)
- `chat.message` Hook mit Token-Schätzung (chars/4 Heuristik)
- Soft-Warning bei kumulierten Session-Tokens ≥ `FOUR_TBG_SOFT_LIMIT` (default 50000)
- Hard-Warning bei ≥ `FOUR_TBG_HARD_LIMIT` (default 100000) — nur Logging, keine Cancellation
- JSONL-Diary unter `${XDG_DATA_HOME:-~/.local/share}/four-opencode-token-budget-guard/diary/YYYY-MM-DD.jsonl`
- Config via ENV (`FOUR_TBG_*`), zero-config Defaults

### Known Limitations
- Token-Estimation ist Heuristik (chars/4)
- Hard-Cancel-Mechanismus offen (opencode Plugin-API für Request-Cancellation unklar — Follow-up-Issue geplant)
- Keine Tests
