# Project Change History

## v0.4.0 — 2026-05-31

### Added
- max_search_result_tokens Policy (#12): warns/enforces when message has >50 lines (search output pattern)

## v0.3.0 — 2026-05-31

### Added
- Policy-Engine Architektur (Wave P4b, Issue #9)
- src/policy-engine.ts: Policy-Interface, PolicyContext, runPolicyLoop, Config
- Policy-Loop im chat.message Hook (nach Soft/Hard-Check)
- FOUR_TBG_POLICIES env (comma-separated, Format: name=warn|enforce|off)
- 4 Policy-Implementierungen folgen in #10-#13

## v0.2.0 — 2026-05-31

### Added
- `TokenBudgetExceededError` Custom Error-Type (`src/errors.ts`)
- Echte Hard-Cancel-Mechanismus: throw bei Überschreitung von `FOUR_TBG_HARD_LIMIT`
- Diary-Eintrag VOR throw (Audit-Trail bleibt erhalten)

### Removed
- TODO-Kommentar zu Hard-Cancel — implementiert via throw (Phase-1-Research bestätigt)

### Migration
- Bestehende User mit `FOUR_TBG_HARD_LIMIT=∞` (oder default 100k): Verhalten ändert sich — Request schlägt jetzt fehl bei Überschreitung. Setze `FOUR_TBG_ENABLED=false` zum Deaktivieren oder erhöhe Hard-Limit.

## v0.1.2 — 2026-05-31

### Fixed
- sessionTokens Map wuchs unbegrenzt — durch `SessionTokenCache` mit LRU-Cap (default 1000) + TTL (default 1h) ersetzt
- Neue ENV-Variablen: `FOUR_TBG_MAX_SESSIONS` (default 1000), `FOUR_TBG_SESSION_TTL_MS` (default 3600000)

### Added
- `src/session-cache.ts` mit `SessionTokenCache`-Klasse
- Tests in `test/session-cache.test.ts`

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
