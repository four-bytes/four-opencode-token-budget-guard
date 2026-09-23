import { describe, it, expect } from "bun:test";
import {
  AgentBudgetResolver,
  DEFAULT_AGENT_BUDGET,
  DEFAULT_GROWTH_PARAMS,
  evaluatePerTurnThreshold,
  loadGrowthParams,
  parseBudgetConfig,
  stripJsoncComments,
} from "../src/agent-config";

describe("stripJsoncComments", () => {
  it("strips line and block comments", () => {
    const out = stripJsoncComments(
      `{
        // line comment
        "a": 1,
        /* block
           comment */
        "b": 2
      }`,
    );
    expect(out).not.toContain("line comment");
    expect(out).not.toContain("block");
    expect(out).toContain('"a": 1');
    expect(out).toContain('"b": 2');
  });

  it("does not strip // inside string literals", () => {
    const out = stripJsoncComments(`{ "url": "https://example.com" }`);
    expect(out).toContain("https://example.com");
  });
});

describe("parseBudgetConfig", () => {
  it("parses per-agent entries from JSONC", () => {
    const raw = `{
      "token_budget_guard": {
        // per-agent per-turn budgets
        "default":   { "softPerTurn": 60000,  "hardPerTurn": 120000 },
        "architect": { "softPerTurn": 120000, "hardPerTurn": 190000 },
        "explore":   { "softPerTurn": 25000,  "hardPerTurn": 50000 }
      }
    }`;
    const parsed = parseBudgetConfig(raw);
    expect(parsed).not.toBeNull();
    expect(parsed!.agents.default).toEqual({ softPerTurn: 60000, hardPerTurn: 120000 });
    expect(parsed!.agents.architect).toEqual({ softPerTurn: 120000, hardPerTurn: 190000 });
    expect(parsed!.agents.explore).toEqual({ softPerTurn: 25000, hardPerTurn: 50000 });
  });

  it("parses growth parameters as top-level numeric scalars", () => {
    const raw = `{
      "token_budget_guard": {
        "growthPct": 40,
        "growthWindow": 5,
        "projectTurns": 8,
        "contextWindow": 128000,
        "default": { "softPerTurn": 60000, "hardPerTurn": 120000 }
      }
    }`;
    const parsed = parseBudgetConfig(raw);
    expect(parsed).not.toBeNull();
    expect(parsed!.growth.growthPct).toBe(40);
    expect(parsed!.growth.growthWindow).toBe(5);
    expect(parsed!.growth.projectTurns).toBe(8);
    expect(parsed!.growth.contextWindow).toBe(128000);
    // growth scalars are not mistaken for agents
    expect(parsed!.agents.growthPct).toBeUndefined();
  });

  it("returns null on malformed JSON", () => {
    expect(parseBudgetConfig("{ not json")).toBeNull();
  });

  it("returns null when section is missing", () => {
    expect(parseBudgetConfig(`{ "other": 1 }`)).toBeNull();
  });

  it("ignores non-numeric / non-positive agent values", () => {
    const raw = `{
      "token_budget_guard": {
        "default": { "softPerTurn": -1, "hardPerTurn": "nope" }
      }
    }`;
    const parsed = parseBudgetConfig(raw);
    expect(parsed).not.toBeNull();
    expect(parsed!.agents.default).toEqual({});
  });
});

