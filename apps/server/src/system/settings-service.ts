import { DEFAULT_SETTINGS, settingsSchema, type AppSettings, type SettingsUpdate } from '@glm/shared';
import type { ActivityService } from '../activity/activity-service.js';
import type { Db } from '../database/database.js';
import type { Clock } from '../shared/clock.js';

const PREFIX = 'setting.';

function serverTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
}

/** User-editable settings. Credentials are never stored here. */
export class SettingsService {
  private cache: AppSettings | null = null;

  constructor(
    private readonly db: Db,
    private readonly activity: ActivityService,
    private readonly clock: Clock,
  ) {}

  get(): AppSettings {
    if (this.cache) return this.cache;
    const rows = this.db
      .prepare(`SELECT setting_key, setting_value FROM application_settings WHERE setting_key LIKE 'setting.%'`)
      .all() as { setting_key: string; setting_value: string }[];
    const stored: Record<string, unknown> = {};
    for (const row of rows) {
      try {
        stored[row.setting_key.slice(PREFIX.length)] = JSON.parse(row.setting_value);
      } catch {
        // A damaged value falls back to its default below.
      }
    }
    const merged = { ...DEFAULT_SETTINGS, defaultTimeZone: serverTimeZone(), ...stored };
    const parsed = settingsSchema.safeParse(merged);
    this.cache = parsed.success ? parsed.data : { ...DEFAULT_SETTINGS, defaultTimeZone: serverTimeZone() };
    return this.cache;
  }

  update(changes: SettingsUpdate): AppSettings {
    const now = this.clock.nowIso();
    const upsert = this.db.prepare(
      `INSERT INTO application_settings (setting_key, setting_value, updated_at) VALUES (?, ?, ?)
       ON CONFLICT(setting_key) DO UPDATE SET setting_value = excluded.setting_value, updated_at = excluded.updated_at`,
    );
    this.db.transaction(() => {
      for (const [key, value] of Object.entries(changes)) {
        if (value === undefined) continue;
        upsert.run(`${PREFIX}${key}`, JSON.stringify(value), now);
      }
    })();
    this.cache = null;
    this.activity.record({
      eventType: 'settings',
      outcome: 'info',
      message: `Settings changed: ${Object.keys(changes).join(', ')}.`,
    });
    return this.get();
  }
}
