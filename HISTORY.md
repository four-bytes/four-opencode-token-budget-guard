# Project Change History

## v0.6.10 — 2026-11-22

### Removed
- Dead `src/growth-source.ts` (context-curator diary read) and its test; the
  Context-Growth hard warning no longer names a "top source" (#92).

## v0.6.9 — 2026-11-21

### Added
- Native compaction trigger migrated from context-curator (#90): at
  `FOUR_TBG_COMPACT_PCT`% of the effective hard limit, opencode's native
  `session.summarize()` (same as `/compact`) is triggered fire-and-forget for
  root sessions. Cooldown (`FOUR_TBG_COMPACT_COOLDOWN_MS`) and timeout
  (`FOUR_TBG_COMPACT_TIMEOUT_MS`) prevent retry storms and hangs; child
  sessions are skipped.
- Config `compactPct` / `compactCooldownMs` / `compactTimeoutMs` with ENV
  `FOUR_TBG_COMPACT_PCT` (default 80, range 1–99),
  `FOUR_TBG_COMPACT_COOLDOWN_MS` (default 60000) and
  `FOUR_TBG_COMPACT_TIMEOUT_MS` (default 30000).
- New modules `src/compaction-trigger.ts` (`shouldTriggerCompaction`,
  `withTimeout`) and tests in `test/compaction-trigger.test.ts`.

### Notes
- The context-curator's own pruning engine and signal protocol were
  intentionally NOT adopted — only the native summarize trigger.

## v0.6.8 — 2026-11-21

### Added
- Model-aware hard limit (#86): the effective hard limit is clamped to the
  context window of the requested model —
  `hard = min(configuredHard, max(1, floor(modelContext * (100 - marginPct) / 100)))`,
  `soft = min(configuredSoft, hard)`. Unknown models fall back to the
  configured values; the diary keeps documenting the configured limits.

### Changed
- Config `modelMarginPct` + ENV `FOUR_TBG_MODEL_MARGIN_PCT` (default 10,
  range 0–90).

## v0.6.7 — 2026-11-21

### Fixed
- Hard-limit default too low (100k) — caused a hard block in normal sessions;
  defaults raised (soft 50k→100k, hard 100k→200k, aligned with
  `FOUR_TBG_CONTEXT_WINDOW`).
- Hard-limit block surfaced an opaque "server error" — toast is now clearly
  attributable to the guard and actionable.

### Docs
- README env table corrected.

## v0.6.6 — 2026-11-17

### Fixed
- Repeated counting of accumulated text (#76): `message.part.updated` carries
  the full `part.text`, so summing it per event over-counted the same text many
  times. Text parts are now keyed by part id and REPLACED on update; streamed
  `message.part.delta` chunks are added exactly once.
- Distinct metrics (#76): current-context estimate (`contextEstimate`),
  generated-text estimate (`generatedEstimate`), authoritative cumulative usage
  (`cumulativeUsage`) and cache read/write are tracked and reported separately by
  the token meter and the bus status payload.
- Enforcement (#76): limits are now checked in the awaited `chat.message`
  pre-request hook. The `event` hook is fire-and-forget in opencode and its
  `catch` swallowed the thrown limit error, so it never blocked a request. The
  handler now rethrows `TokenBudgetExceededError`; a policy configured with
  `enforce` also blocks.
- Warnings and diary writes are debounced (#76): toasts at most once per
  60 s per session+level. Ordinary diary writes are skipped only when the last
  write is younger than 30 s AND the budget basis moved by less than 5 000
  tokens, so a write goes through as soon as either 30 s elapsed or the basis
  changed by ≥5 000 tokens; hard-limit hits are always recorded.
- Diary entries and their debounce state now record the full budget basis,
  including the incoming request tokens that triggered a hard block (#76).
- Session metrics stay bounded via `FOUR_TBG_MAX_SESSIONS` (default 1000) and
  `FOUR_TBG_SESSION_TTL_MS` (default 7 days); the TTL is also applied on read,
  so a stale session cannot keep blocking requests (#76).
- Text estimates are derived from accumulated raw character counts instead of
  rounding every delta, so streaming cannot inflate the estimate and then drop
  it when the full text arrives (#76).
- A policy configured with `enforce` fails closed even when the policy throws,
  and its block names the policy's own limit instead of the hard limit (#76).

## v0.6.4 — 2026-09-23

### Added
- Context-growth slope alarm (#54): least-squares slope over trailing turns warns
  soft (`context growing +X/turn`) on >growthPct% growth and hard when the projected
  per-turn tokens exceed the context window, naming the top pruned source from the
  context-curator diary (`· top source: run_tests (41%)`).
- Per-agent per-turn budgets: `token_budget_guard` in `opencode.json(c)`
  (`default` / per-agent `softPerTurn`/`hardPerTurn`), resolved agent → `default` →
  hardcoded fallback, unknown agent logged once.
- Per-turn soft/hard threshold warnings (agent + turn named, never throw).
- New modules: `src/agent-config.ts`, `src/turn-tracker.ts`, `src/growth.ts`,
  `src/growth-source.ts`.
- New ENV: `FOUR_TBG_GROWTH_PCT`, `FOUR_TBG_GROWTH_WINDOW`, `FOUR_TBG_PROJECT_TURNS`,
  `FOUR_TBG_CONTEXT_WINDOW`.
- `chat.message` hook for turn boundaries (agent capture + turn finalization).

## v0.6.1 — 2026-06-05

### Changed
- @opencode-ai/plugin: 1.15.10 → 1.15.13

### Removed
- Dead policies: max-search-tokens, grep-mode, max-planner-tokens (never wired to hook)
- Unused estimateMessageTokens function in src/tokens.ts
- Unused PolicyContext fields (message, systemContent)

### Fixed
- AGENTS.md: compacted with strict git workflow, no worktrees, self-contained

### Docs
- All .md files and comments translated from German to English
- ROADMAP.md added with v0.7–v1.0 milestones

## v0.6.0 — 2026-06-01

### Added
- Compaction-Trigger (#21): Signals curator via `CC_COMPACTION_TRIGGER=true` env on Soft/Hard-Limit
- Config: `FOUR_TBG_COMPACTION_TRIGGER` (default true) for opt-out
- Trigger also on Policy-Enforcement (grep/planner/search violation)

### Changed
- `src/config.ts`: `compactionTrigger` boolean config field

## v0.5.0 — 2026-05-31

### Added
- Policy-Engine Integration Tests (Issue #14): 8 Cases (config, empty loop, all 4 policies, edge cases)

## v0.4.0 — 2026-05-31

### Added
- max_start_tokens Policy (#10): warns when cumulative session tokens exceed FOUR_TBG_MAX_START_TOKENS (default 25000)
- max_planner_tokens Policy (#11): warns/enforces when assistant message exceeds FOUR_TBG_MAX_PLANNER_TOKENS (default 3000)
- max_search_result_tokens Policy (#12): warns/enforces when message has excessive lines (search output pattern)
- grep_mode Policy (#13): warns/enforces when grep is used without --include flag
- src/policies/ directory with 4 Policy implementations

## v0.3.0 — 2026-05-31

### Added
- Policy-Engine Architecture (Wave P4b, Issue #9)
- src/policy-engine.ts: Policy-Interface, PolicyContext, runPolicyLoop, Config
- Policy-Loop in chat.message Hook (after Soft/Hard-Check)
- FOUR_TBG_POLICIES env (comma-separated, format: name=warn|enforce|off)

## v0.2.0 — 2026-05-31

### Added
- `TokenBudgetExceededError` Custom Error-Type (`src/errors.ts`)
- Real Hard-Cancel mechanism: throw when exceeding `FOUR_TBG_HARD_LIMIT`
- Diary entry BEFORE throw (audit trail preserved)

### Removed
- TODO comment for Hard-Cancel — implemented via throw (Phase-1-Research confirmed)

### Migration
- Existing users with `FOUR_TBG_HARD_LIMIT=∞` (or default 100k): Behavior changes — request now fails on exceed. Set `FOUR_TBG_ENABLED=false` to disable or increase hard-limit.

## v0.1.2 — 2026-05-31

### Fixed
- sessionTokens Map grew unbounded — replaced by `SessionTokenCache` with LRU-Cap (default 1000) + TTL (default 1h)
- New ENV vars: `FOUR_TBG_MAX_SESSIONS` (default 1000), `FOUR_TBG_SESSION_TTL_MS` (default 3600000)

### Added
- `src/session-cache.ts` with `SessionTokenCache` class
- Tests in `test/session-cache.test.ts`

## v0.1.1 — 2026-05-31

### Fixed
- Source file `src/index.ts` → `src/four-opencode-token-budget-guard.ts` (opencode-Plugin naming convention, see rag/memory)
- package.json `main`, `types`, `exports`, build-script updated accordingly

## v0.1.0 — 2026-05-31

### Added
- Initial skeleton (Sprint 1 of the opencode-plugins Strategy)
- `chat.message` Hook with token estimation (chars/4 heuristic)
- Soft-warning at cumulative session tokens ≥ `FOUR_TBG_SOFT_LIMIT` (default 50000)
- Hard-warning at ≥ `FOUR_TBG_HARD_LIMIT` (default 100000) — only logging, no cancellation
- JSONL-Diary under `${XDG_DATA_HOME:-~/.local/share}/four-opencode-token-budget-guard/diary/YYYY-MM-DD.jsonl`
- Config via ENV (`FOUR_TBG_*`), zero-config Defaults

### Known Limitations
- Token estimation is heuristic (chars/4)
- Hard-Cancel mechanism pending (opencode Plugin-API for request-cancellation unclear — Follow-up-Issue planned)
- No tests