describe("AgentBudgetResolver", () => {
  const configs = {
    default: { softPerTurn: 60000, hardPerTurn: 120000 },
    architect: { softPerTurn: 120000, hardPerTurn: 190000 },
  };

  it("resolves a known agent entry", () => {
    const r = new AgentBudgetResolver(configs);
    expect(r.resolve("architect")).toEqual({ softPerTurn: 120000, hardPerTurn: 190000 });
  });

  it("falls back to default for unknown agent (logged once)", () => {
    const seen: string[] = [];
    const r = new AgentBudgetResolver(configs, (a) => seen.push(a));
    expect(r.resolve("unknown_agent")).toEqual({ softPerTurn: 60000, hardPerTurn: 120000 });
    expect(r.resolve("unknown_agent")).toEqual({ softPerTurn: 60000, hardPerTurn: 120000 });
    expect(seen).toEqual(["unknown_agent"]); // logged ONCE
  });

  it("falls back to hardcoded DEFAULT when no default entry exists", () => {
    const r = new AgentBudgetResolver({ architect: { softPerTurn: 120000, hardPerTurn: 190000 } });
    expect(r.resolve("explore")).toEqual(DEFAULT_AGENT_BUDGET);
  });

  it("handles null/undefined agent via default", () => {
    const r = new AgentBudgetResolver(configs);
    expect(r.resolve(null)).toEqual({ softPerTurn: 60000, hardPerTurn: 120000 });
    expect(r.resolve(undefined)).toEqual({ softPerTurn: 60000, hardPerTurn: 120000 });
  });

  it("merges partial agent entries over DEFAULT", () => {
    const r = new AgentBudgetResolver({ partial: { hardPerTurn: 300000 } });
    expect(r.resolve("partial")).toEqual({ softPerTurn: DEFAULT_AGENT_BUDGET.softPerTurn, hardPerTurn: 300000 });
  });
});

describe("evaluatePerTurnThreshold", () => {
  const budget = { softPerTurn: 100, hardPerTurn: 200 };

  it("returns null when under soft", () => {
    expect(evaluatePerTurnThreshold(99, budget)).toBeNull();
  });

  it("returns soft at/above softPerTurn", () => {
    expect(evaluatePerTurnThreshold(100, budget)).toBe("soft");
    expect(evaluatePerTurnThreshold(150, budget)).toBe("soft");
  });

  it("returns hard at/above hardPerTurn", () => {
    expect(evaluatePerTurnThreshold(200, budget)).toBe("hard");
    expect(evaluatePerTurnThreshold(9999, budget)).toBe("hard");
  });
});

describe("loadGrowthParams", () => {
  const saved: Record<string, string | undefined> = {};
  const keys = [
    "FOUR_TBG_GROWTH_PCT",
    "FOUR_TBG_GROWTH_WINDOW",
    "FOUR_TBG_PROJECT_TURNS",
    "FOUR_TBG_CONTEXT_WINDOW",
  ];

  function saveEnv() {
    for (const k of keys) saved[k] = process.env[k];
  }
  function restoreEnv() {
    for (const k of keys) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  }

  it("returns hardcoded defaults when no env/config", () => {
    saveEnv();
    for (const k of keys) delete process.env[k];
    try {
      expect(loadGrowthParams(undefined)).toEqual(DEFAULT_GROWTH_PARAMS);
    } finally {
      restoreEnv();
    }
  });

  it("env vars override defaults", () => {
    saveEnv();
    process.env.FOUR_TBG_GROWTH_PCT = "50";
    process.env.FOUR_TBG_GROWTH_WINDOW = "7";
    try {
      const p = loadGrowthParams(undefined);
      expect(p.growthPct).toBe(50);
      expect(p.growthWindow).toBe(7);
      expect(p.projectTurns).toBe(DEFAULT_GROWTH_PARAMS.projectTurns);
    } finally {
      restoreEnv();
    }
  });

  it("config-file overrides apply when no env is set", () => {
    saveEnv();
    for (const k of keys) delete process.env[k];
    try {
      const p = loadGrowthParams({ growthPct: 40, growthWindow: 5 });
      expect(p.growthPct).toBe(40);
      expect(p.growthWindow).toBe(5);
      expect(p.projectTurns).toBe(DEFAULT_GROWTH_PARAMS.projectTurns);
      expect(p.contextWindow).toBe(DEFAULT_GROWTH_PARAMS.contextWindow);
    } finally {
      restoreEnv();
    }
  });

  it("env vars take precedence over config-file overrides", () => {
    saveEnv();
    process.env.FOUR_TBG_GROWTH_PCT = "60";
    try {
      const p = loadGrowthParams({ growthPct: 40 });
      expect(p.growthPct).toBe(60);
    } finally {
      restoreEnv();
    }
  });
});
