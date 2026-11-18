import { describe, it, expect, afterEach } from "bun:test";
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FourTokenBudgetGuardPlugin } from "../src/four-opencode-token-budget-guard";
import { TokenBudgetExceededError } from "../src/errors";

/**
 * Integration tests for enforcement and debouncing.
 *
 * These drive the real plugin hooks the way opencode does:
 * - `event` is fire-and-forget (opencode discards its promise) and only measures.
 * - `chat.message` is awaited BEFORE the request is sent, so a throw there
 *   actually blocks the request.
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
  "XDG_DATA_HOME",
] as const;

const savedEnv: Record<string, string | undefined> = {};

function setupEnv(opts: {
  soft: number;
  hard: number;
  maxStart?: number;
  policies?: string;
}): string {
  for (const k of ENV_KEYS) savedEnv[k] = process.env[k];
  process.env.FOUR_TBG_SOFT_LIMIT = String(opts.soft);
  process.env.FOUR_TBG_HARD_LIMIT = String(opts.hard);
  process.env.FOUR_TBG_MAX_START_TOKENS = String(opts.maxStart ?? 999_999_999);
  process.env.FOUR_TBG_ENABLED = "true";
  if (opts.policies) process.env.FOUR_TBG_POLICIES = opts.policies;
  else delete process.env.FOUR_TBG_POLICIES;

  const dir = mkdtempSync(join(tmpdir(), "tbg-enforce-"));
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

function makeCtx(toasts: Toast[]) {
  return {
    directory: undefined,
    client: {
      app: { log: async () => {} },
      tui: {
        showToast: (t: Toast) => {
          toasts.push(t);
        },
      },
    },
  };
}

type ChatInput = { sessionID: string; agent?: string };
type ChatOutput = { parts: { type: string; text?: string }[] };
type ChatHook = (input: ChatInput, output?: ChatOutput) => Promise<void>;
type EventHook = (input: unknown) => Promise<void>;

function stepFinish(sessionID: string, tokens: {
  input: number;
  output?: number;
  reasoning?: number;
  cache?: { read: number; write: number };
}, id = `step-${Math.random()}`) {
  return {
    event: {
      type: "message.part.updated",
      properties: {
        sessionID,
        part: {
          id,
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

describe("pre-request enforcement (integration)", () => {
  let tmpDir: string | undefined;

  afterEach(() => {
    if (tmpDir) restoreEnv(tmpDir);
    tmpDir = undefined;
  });

  it("blocks the request: chat.message rejects when authoritative usage exceeds the hard limit", async () => {
    tmpDir = setupEnv({ soft: 100, hard: 200 });
    const toasts: Toast[] = [];
    const hooks = await FourTokenBudgetGuardPlugin(makeCtx(toasts) as never);
    const eventHook = hooks.event as EventHook;
    const chatMessage = hooks["chat.message"] as ChatHook;

    const sessionID = `enforce-hard-${Date.now()}`;

    // Authoritative step usage of 250 tokens (> hard 200). The event hook only
    // measures; it must not throw and must not enforce.
    await eventHook(stepFinish(sessionID, { input: 250 }));

    const err = await captureError(() => chatMessage({ sessionID, agent: "build" }));

    // The limit error is observable — not swallowed by the handler.
    expect(err).toBeInstanceOf(TokenBudgetExceededError);
    expect((err as TokenBudgetExceededError).sessionID).toBe(sessionID);
    expect((err as TokenBudgetExceededError).hardLimit).toBe(200);
    expect((err as TokenBudgetExceededError).cumulative).toBe(250);
  });

  it("does not throw from the fire-and-forget event hook even when over the hard limit", async () => {
    tmpDir = setupEnv({ soft: 100, hard: 200 });
    const toasts: Toast[] = [];
    const hooks = await FourTokenBudgetGuardPlugin(makeCtx(toasts) as never);
    const eventHook = hooks.event as EventHook;

    const sessionID = `enforce-event-${Date.now()}`;
    const err = await captureError(() =>
      eventHook(stepFinish(sessionID, { input: 999 })),
    );
    expect(err).toBeUndefined();
  });

  it("blocks the very first request when the incoming message alone exceeds the hard limit", async () => {
    tmpDir = setupEnv({ soft: 100, hard: 200 });
    const toasts: Toast[] = [];
    const hooks = await FourTokenBudgetGuardPlugin(makeCtx(toasts) as never);
    const chatMessage = hooks["chat.message"] as ChatHook;

    const sessionID = `enforce-incoming-${Date.now()}`;
    const err = await captureError(() =>
      chatMessage(
        { sessionID, agent: "build" },
        { parts: [{ type: "text", text: "x".repeat(4_000) }] }, // 1000 tokens
      ),
    );

    expect(err).toBeInstanceOf(TokenBudgetExceededError);
    expect((err as TokenBudgetExceededError).cumulative).toBe(1_000);
  });

  it("blocks when a policy is configured as enforce", async () => {
    tmpDir = setupEnv({
      soft: 10_000,
      hard: 20_000,
      maxStart: 100,
      policies: "max_start_tokens=enforce",
    });
    const toasts: Toast[] = [];
    const hooks = await FourTokenBudgetGuardPlugin(makeCtx(toasts) as never);
    const eventHook = hooks.event as EventHook;
    const chatMessage = hooks["chat.message"] as ChatHook;

    const sessionID = `enforce-policy-${Date.now()}`;
    await eventHook(stepFinish(sessionID, { input: 500 }));

    const err = await captureError(() => chatMessage({ sessionID, agent: "architect" }));
    expect(err).toBeInstanceOf(TokenBudgetExceededError);
  });
});

describe("debouncing (integration)", () => {
  let tmpDir: string | undefined;

  afterEach(() => {
    if (tmpDir) restoreEnv(tmpDir);
    tmpDir = undefined;
  });

  it("emits a soft-limit warning at most once per interval", async () => {
    tmpDir = setupEnv({ soft: 100, hard: 10_000 });
    const toasts: Toast[] = [];
    const hooks = await FourTokenBudgetGuardPlugin(makeCtx(toasts) as never);
    const eventHook = hooks.event as EventHook;
    const chatMessage = hooks["chat.message"] as ChatHook;

    const sessionID = `debounce-warn-${Date.now()}`;
    await eventHook(stepFinish(sessionID, { input: 150 }));

    await chatMessage({ sessionID, agent: "build" });
    await chatMessage({ sessionID, agent: "build" });
    await chatMessage({ sessionID, agent: "build" });

    const budgetWarnings = toasts.filter((t) => t.body.title === "Token Budget ⚠️");
    expect(budgetWarnings).toHaveLength(1);
  });

  it("writes at most one ordinary diary entry per debounce window", async () => {
    tmpDir = setupEnv({ soft: 10_000, hard: 20_000 });
    const toasts: Toast[] = [];
    const hooks = await FourTokenBudgetGuardPlugin(makeCtx(toasts) as never);
    const eventHook = hooks.event as EventHook;
    const chatMessage = hooks["chat.message"] as ChatHook;

    const sessionID = `debounce-diary-${Date.now()}`;
    // Below soft, so only the ordinary turn-boundary diary path applies.
    await eventHook(stepFinish(sessionID, { input: 1_000 }));

    await chatMessage({ sessionID, agent: "build" });
    await chatMessage({ sessionID, agent: "build" });
    await chatMessage({ sessionID, agent: "build" });

    const diaryDir = join(tmpDir, "four-opencode-token-budget-guard", "diary");
    const files = readdirSync(diaryDir).filter((f) => f.endsWith(".jsonl"));
    const lines = files.flatMap((f) =>
      readFileSync(join(diaryDir, f), "utf-8")
        .split("\n")
        .filter((line) => line.trim().length > 0),
    );
    expect(lines).toHaveLength(1);
  });

  it("still writes a diary entry when the hard limit is hit", async () => {
    tmpDir = setupEnv({ soft: 100, hard: 200 });
    const toasts: Toast[] = [];
    const hooks = await FourTokenBudgetGuardPlugin(makeCtx(toasts) as never);
    const eventHook = hooks.event as EventHook;
    const chatMessage = hooks["chat.message"] as ChatHook;

    const sessionID = `debounce-diary-hard-${Date.now()}`;
    await eventHook(stepFinish(sessionID, { input: 250 }));

    await captureError(() => chatMessage({ sessionID, agent: "build" }));

    const diaryDir = join(tmpDir, "four-opencode-token-budget-guard", "diary");
    const files = readdirSync(diaryDir).filter((f) => f.endsWith(".jsonl"));
    const lines = files.flatMap((f) =>
      readFileSync(join(diaryDir, f), "utf-8")
        .split("\n")
        .filter((line) => line.trim().length > 0),
    );
    expect(lines).toHaveLength(1);
    const entry = JSON.parse(lines[0]) as { msgRole: string; cumulativeUsage: number };
    expect(entry.msgRole).toBe("pre-request");
    expect(entry.cumulativeUsage).toBe(250);
  });

  it("records the incoming request tokens in a hard-limit diary entry", async () => {
    tmpDir = setupEnv({ soft: 100, hard: 200 });
    const toasts: Toast[] = [];
    const hooks = await FourTokenBudgetGuardPlugin(makeCtx(toasts) as never);
    const chatMessage = hooks["chat.message"] as ChatHook;

    // No prior event: session metrics are empty, so the basis consists only of
    // the incoming request (4000 chars ≈ 1000 tokens).
    const sessionID = `diary-incoming-${Date.now()}`;
    const err = await captureError(() =>
      chatMessage(
        { sessionID, agent: "build" },
        { parts: [{ type: "text", text: "x".repeat(4_000) }] },
      ),
    );
    expect(err).toBeInstanceOf(TokenBudgetExceededError);

    const diaryDir = join(tmpDir, "four-opencode-token-budget-guard", "diary");
    const files = readdirSync(diaryDir).filter((f) => f.endsWith(".jsonl"));
    const lines = files.flatMap((f) =>
      readFileSync(join(diaryDir, f), "utf-8")
        .split("\n")
        .filter((line) => line.trim().length > 0),
    );
    expect(lines).toHaveLength(1);
    const entry = JSON.parse(lines[0]) as { tokensApprox: number; cumulative: number };
    expect(entry.tokensApprox).toBe(1_000);
    expect(entry.cumulative).toBe(1_000);
  });
});
