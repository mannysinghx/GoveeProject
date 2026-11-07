import type {
  ActivityEventDto,
  ActivityEventType,
  ActivityListDto,
  ActivityOutcome,
  ActivityQuery,
} from '@glm/shared';
import type { Db } from '../database/database.js';
import type { Clock } from '../shared/clock.js';

export interface ActivityInput {
  eventType: ActivityEventType;
  outcome: ActivityOutcome;
  message: string;
  deviceId?: string | null;
  correlationId?: string | null;
  details?: unknown;
}

interface ActivityRow {
  id: number;
  created_at: string;
  event_type: ActivityEventType;
  outcome: ActivityOutcome;
  device_id: string | null;
  device_name: string | null;
  correlation_id: string | null;
  message: string;
  details_json: string | null;
}

function toDto(row: ActivityRow): ActivityEventDto {
  return {
    id: row.id,
    createdAt: row.created_at,
    eventType: row.event_type,
    outcome: row.outcome,
    deviceId: row.device_id,
    deviceName: row.device_name,
    correlationId: row.correlation_id,
    message: row.message,
    details: row.details_json ? JSON.parse(row.details_json) : null,
  };
}

export class ActivityService {
  private readonly insert;

  constructor(
    private readonly db: Db,
    private readonly clock: Clock,
    private readonly scrub: (text: string) => string,
  ) {
    this.insert = db.prepare(
      `INSERT INTO activity_events (created_at, event_type, outcome, device_id, correlation_id, message, details_json)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    );
  }

  record(input: ActivityInput): void {
    const details = input.details === undefined ? null : this.scrub(JSON.stringify(input.details));
    this.insert.run(
      this.clock.nowIso(),
      input.eventType,
      input.outcome,
      input.deviceId ?? null,
      input.correlationId ?? null,
      this.scrub(input.message),
      details,
    );
  }

  list(query: ActivityQuery): ActivityListDto {
    const where: string[] = [];
    const params: unknown[] = [];
    if (query.deviceId) {
      where.push('a.device_id = ?');
      params.push(query.deviceId);
    }
    if (query.eventType) {
      where.push('a.event_type = ?');
      params.push(query.eventType);
    }
    if (query.outcome) {
      where.push('a.outcome = ?');
      params.push(query.outcome);
    }
    if (query.from) {
      where.push('a.created_at >= ?');
      params.push(new Date(query.from).toISOString());
    }
    if (query.to) {
      where.push('a.created_at <= ?');
      params.push(new Date(query.to).toISOString());
    }
    if (query.beforeId) {
      where.push('a.id < ?');
      params.push(query.beforeId);
    }
    const clause = where.length > 0 ? `WHERE ${where.join(' AND ')}` : '';
    const rows = this.db
      .prepare(
        `SELECT a.*, d.name AS device_name
         FROM activity_events a
         LEFT JOIN devices d ON d.id = a.device_id
         ${clause}
         ORDER BY a.id DESC
         LIMIT ?`,
      )
      .all(...params, query.limit + 1) as ActivityRow[];

    const hasMore = rows.length > query.limit;
    const page = hasMore ? rows.slice(0, query.limit) : rows;
    return {
      events: page.map(toDto),
      nextBeforeId: hasMore ? (page.at(-1)?.id ?? null) : null,
    };
  }

  recentFailures(limit: number): ActivityEventDto[] {
    return this.list({ outcome: 'failure', limit }).events;
  }

  prune(olderThanIso: string): number {
    return this.db.prepare('DELETE FROM activity_events WHERE created_at < ?').run(olderThanIso).changes;
  }
}
