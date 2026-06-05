export interface PolicyResult {
  name: string;
  level: "ok" | "warn" | "enforce";
  message: string;
  tokens?: number;
  limit?: number;
}

export interface Policy {
  name: string;
  /** Check if policy should trigger. Returns null if ok. */
  check(context: PolicyContext): Promise<PolicyResult | null>;
}

export interface PolicyContext {
  sessionID: string;
  cumulative: number;
}

export interface PolicyConfig {
  policies: Record<string, { enabled: boolean; enforce: boolean }>;
}

export function loadPolicyConfig(): PolicyConfig {
  const raw = process.env.FOUR_TBG_POLICIES || "";
  const policies: PolicyConfig["policies"] = {};

  if (raw.trim()) {
    for (const entry of raw.split(",")) {
      const [name, mode] = entry.trim().split("=");
      if (name) {
        policies[name] = {
          enabled: mode !== "off",
          enforce: mode === "enforce",
        };
      }
    }
  }

  // Defaults: all policies enabled but warn-only
  return { policies };
}

export async function runPolicyLoop(
  policies: Policy[],
  ctx: PolicyContext,
  config: PolicyConfig,
): Promise<PolicyResult[]> {
  const results: PolicyResult[] = [];

  for (const policy of policies) {
    const pConf = config.policies[policy.name] ?? { enabled: true, enforce: false };
    if (!pConf.enabled) continue;

    try {
      const result = await policy.check(ctx);
      if (result) {
        results.push(result);
      }
    } catch (err) {
      results.push({
        name: policy.name,
        level: "warn",
        message: `Policy error: ${err}`,
      });
    }
  }

  return results;
}
