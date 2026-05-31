import { describe, it, expect } from "bun:test";
import { SessionTokenCache } from "../src/session-cache";

describe("SessionTokenCache", () => {
  it("accumulates tokens per session", () => {
    const c = new SessionTokenCache(10, 60_000);
    expect(c.add("s1", 100)).toBe(100);
    expect(c.add("s1", 50)).toBe(150);
  });

  it("evicts stale entries after TTL", async () => {
    const c = new SessionTokenCache(10, 10);
    c.add("s1", 100);
    await Bun.sleep(20);
    expect(c.get("s1")).toBe(0);
  });

  it("evicts oldest when full", () => {
    const c = new SessionTokenCache(2, 60_000);
    c.add("s1", 100);
    c.add("s2", 200);
    c.add("s3", 300);
    expect(c.size()).toBe(2);
    expect(c.get("s1")).toBe(0); // s1 evicted
  });

  it("does not self-evict when own session is oldest and cache full", () => {
    const c = new SessionTokenCache(2, 60_000);
    c.add("s1", 100);  // s1 oldest
    c.add("s2", 200);  // cache full
    // s1 is the oldest, but adding to s1 should NOT evict s1
    const result = c.add("s1", 50);
    expect(result).toBe(150);  // accumulated
    expect(c.size()).toBe(2);
    expect(c.get("s2")).toBe(200);  // s2 still present
  });
});
