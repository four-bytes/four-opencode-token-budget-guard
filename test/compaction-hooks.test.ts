import { describe, it, expect, afterEach } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FourTokenBudgetGuardPlugin } from "../src/four-opencode-token-budget-guard";

/**
 * Native-compaction lifecycle tests (#98):
 * - the post-compaction `experimental.compaction.autocontinue` hook must reset
 *   the token meter (the summarizer's own usage events repopulate it otherwise).
 * - the native `session.summarize()` trigger must pass `auto: true` so opencode
 *   appends the synthetic "continue" turn instead of stopping the session.
 */

interface Toast {
  body: { title: string; message: string; variant: string };
}

const ENV_KEYS = [
  "FOUR_TBG_SOFT_LIMIT",
  "FOUR_TBG_HARD_LIMIT",
  "FOUR_TBG_MAX_START_TOKENS",
  "FOUR_TBG_ENABLED",
  "FOUR_TBG_POLICIES",
  "FOUR_TBG_COMPACT_PCT",
  "XDG_DATA_HOME",
] as const;

const savedEnv: Record<string, string | undefined> = {};

function setupEnv(soft: number, hard: number, compactPct = 80): string {
  for (const k of ENV_KEYS) savedEnv[k] = process.env[k];
  process.env.FOUR_TBG_SOFT_LIMIT = String(soft);
  process.env.FOUR_TBG_HARD_LIMIT = String(hard);
  process.env.FOUR_TBG_MAX_START_TOKENS = String(999_999_999);
  process.env.FOUR_TBG_ENABLED = "true";
  process.env.FOUR_TBG_COMPACT_PCT = String(compactPct);
  delete process.env.FOUR_TBG_POLICIES;
  const dir = mkdtempSync(join(tmpdir(), "tbg-compact-"));
  process.env.XDG_DATA_HOME = dir;
  return dir;
}

function restoreEnv(dir: string): void {
  for (const k of ENV_KEYS) {
    if (savedEnv[k] === undefined) delete process.env[k];
    else process.env[k] = savedEnv[k];
  }
  rmSync(dir, { recursive: true, force: true });
}

interface CtxOptions {
  toasts?: Toast[];
  summarize?: (opts: { body?: unknown }) => Promise<unknown>;
}

function makeCtx(opts: CtxOptions = {}) {
  const toasts = opts.toasts ?? [];
  return {
    directory: undefined,
    client: {
      app: { log: async () => {} },
      tui: {
        showToast: (t: Toast) => {
          toasts.push(t);
        },
      },
      config: { providers: async () => ({ data: { providers: [] } }) },
      session: {
        get: async () => ({ data: {} }),
        summarize: opts.summarize ?? (async () => true),
      },
    },
  };
}

type ChatInput = {
  sessionID: string;
  agent?: string;
  model?: { providerID: string; modelID: string };
};
type ChatHook = (
  input: ChatInput,
  output?: { parts: { type: string; text?: string }[] },
) => Promise<void>;
type EventHook = (input: unknown) => Promise<void>;
type AutocontinueHook = (
  input: { sessionID: string },
  output?: { enabled: boolean },
) => Promise<void>;

function stepFinish(sessionID: string, tokens: {
  input: number;
  output?: number;
  reasoning?: number;
  cache?: { read: number; write: number };
}) {
  return {
    event: {
      type: "message.part.updated",
      properties: {
        sessionID,
        part: {
          id: `step-${Math.random()}`,
          sessionID,
          type: "step-finish",
          tokens: {
            input: tokens.input,
            output: tokens.output ?? 0,
            reasoning: tokens.reasoning ?? 0,
            cache: tokens.cache ?? { read: 0, write: 0 },
          },
        },
      },
    },
  };
}

async function captureError(fn: () => Promise<void>): Promise<unknown> {
  try {
    await fn();
    return undefined;
  } catch (err) {
    return err;
  }
}

describe("native compaction hooks", () => {
  let tmpDir: string | undefined;

  afterEach(() => {
    if (tmpDir) restoreEnv(tmpDir);
    tmpDir = undefined;
  });

  it("resets session metrics on the post-compaction autocontinue hook", async () => {
    tmpDir = setupEnv(100, 200);
    const hooks = await FourTokenBudgetGuardPlugin(makeCtx() as never);
    const eventHook = hooks.event as EventHook;
    const chatMessage = hooks["chat.message"] as ChatHook;
    const autocontinue = hooks["experimental.compaction.autocontinue"] as AutocontinueHook;

    const sessionID = `autocontinue-reset-${Date.now()}`;
    // 250 authoritative tokens > hard limit 200 → would block the next request
    // unless the post-compaction hook clears it.
    await eventHook(stepFinish(sessionID, { input: 250 }));

    await autocontinue({ sessionID });

    const err = await captureError(() => chatMessage({ sessionID, agent: "build" }));
    expect(err).toBeUndefined();
  });

  it("triggers native compaction with auto:true so the session continues", async () => {
    tmpDir = setupEnv(100, 200, 80);
    let summarizeBody: unknown;
    const hooks = await FourTokenBudgetGuardPlugin(makeCtx({
      summarize: async (opts: { body?: unknown }) => {
        summarizeBody = opts.body;
        return true;
      },
    }) as never);
    const eventHook = hooks.event as EventHook;
    const chatMessage = hooks["chat.message"] as ChatHook;

    const sessionID = `auto-continue-${Date.now()}`;
    // 180 tokens: above 80% of hard 200 (=160), below hard 200.
    await eventHook(stepFinish(sessionID, { input: 180 }));

    await chatMessage({
      sessionID,
      agent: "build",
      model: { providerID: "p", modelID: "m" },
    });

    // Fire-and-forget summarize: flush the pending async chain.
    await new Promise((r) => setTimeout(r, 50));
    expect(summarizeBody).toEqual({ providerID: "p", modelID: "m", auto: true });
  });
});
