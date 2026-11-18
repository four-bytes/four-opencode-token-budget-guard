import { describe, it, expect } from "bun:test";
import { FourTokenBudgetGuardPlugin } from "../src/four-opencode-token-budget-guard";

function makeCtx() {
  return {
    directory: undefined,
    client: {
      app: { log: async () => {} },
      tui: { showToast: async () => {} },
    },
  };
}

interface MeterTool {
  execute: (args: unknown, context: unknown) => Promise<{ output: string }>;
}

describe("first-session adoption", () => {
  it("adopts the first session from an event that already carries tokens", async () => {
    const hooks = (await FourTokenBudgetGuardPlugin(makeCtx() as never)) as unknown as {
      event: (input: unknown) => Promise<void>;
      tool: { token_meter_status: MeterTool };
    };
    const meter = hooks.tool.token_meter_status;

    // First event of the process already contains a token. The meter must
    // switch from the empty (uninitialized) session to this one.
    await hooks.event({
      event: {
        type: "message.part.delta",
        properties: { sessionID: "adopt-1", partID: "p1", field: "text", delta: "abcd" },
      },
    });
    let out = JSON.parse((await meter.execute({}, {})).output) as {
      sessionID: string;
      generatedEstimate: number;
    };
    expect(out.sessionID).toBe("adopt-1");
    expect(out.generatedEstimate).toBe(1);

    // A later untouched session is adopted even though trackSession runs
    // BEFORE this session's metrics are written.
    await hooks.event({
      event: {
        type: "message.part.delta",
        properties: { sessionID: "adopt-2", partID: "p2", field: "text", delta: "abcd" },
      },
    });
    out = JSON.parse((await meter.execute({}, {})).output);
    expect(out.sessionID).toBe("adopt-2");
    expect(out.generatedEstimate).toBe(1);
  });
});
