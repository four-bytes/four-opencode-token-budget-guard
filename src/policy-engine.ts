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
        // The `enforce` config flag upgrades any non-ok result to a blocking
        // enforcement (policies themselves only report the finding).
        results.push(
          pConf.enforce && result.level !== "ok"
            ? { ...result, level: "enforce" }
            : result,
        );
      }
    } catch (err) {
      // `enforce` must fail closed: a crashing policy is itself a blocking
      // finding, otherwise a broken policy silently disables enforcement.
      results.push({
        name: policy.name,
        level: pConf.enforce ? "enforce" : "warn",
        message: `Policy error: ${err}`,
      });
    }
  }

  return results;
}
