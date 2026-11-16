import { describe, it, expect } from "bun:test";
import { TurnTracker } from "../src/turn-tracker";

describe("TurnTracker", () => {
  it("accumulates tokens into the current turn delta", () => {
    const t = new TurnTracker();
    expect(t.addTokens("s1", 100)).toBe(100);
    expect(t.addTokens("s1", 50)).toBe(150);
    expect(t.getCurrentTurn("s1")).toBe(150);
  });

  it("beginTurn finalizes the cumulative value into history and resets the delta", () => {
    const t = new TurnTracker();
    // Turn 1 begins (cumulative context = 0, nothing to finalize yet).
    expect(t.beginTurn("s1", "architect", 0)).toBeNull();
    t.addTokens("s1", 100);
    expect(t.getCurrentTurn("s1")).toBe(100);

    // Turn 2 boundary: cumulative context is now 1000; finalize turn 1.
    expect(t.beginTurn("s1", "explore", 1000)).toBe("architect");
    expect(t.getHistory("s1")).toEqual([1000]);
    expect(t.getCurrentTurn("s1")).toBe(0);
  });

  it("records and returns the agent per turn", () => {
    const t = new TurnTracker();
    expect(t.getAgent("s1")).toBeNull();
    t.beginTurn("s1", "architect", 0);
    expect(t.getAgent("s1")).toBe("architect");
    t.beginTurn("s1", null, 0);
    expect(t.getAgent("s1")).toBeNull();
  });

  it("caps history at 50 completed turns without overflowing the turn number", () => {
    const t = new TurnTracker();
    for (let i = 0; i < 60; i++) {
      t.beginTurn("s1", "agent", i * 100);
    }
    expect(t.getHistory("s1")).toHaveLength(50);
    // Monotonic counter keeps counting past the cap.
    expect(t.getTurnNumber("s1")).toBe(60);
  });

  it("reports the active turn number monotonically", () => {
    const t = new TurnTracker();
    t.beginTurn("s1", "agent", 0); // turn 1 active
    expect(t.getTurnNumber("s1")).toBe(1);
    t.beginTurn("s1", "agent", 0); // turn 2 active
    expect(t.getTurnNumber("s1")).toBe(2);
  });

  it("keeps sessions independent", () => {
    const t = new TurnTracker();
    t.addTokens("s1", 100);
    t.addTokens("s2", 200);
    expect(t.getCurrentTurn("s1")).toBe(100);
    expect(t.getCurrentTurn("s2")).toBe(200);
  });
});
