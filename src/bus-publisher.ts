import { BusClient } from "@four-bytes/opencode-plugin-lib";
import type { SessionTokenCache } from "./session-cache.js";
import type { Config } from "./config.js";

export class BusPublisher {
  private bus: BusClient | null = null;
  private lastPublish = 0;
  private publishInterval = 500; // ms — debounce
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
      await this.bus.forService("tbg").forSession(sessionID).publish("status", {
        sessionID,
        cumulative,
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
