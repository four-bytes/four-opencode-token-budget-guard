# ROADMAP — four-opencode-token-budget-guard

## v0.6.1 (Current) — Cleanup & Docs
- [x] Remove dead policies: max-search-tokens, grep-mode, max-planner-tokens (never wired to hook)
- [x] Remove unused estimateMessageTokens function
- [x] Remove unused PolicyContext fields (message, systemContent)
- [x] Compact AGENTS.md with strict git workflow, no worktrees
- [x] Translate all .md files and comments to English

## v0.7.0 — Diary Debounce & Policy Repair
**Problem:** Diary writes on every streaming text part (50-100 writes per message). Policy warns on every chunk after threshold.

- [ ] Batch diary writes: accumulate then flush at session end or on limit hit
- [ ] Add `warnedOnce` guard to MaxStartTokensPolicy (debounce per session)
- [ ] Extract repeated diary-write + try/catch into shared `safeWriteDiary()` helper
- [ ] Remove dead `level: "ok"` variant from PolicyResult union
- [ ] Remove dead `session-cache.size()` method (test-only)
- [ ] Replace silent catch-all with `console.error` for unexpected errors

## v0.8.0 — Message-Level Policy Engine
**Problem:** Current hook (`message.part.updated`) fires per-chunk and lacks full message context. Policies that inspect message content (search dumps, bare grep, planner bloat) cannot trigger.

- [ ] Research opencode Plugin-API for pre-request hook with full message access
- [ ] Migrate to hook that provides assembled message (e.g. `chat.message.before` if available)
- [ ] Re-implement max-search-tokens policy: detect >200 line messages (search dumps)
- [ ] Re-implement grep-mode policy: detect `grep` without `--include` (PAT-003 enforcement)
- [ ] Re-implement max-planner-tokens policy: detect verbose assistant output >3000 tokens
- [ ] Add policy debouncing (each policy fires once per session)
- [ ] Wire `enforce` config flag: policies read PolicyConfig to determine warn vs enforce
- [ ] Add integration tests with real opencode mock hooks

## v0.9.0 — Pre-Request Budget Guard
**Problem:** Plugin description says "pre-request" but it's reactive/during-request. Cannot prevent token waste before it happens.

- [ ] Implement proper pre-request interception (hook before model call)
- [ ] Cumulative session check BEFORE request is sent to model
- [ ] Reject over-budget requests before they consume API tokens
- [ ] Configurable action: `warn` | `block` | `compact` (trigger curator compaction)
- [ ] Per-model budget profiles (e.g. GPT-4 vs Claude vs free models)

## v1.0.0 — Production Polish
- [ ] Replace chars/4 heuristic with tiktoken or equivalent accurate tokenizer
- [ ] Diary compaction (auto-rotate old JSONL files after N days)
- [ ] Expose `/stats` endpoint for current session token usage
- [ ] CI/CD: GitHub Actions for typecheck + test + build on PR
- [ ] npm registry publish automation
