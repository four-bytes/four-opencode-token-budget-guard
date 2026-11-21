import { describe, it, expect } from "bun:test";
import { createTokenMeterTool } from "../src/token-meter";
import { MetricsTracker } from "../src/metrics";
import type { Config } from "../src/config";

const config: Config = {
  softLimit: 1_000,
  hardLimit: 2_000,
  modelMarginPct: 10,
  diaryDir: "",
  enabled: true,
};

async function run(metrics: MetricsTracker, sessionID: string) {
  const tool = createTokenMeterTool(metrics, config, () => sessionID);
  const result = (await tool.execute({}, {} as never)) as { output: string };
  return JSON.parse(result.output) as Record<string, unknown> & {
    cache: { read: number; write: number };
  };
}

describe("token_meter_status tool", () => {
  it("reports the distinct metrics separately", async () => {
    const metrics = new MetricsTracker();
    const session = "meter-1";
    metrics.onTextDelta(session, "p1", "x".repeat(80)); // generated/context 20
    metrics.onStepFinish(session, "step-1", {
      input: 500,
      output: 50,
      reasoning: 10,
      cache: { read: 100, write: 20 },
    });

    const out = await run(metrics, session);
    expect(out.contextEstimate).toBe(20);
    expect(out.generatedEstimate).toBe(20);
    expect(out.cumulativeUsage).toBe(680);
    expect(out.cache).toEqual({ read: 100, write: 20 });
    expect(out.budgetBasis).toBe(500); // input only
    // Backward-compatible alias for the enforced basis.
    expect(out.cumulative).toBe(500); // input only
    expect(out.status).toBe("below_soft");
  });

  it("derives percentage and status from the enforced budget basis", async () => {
    const metrics = new MetricsTracker();
    const session = "meter-2";
    metrics.onStepFinish(session, "step-1", { input: 1_500 });

    const out = await run(metrics, session);
    expect(out.status).toBe("soft_exceeded");
    expect(out.percentage).toBe(150);

    metrics.onStepFinish(session, "step-2", { input: 2_500 });
    const hard = await run(metrics, session);
    expect(hard.status).toBe("hard_exceeded");
    expect(hard.percentage).toBe(250);
  });
});
