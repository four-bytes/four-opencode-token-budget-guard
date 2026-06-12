import { BusClient } from "@four-bytes/opencode-plugin-lib";
import type { SessionTokenCache } from "./session-cache.js";
import type { Config } from "./config.js";

export class BusPublisher {
  private bus: BusClient | null = null;
  private lastPublish = 0;
  private publishInterval = 500; // ms — debounce
  private reconnecting = false;

  async init(): Promise<void> {
    try {
      // eslint-disable-next-line no-console
      console.log("[BusPublisher] connecting to plugin bus on port 3000...");
      this.bus = await BusClient.connect(3000);
      // eslint-disable-next-line no-console
      console.log(
        "[BusPublisher] connected — activePort=",
        this.bus.activePort,
      );
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn(
        "[BusPublisher] bus not available:",
        (err as Error).message,
      );
      this.bus = null;
    }
  }

  async publish(
    sessionID: string,
    _tokensApprox: number,
    cache: SessionTokenCache,
    config: Config
  ): Promise<void> {
    if (!this.bus) {
      // eslint-disable-next-line no-console
      console.log(
        `[BusPublisher] skipping publish — no bus connection (session=${sessionID})`,
      );
      return;
    }

    const now = Date.now();
    if (now - this.lastPublish < this.publishInterval) {
      // eslint-disable-next-line no-console
      console.log(
        `[BusPublisher] skipping publish — debounce (session=${sessionID}, delta=${now - this.lastPublish}ms)`,
      );
      return;
    }
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
      // eslint-disable-next-line no-console
      console.log(
        `[BusPublisher] publishing tbg/${sessionID}/status — cumulative=${cumulative} status=${status}`,
      );
      await this.bus.publish(`tbg/${sessionID}/status`, {
        sessionID,
        cumulative,
        softLimit: config.softLimit,
        hardLimit: config.hardLimit,
        percentage,
        status,
      });
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn(
        "[BusPublisher] publish failed:",
        (err as Error).message,
        "— scheduling reconnect in 5s",
      );
      this.bus = null;
      if (!this.reconnecting) {
        this.reconnecting = true;
        // eslint-disable-next-line no-console
        console.log("[BusPublisher] attempting reconnection in 5s...");
        setTimeout(async () => {
          this.reconnecting = false;
          await this.init();
        }, 5000);
      }
    }
  }
}
