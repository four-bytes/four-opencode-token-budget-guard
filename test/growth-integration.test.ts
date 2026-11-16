import { describe, it, expect, afterEach } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FourTokenBudgetGuardPlugin } from "../src/four-opencode-token-budget-guard";

/**
 * Integration test: drive the real `chat.message` (turn boundary) and `event`
 * (token accumulation) hooks to build a growing CUMULATIVE series and assert the
 * hard growth alarm fires.
 *
 * The plugin resolves config from process.env at invocation time, so we point the
 * cumulative limits sky-high and redirect the diary dir before constructing it.
 */

interface Toast {
  body: { title: string; message: string; variant: string };
}

const ENV_KEYS = [
  "FOUR_TBG_SOFT_LIMIT",
  "FOUR_TBG_HARD_LIMIT",
  "FOUR_TBG_MAX_START_TOKENS",
  "FOUR_TBG_ENABLED",
  "FOUR_TBG_GROWTH_PCT",
  "FOUR_TBG_GROWTH_WINDOW",
  "FOUR_TBG_PROJECT_TURNS",
  "FOUR_TBG_CONTEXT_WINDOW",
  "XDG_DATA_HOME",
] as const;

const savedEnv: Record<string, string | undefined> = {};

function setupEnv(): string {
  for (const k of ENV_KEYS) savedEnv[k] = process.env[k];
  process.env.FOUR_TBG_SOFT_LIMIT = "999999999";
  process.env.FOUR_TBG_HARD_LIMIT = "999999999";
  process.env.FOUR_TBG_MAX_START_TOKENS = "999999999";
  process.env.FOUR_TBG_ENABLED = "true";
  for (const k of ["FOUR_TBG_GROWTH_PCT", "FOUR_TBG_GROWTH_WINDOW", "FOUR_TBG_PROJECT_TURNS", "FOUR_TBG_CONTEXT_WINDOW"]) {
    delete process.env[k];
  }
  const dir = mkdtempSync(join(tmpdir(), "tbg-integration-"));
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

describe("growth alarm integration (both hooks)", () => {
  let tmpDir: string | undefined;

  afterEach(() => {
    if (tmpDir) restoreEnv(tmpDir);
    tmpDir = undefined;
  });

  it("fires the hard alarm from a growing cumulative series", async () => {
    tmpDir = setupEnv();

    const toasts: Toast[] = [];
    const mockCtx = {
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

    const hooks = await FourTokenBudgetGuardPlugin(mockCtx as never);
    const chatMessage = hooks["chat.message"]!;
    const eventHook = hooks.event!;

    const sessionID = `integration-${Date.now()}`;

    // 15 turns, each adding 14k tokens (56k chars) of assistant output.
    for (let turn = 1; turn <= 15; turn++) {
      await (chatMessage as (i: unknown) => Promise<void>)({ sessionID, agent: "explore" });
      await (eventHook as (i: unknown) => Promise<void>)({
        event: {
          type: "message.part.updated",
          properties: {
            sessionID,
            part: { type: "text", text: "x".repeat(56_000) },
          },
        },
      });
    }
    // Final boundary finalizes turn 15 (cumulative 210k) and runs the alarm.
    await (chatMessage as (i: unknown) => Promise<void>)({ sessionID, agent: "explore" });

    const hard = toasts.find(
      (t) => t.body.title === "Context Growth ⚠️" && t.body.variant === "error",
    );
    expect(hard).toBeDefined();
    expect(hard!.body.message).toContain("context growing");
    expect(hard!.body.message).toMatch(/\+[\d.]+k\/turn/);
  });
});
