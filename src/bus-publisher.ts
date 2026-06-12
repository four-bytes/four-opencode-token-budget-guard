import { BusClient } from "@four-bytes/opencode-plugin-lib";
import type { SessionTokenCache } from "./session-cache.js";
import type { Config } from "./config.js";

export class BusPublisher {
  private bus: BusClient | null = null;
  private lastPublish = 0;
  private publishInterval = 500; // ms — debounce

  async init(): Promise<void> {
    try {
      this.bus = await BusClient.connect(3000);
    } catch {
      // Bus not available — operate without it
      this.bus = null;
    }
  }

  async publish(
    sessionID: string,
    _tokensApprox: number,
    cache: SessionTokenCache,
    config: Config
  ): Promise<void> {
    if (!this.bus) return;

    const now = Date.now();
    if (now - this.lastPublish < this.publishInterval) return;
    this.lastPublish = now;

    const cumulative = cache.get(sessionID);
    const percentage =
      config.softLimit > 0
        ? Math.round((cumulative / config.softLimit) * 1000) / 10
        : 0;

    let status = "below_soft";
    if (cumulative >= config.hardLimit) status = "hard_exceeded";
    else if (cumulative >= config.softLimit) status = "soft_exceeded";

    try {
      await this.bus.publish(`tbg/${sessionID}/status`, {
        sessionID,
        cumulative,
        softLimit: config.softLimit,
        hardLimit: config.hardLimit,
        percentage,
        status,
      });
    } catch {
      // Bus disconnected — try reconnect on next publish
      this.bus = null;
      setTimeout(() => this.init(), 5000);
    }
  }
}
