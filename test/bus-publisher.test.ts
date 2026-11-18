import { describe, it, expect } from "bun:test";
import { BusPublisher } from "../src/bus-publisher";
import { MetricsTracker } from "../src/metrics";
import type { Config } from "../src/config";

const config: Config = {
  softLimit: 100,
  hardLimit: 200,
  diaryDir: "",
  enabled: true,
  compactionTrigger: false,
};

interface Call {
  sessionID: string;
  topic: string;
  payload: { status: string };
}

function installFakeBus(publisher: BusPublisher, calls: Call[]): void {
  (publisher as unknown as { bus: unknown }).bus = {
    forService: () => ({
      forSession: (sessionID: string) => ({
        publish: async (topic: string, payload: Call["payload"]) => {
          calls.push({ sessionID, topic, payload });
        },
      }),
    }),
  };
}

describe("BusPublisher throttle", () => {
  it("never throttles a hard-limit status transition", async () => {
    const publisher = new BusPublisher();
    const calls: Call[] = [];
    installFakeBus(publisher, calls);
    const metrics = new MetricsTracker();

    // First publish: below_soft.
    await publisher.publish("s1", metrics.get("s1"), config);

    // Within the 500 ms window the basis jumps over the hard limit. This
    // transition used to be dropped, leaving the TUI on "below_soft".
    metrics.onStepFinish("s1", "step-1", { input: 500 });
    await publisher.publish("s1", metrics.get("s1"), config);

    expect(calls).toHaveLength(2);
    expect(calls[1].payload.status).toBe("hard_exceeded");
  });

  it("still throttles repeated same-status updates", async () => {
    const publisher = new BusPublisher();
    const calls: Call[] = [];
    installFakeBus(publisher, calls);
    const metrics = new MetricsTracker();

    await publisher.publish("s1", metrics.get("s1"), config);
    metrics.onTextPartUpdated("s1", "p1", "aaaa");
    await publisher.publish("s1", metrics.get("s1"), config);

    expect(calls).toHaveLength(1);
  });
});
