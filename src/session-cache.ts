interface CacheEntry {
  tokens: number;
  lastAccess: number;
}

export class SessionTokenCache {
  private map = new Map<string, CacheEntry>();
  private readonly maxEntries: number;
  private readonly ttlMs: number;

  constructor(maxEntries = 1000, ttlMs = 60 * 60 * 1000) {
    this.maxEntries = maxEntries;
    this.ttlMs = ttlMs;
  }

  get(sessionID: string): number {
    const entry = this.map.get(sessionID);
    if (!entry) return 0;
    if (Date.now() - entry.lastAccess > this.ttlMs) {
      this.map.delete(sessionID);
      return 0;
    }
    entry.lastAccess = Date.now();
    return entry.tokens;
  }

  add(sessionID: string, delta: number): number {
    this.evictStale();
    // Read own state BEFORE LRU eviction so we don't self-evict
    const prev = this.get(sessionID); // touches lastAccess via get()
    // If we just added a new session, may need to evict
    this.evictOldestIfFull();
    const next = prev + delta;
    this.map.set(sessionID, { tokens: next, lastAccess: Date.now() });
    return next;
  }

  private evictStale(): void {
    const now = Date.now();
    for (const [key, entry] of this.map) {
      if (now - entry.lastAccess > this.ttlMs) {
        this.map.delete(key);
      }
    }
  }

  private evictOldestIfFull(): void {
    if (this.map.size < this.maxEntries) return;
    let oldestKey: string | null = null;
    let oldestTime = Infinity;
    for (const [key, entry] of this.map) {
      if (entry.lastAccess < oldestTime) {
        oldestTime = entry.lastAccess;
        oldestKey = key;
      }
    }
    if (oldestKey) this.map.delete(oldestKey);
  }

  size(): number {
    return this.map.size;
  }
}
