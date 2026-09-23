import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/** Per-agent per-turn token budget thresholds. */
export interface AgentBudget {
  softPerTurn: number;
  hardPerTurn: number;
}

/** Map of agent name → partial budget (missing keys fall back to DEFAULT). */
export type BudgetConfigMap = Record<string, Partial<AgentBudget>>;

/** Hardcoded fallback used when neither an agent entry nor `default` exists. */
export const DEFAULT_AGENT_BUDGET: AgentBudget = {
  softPerTurn: 60_000,
  hardPerTurn: 120_000,
};

/** Context-growth slope alarm parameters. */
export interface GrowthParams {
  growthPct: number;
  growthWindow: number;
  projectTurns: number;
  contextWindow: number;
}

export const DEFAULT_GROWTH_PARAMS: GrowthParams = {
  growthPct: 25,
  growthWindow: 10,
  projectTurns: 15,
  contextWindow: 200_000,
};

/**
 * Strip JSONC comments (// line and /* block) without touching string literals.
 * Keeps everything else intact so JSON.parse can run afterwards.
 */
export function stripJsoncComments(text: string): string {
  let result = "";
  let i = 0;
  let inString = false;
  let inLineComment = false;
  let inBlockComment = false;

  while (i < text.length) {
    const ch = text[i];
    const next = text[i + 1];

    if (inLineComment) {
      if (ch === "\n") {
        inLineComment = false;
        result += ch;
      }
      i++;
      continue;
    }
    if (inBlockComment) {
      if (ch === "*" && next === "/") {
        inBlockComment = false;
        i += 2;
        continue;
      }
      i++;
      continue;
    }
    if (inString) {
      if (ch === "\\") {
        result += ch + (next ?? "");
        i += 2;
        continue;
      }
      if (ch === '"') inString = false;
      result += ch;
      i++;
      continue;
    }
    if (ch === '"') {
      inString = true;
      result += ch;
      i++;
      continue;
    }
    if (ch === "/" && next === "/") {
      inLineComment = true;
      i += 2;
      continue;
    }
    if (ch === "/" && next === "*") {
      inBlockComment = true;
      i += 2;
      continue;
    }
    result += ch;
    i++;
  }
  return result;
}

export interface ParsedBudgetConfig {
  agents: BudgetConfigMap;
  growth: Partial<GrowthParams>;
}

const AGENT_KEYS = ["softPerTurn", "hardPerTurn"] as const;
const GROWTH_KEYS = ["growthPct", "growthWindow", "projectTurns", "contextWindow"] as const;

function isGrowthKey(key: string): key is keyof GrowthParams {
  return (GROWTH_KEYS as readonly string[]).includes(key);
}

function sanitizeAgentBudget(value: unknown): Partial<AgentBudget> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const obj = value as Record<string, unknown>;
  const out: Partial<AgentBudget> = {};
  for (const key of AGENT_KEYS) {
    const v = obj[key];
    if (typeof v === "number" && Number.isFinite(v) && v > 0) {
      out[key] = v;
    }
  }
  return out;
}

/**
 * Parse opencode.json(c) content into token_budget_guard config.
 * Agent entries are objects (`softPerTurn`/`hardPerTurn`); growth parameters are
 * top-level numeric scalars. Returns null on malformed input / missing section.
 */
export function parseBudgetConfig(raw: string): ParsedBudgetConfig | null {
  try {
    const parsed = JSON.parse(stripJsoncComments(raw)) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    const tbg = (parsed as Record<string, unknown>).token_budget_guard;
    if (!tbg || typeof tbg !== "object" || Array.isArray(tbg)) return null;

    const agents: BudgetConfigMap = {};
    const growth: Partial<GrowthParams> = {};
    for (const [key, value] of Object.entries(tbg as Record<string, unknown>)) {
      if (typeof value === "number") {
        if (isGrowthKey(key)) growth[key] = value;
        continue;
      }
      const sanitized = sanitizeAgentBudget(value);
      if (sanitized) agents[key] = sanitized;
    }
    return { agents, growth };
  } catch {
    return null;
  }
}

/**
 * Load token_budget_guard config from opencode.json / opencode.jsonc in the
 * project directory. Never throws — returns empty config on any failure.
 */
export function loadBudgetConfig(directory: string | undefined): ParsedBudgetConfig {
  const merged: ParsedBudgetConfig = { agents: {}, growth: {} };
  if (!directory) return merged;
  for (const name of ["opencode.json", "opencode.jsonc"]) {
    let raw: string;
    try {
      raw = readFileSync(resolve(directory, name), "utf-8");
    } catch {
      continue;
    }
    const parsed = parseBudgetConfig(raw);
    if (parsed) {
      Object.assign(merged.agents, parsed.agents);
      Object.assign(merged.growth, parsed.growth);
    }
  }
  return merged;
}

function envPositiveInt(key: string, fallback: number): number {
  const v = process.env[key];
  if (!v) return fallback;
  const n = parseInt(v, 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

/**
 * Resolve growth parameters: env override → config-file override → hardcoded default.
 * Accepts the already-parsed config-file growth overrides (callers should load
 * the config once and pass the `growth` slice in).
 */
export function loadGrowthParams(
  fileGrowth: Partial<GrowthParams> | undefined,
): GrowthParams {
  const f = fileGrowth ?? {};
  return {
    growthPct: envPositiveInt("FOUR_TBG_GROWTH_PCT", f.growthPct ?? DEFAULT_GROWTH_PARAMS.growthPct),
    growthWindow: envPositiveInt("FOUR_TBG_GROWTH_WINDOW", f.growthWindow ?? DEFAULT_GROWTH_PARAMS.growthWindow),
    projectTurns: envPositiveInt("FOUR_TBG_PROJECT_TURNS", f.projectTurns ?? DEFAULT_GROWTH_PARAMS.projectTurns),
    contextWindow: envPositiveInt("FOUR_TBG_CONTEXT_WINDOW", f.contextWindow ?? DEFAULT_GROWTH_PARAMS.contextWindow),
  };
}

/**
 * Evaluate the per-turn threshold for a given turn token count against a budget.
 * Returns the highest exceeded level, or null if under soft.
 */
export function evaluatePerTurnThreshold(
  turnTokens: number,
  budget: AgentBudget,
): "soft" | "hard" | null {
  if (turnTokens >= budget.hardPerTurn) return "hard";
  if (turnTokens >= budget.softPerTurn) return "soft";
  return null;
}

/**
 * Resolves a per-agent budget with the order:
 * agent entry → `default` entry → built-in DEFAULT_AGENT_BUDGET.
 * Unknown agents fall back to `default` and notify `onUnknownAgent` once per name.
 */
export class AgentBudgetResolver {
  private readonly configs: BudgetConfigMap;
  private readonly unknownAgents = new Set<string>();
  private readonly onUnknownAgent: (agent: string) => void;

  constructor(configs: BudgetConfigMap, onUnknownAgent?: (agent: string) => void) {
    this.configs = configs;
    this.onUnknownAgent = onUnknownAgent ?? (() => {});
  }

  resolve(agent?: string | null): AgentBudget {
    if (
      agent &&
      agent !== "default" &&
      !Object.hasOwn(this.configs, agent) &&
      !this.unknownAgents.has(agent)
    ) {
      this.unknownAgents.add(agent);
      this.onUnknownAgent(agent);
    }

    const entry =
      agent && Object.hasOwn(this.configs, agent)
        ? this.configs[agent]
        : this.configs.default;
    return { ...DEFAULT_AGENT_BUDGET, ...(entry ?? {}) };
  }
}
