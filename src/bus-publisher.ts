import { BusClient } from "@four-bytes/opencode-plugin-lib";
import type { Config } from "./config.js";
import { budgetBasis, type SessionMetrics } from "./metrics.js";

export class BusPublisher {
  private bus: BusClient | null = null;
  private lastPublish = 0;
  private lastPublishedStatus: string | undefined;
  private publishInterval = 500; // ms — debounce between same-status updates
  private reconnecting = false;
  private onWarn: ((message: string, ...args: unknown[]) => void) | undefined;

  async init(opts?: { onWarn?: (message: string, ...args: unknown[]) => void }): Promise<void> {
    this.onWarn = opts?.onWarn;
    try {
      this.bus = await BusClient.connect({ timeoutMs: 3000, onWarn: opts?.onWarn });
    } catch {
      this.bus = null;
    }
  }

  async publish(
    sessionID: string,
    metrics: SessionMetrics,
    config: Config,
  ): Promise<void> {
    if (!this.bus) return;

    const basis = budgetBasis(metrics);
    const percentage =
      config.softLimit > 0
        ? Math.round((basis / config.softLimit) * 1000) / 10
        : 0;

    let status = "below_soft";
    if (basis >= config.hardLimit) status = "hard_exceeded";
    else if (basis >= config.softLimit) status = "soft_exceeded";

    // Status transitions (notably entering OR leaving hard_exceeded) must never
    // be dropped by the throttle, or the TUI keeps showing a stale status.
    // Only repeated same-status updates are throttled.
    const now = Date.now();
    const statusChanged = status !== this.lastPublishedStatus;
    if (!statusChanged && now - this.lastPublish < this.publishInterval) return;
    this.lastPublish = now;
    this.lastPublishedStatus = status;

    try {
      await this.bus.forService("tbg").forSession(sessionID).publish("status", {
        sessionID,
        // Backward-compatible alias for the enforced budget basis (the existing
        // TUI reads `cumulative`); the distinct metrics are below.
        cumulative: basis,
        contextEstimate: metrics.contextEstimate,
        generatedEstimate: metrics.generatedEstimate,
        cumulativeUsage: metrics.cumulativeUsage,
        cache: { read: metrics.cacheRead, write: metrics.cacheWrite },
        budgetBasis: basis,
        softLimit: config.softLimit,
        hardLimit: config.hardLimit,
        percentage,
        status,
      });
    } catch {
      this.bus = null;
      if (!this.reconnecting) {
        this.reconnecting = true;
        const reconnect = async (): Promise<void> => {
          await this.init({ onWarn: this.onWarn });
          if (!this.bus) {
            setTimeout(reconnect, 5000);
            return;
          }
          this.reconnecting = false;
        };
        setTimeout(reconnect, 5000);
      }
    }
  }
}
