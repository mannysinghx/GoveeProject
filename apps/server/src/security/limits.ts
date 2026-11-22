import type { Db } from '../database/database.js';

/**
 * Counts one more use of `key` in a fixed window, in the control database's request_limits
 * table, so the count survives a restart. True while the count is within `limit`.
 */
export function hitLimit(control: Db, key: string, limit: number, windowMs: number, nowMs: number): boolean {
  return control.transaction(() => {
    const row = control.prepare('SELECT window_started, count FROM request_limits WHERE limit_key = ?').get(key) as
      | { window_started: string; count: number }
      | undefined;
    const fresh = !row || nowMs - Date.parse(row.window_started) >= windowMs;
    const count = fresh ? 1 : row.count + 1;
    control
      .prepare(
        `INSERT INTO request_limits (limit_key, window_started, count) VALUES (?, ?, ?)
         ON CONFLICT(limit_key) DO UPDATE SET window_started = excluded.window_started, count = excluded.count`,
      )
      .run(key, fresh ? new Date(nowMs).toISOString() : row.window_started, count);
    return count <= limit;
  })();
}

/**
 * Signed-in requests per account per minute, kept in memory: it is checked on every request,
 * and losing the counts on a restart only resets the minute.
 */
export class RequestRate {
  private readonly windows = new Map<number, { startedMs: number; count: number }>();

  constructor(
    private readonly limit: number,
    private readonly windowMs = 60_000,
  ) {}

  /** Seconds to wait, or 0 when this request may go ahead. */
  hit(userId: number, nowMs: number): number {
    const window = this.windows.get(userId);
    if (!window || nowMs - window.startedMs >= this.windowMs) {
      this.windows.set(userId, { startedMs: nowMs, count: 1 });
      if (this.windows.size > 10_000) this.prune(nowMs);
      return 0;
    }
    window.count += 1;
    if (window.count <= this.limit) return 0;
    return Math.max(1, Math.ceil((window.startedMs + this.windowMs - nowMs) / 1000));
  }

  private prune(nowMs: number): void {
    for (const [userId, window] of this.windows) if (nowMs - window.startedMs >= this.windowMs) this.windows.delete(userId);
  }
}
