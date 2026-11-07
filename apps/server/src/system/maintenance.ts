import type { Logger } from 'pino';
import type { ActivityService } from '../activity/activity-service.js';
import type { AuthService } from '../auth/auth-service.js';
import type { CommandStore } from '../commands/command-store.js';
import type { Db } from '../database/database.js';
import type { DeviceService } from '../devices/device-service.js';
import type { Clock } from '../shared/clock.js';
import type { SystemState } from './system-state.js';

const HOUR_MS = 3600 * 1000;

/** Hourly housekeeping: expired sessions, old history, and a slow discovery refresh. */
export class Maintenance {
  private timer: NodeJS.Timeout | null = null;

  constructor(
    private readonly db: Db,
    private readonly auth: AuthService,
    private readonly activity: ActivityService,
    private readonly commands: CommandStore,
    private readonly devices: DeviceService,
    private readonly system: SystemState,
    private readonly logger: Logger,
    private readonly clock: Clock,
    private readonly config: { historyRetentionDays: number; discoveryRefreshHours: number; apiKeyConfigured: boolean },
  ) {}

  start(): void {
    void this.run();
    this.timer = setInterval(() => void this.run(), HOUR_MS);
    this.timer.unref?.();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  async run(): Promise<void> {
    try {
      this.prune();
    } catch (error) {
      this.logger.warn({ err: error }, 'History pruning failed');
    }
    const { discoveryRefreshHours, apiKeyConfigured } = this.config;
    if (!apiKeyConfigured || discoveryRefreshHours <= 0) return;
    const last = this.system.lastDiscovery();
    // Discovery stays manual until the owner has run it once.
    if (!last) return;
    if (this.clock.nowMs() - Date.parse(last) < discoveryRefreshHours * HOUR_MS) return;
    try {
      await this.devices.discover();
    } catch (error) {
      this.logger.warn({ err: error }, 'Background discovery refresh failed');
    }
  }

  prune(): void {
    const cutoff = new Date(this.clock.nowMs() - this.config.historyRetentionDays * 24 * HOUR_MS).toISOString();
    this.auth.pruneExpiredSessions();
    const events = this.activity.prune(cutoff);
    const commands = this.commands.prune(cutoff);
    this.db.prepare(`DELETE FROM execution_runs WHERE started_at < ? AND status != 'running'`).run(cutoff);
    if (events + commands > 0) {
      this.logger.info({ events, commands, cutoff }, 'Pruned old history');
    }
  }
}
