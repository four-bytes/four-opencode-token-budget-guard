/**
 * Native compaction trigger helpers.
 *
 * This module only decides WHEN opencode's own `session.summarize()` may run
 * and bounds that call. It deliberately contains no pruning engine and no
 * signal protocol — that remains the context-curator's job.
 */

/**
 * True when the token `basis` has reached `compactPct` percent of the effective
 * `hardLimit` AND the per-session cooldown since `lastTriggerTs` has elapsed.
 *
 * `lastTriggerTs === undefined` means the session has never triggered, so the
 * cooldown does not apply. `now` is injectable for tests.
 */
export function shouldTriggerCompaction(
  basis: number,
  hardLimit: number,
  compactPct: number,
  lastTriggerTs: number | undefined,
  cooldownMs: number,
  now: number = Date.now(),
): boolean {
  const threshold = Math.floor((hardLimit * compactPct) / 100);
  if (basis < threshold) return false;
  if (lastTriggerTs === undefined) return true;
  return now - lastTriggerTs >= cooldownMs;
}

/**
 * Reject when `promise` does not settle within `ms` milliseconds.
 *
 * The underlying promise is NOT aborted — the caller simply stops waiting and
 * the original promise is left to settle (or hang) on its own. This is the
 * desired behaviour for opencode's native `session.summarize()`, which can hang
 * and freeze the whole session: we must not block the caller, but we also
 * cannot safely abort an SDK call we do not control.
 *
 * Non-positive or non-finite `ms` returns the promise unchanged (no timeout).
 */
export function withTimeout<T>(
  promise: Promise<T>,
  ms: number,
  label: string,
): Promise<T> {
  if (!Number.isFinite(ms) || ms <= 0) return promise;
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`${label} timed out after ${ms}ms`)),
      ms,
    );
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      },
    );
  });
}
