import { z } from 'zod';
import { activityEventTypes, activityOutcomes, type AiReferenceDto, type AiReferenceKind } from '@glm/shared';
import type { ActivityService } from '../activity/activity-service.js';
import type { CommandStore } from '../commands/command-store.js';
import type { ConnectionMonitor } from '../connection/connection-monitor.js';
import type { DeviceService } from '../devices/device-service.js';
import type { ScheduleService } from '../scheduler/schedule-service.js';
import { AppError } from '../shared/errors.js';
import type { ToolDefinition } from './providers.js';

/**
 * The only things Ask can do: read the app's own records. There is deliberately no tool that
 * changes lights, schedules or settings, so nothing the model reads can make it act.
 *
 * Results leave out what the answer does not need and should not leave the server: Govee
 * device ids, sign-in history and the IP addresses in it, and the home's latitude and longitude.
 */
export interface AskToolDeps {
  devices: DeviceService;
  schedules: ScheduleService;
  commands: CommandStore;
  connection: ConnectionMonitor;
  activity: ActivityService;
}

/** Everything the tools returned in one question, so the answer can only cite real records. */
export class ReferenceRegistry {
  private readonly refs = new Map<string, AiReferenceDto>();

  add(kind: AiReferenceKind, id: string, label: string, href: string): string {
    const ref = `${kind}:${id}`;
    if (!this.refs.has(ref)) this.refs.set(ref, { ref, kind, label: label.slice(0, 120), href });
    return ref;
  }

  get(ref: string): AiReferenceDto | undefined {
    return this.refs.get(ref);
  }

  get size(): number {
    return this.refs.size;
  }
}

const SAFE_ID = /^[A-Za-z0-9_-]{1,64}$/;
const idSchema = z.string().regex(SAFE_ID, 'Not a valid id');
const QUERYABLE_TYPES = activityEventTypes.filter((t) => t !== 'auth');

const argSchemas = {
  list_lights: z.object({}).strict(),
  list_schedules: z.object({}).strict(),
  get_schedule_runs: z.object({ schedule_id: idSchema, limit: z.number().int().min(1).max(20).default(10) }).strict(),
  get_light_commands: z.object({ light_id: idSchema, limit: z.number().int().min(1).max(30).default(15) }).strict(),
  get_connection_history: z.object({}).strict(),
  search_activity: z
    .object({
      from: z.iso.datetime({ offset: true }).optional(),
      to: z.iso.datetime({ offset: true }).optional(),
      light_id: idSchema.optional(),
      type: z.enum(QUERYABLE_TYPES as [string, ...string[]]).optional(),
      outcome: z.enum(activityOutcomes).optional(),
      limit: z.number().int().min(1).max(50).default(30),
    })
    .strict(),
} as const;

export type AskToolName = keyof typeof argSchemas;

const NO_PARAMS = { type: 'object', properties: {}, additionalProperties: false };

export const ASK_TOOLS: ToolDefinition[] = [
  {
    type: 'function',
    function: {
      name: 'list_lights',
      description:
        'Every light: its id, name, model, whether Govee lists it, online or offline, when it was last online, current problem and how often it dropped out in the last 7 days.',
      parameters: NO_PARAMS,
    },
  },
  {
    type: 'function',
    function: {
      name: 'list_schedules',
      description:
        'Every schedule: id, name, on or off, time zone, when it repeats, what it targets and does, its next run, its missed-run policy, any problem, and its latest run.',
      parameters: NO_PARAMS,
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_schedule_runs',
      description:
        'Recent runs of one schedule, newest first: when it was due, when it ran, and the result (all_accepted, partial, failed, skipped, missed or interrupted) with any error.',
      parameters: {
        type: 'object',
        properties: {
          schedule_id: { type: 'string', description: 'The schedule id from list_schedules' },
          limit: { type: 'integer', minimum: 1, maximum: 20 },
        },
        required: ['schedule_id'],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_light_commands',
      description:
        'Recent commands sent to one light, newest first: what was sent, from where (manual, preset, group, schedule), and whether Govee accepted, rejected or failed it, with the reason.',
      parameters: {
        type: 'object',
        properties: {
          light_id: { type: 'string', description: 'The light id from list_lights' },
          limit: { type: 'integer', minimum: 1, maximum: 30 },
        },
        required: ['light_id'],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_connection_history',
      description:
        "Connection monitoring: the app's current diagnosis, recent incidents (a light offline or missing, Govee unreachable, the key rejected, rate limits) with start and end times, and anything waiting to be resent to a light.",
      parameters: NO_PARAMS,
    },
  },
  {
    type: 'function',
    function: {
      name: 'search_activity',
      description:
        'Search the activity log, newest first. Filter by time range (ISO 8601 with a time zone offset), light, type and outcome.',
      parameters: {
        type: 'object',
        properties: {
          from: { type: 'string', description: 'Start, ISO 8601 with offset' },
          to: { type: 'string', description: 'End, ISO 8601 with offset' },
          light_id: { type: 'string' },
          type: { type: 'string', enum: QUERYABLE_TYPES },
          outcome: { type: 'string', enum: [...activityOutcomes] },
          limit: { type: 'integer', minimum: 1, maximum: 50 },
        },
        additionalProperties: false,
      },
    },
  },
];

/** Longest tool result sent back, in characters, so one result cannot blow up the cost. */
const MAX_RESULT_CHARS = 12_000;

function capped(value: unknown): string {
  const text = JSON.stringify(value);
  if (text.length <= MAX_RESULT_CHARS) return text;
  return JSON.stringify({ note: 'Result shortened. Ask for fewer items or a narrower time range.', partial: text.slice(0, MAX_RESULT_CHARS) });
}

export class AskTools {
  constructor(private readonly deps: AskToolDeps) {}

  /** Runs one tool call. Bad arguments and unknown names come back as errors for the model, never thrown. */
  run(name: string, rawArguments: string, refs: ReferenceRegistry): string {
    if (!(name in argSchemas)) return JSON.stringify({ error: `There is no tool called ${name}.` });
    let raw: unknown;
    try {
      raw = rawArguments.trim() === '' ? {} : JSON.parse(rawArguments);
    } catch {
      return JSON.stringify({ error: 'The arguments were not valid JSON.' });
    }
    const schema = argSchemas[name as AskToolName];
    const parsed = schema.safeParse(raw);
    if (!parsed.success) {
      return JSON.stringify({ error: `Invalid arguments: ${parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')}` });
    }
    try {
      return capped(this.dispatch(name as AskToolName, parsed.data, refs));
    } catch (error) {
      if (error instanceof AppError) return JSON.stringify({ error: error.message });
      throw error;
    }
  }

  private dispatch(name: AskToolName, args: Record<string, unknown>, refs: ReferenceRegistry): unknown {
    switch (name) {
      case 'list_lights':
        return this.listLights(refs);
      case 'list_schedules':
        return this.listSchedules(refs);
      case 'get_schedule_runs':
        return this.scheduleRuns(args.schedule_id as string, args.limit as number, refs);
      case 'get_light_commands':
        return this.lightCommands(args.light_id as string, args.limit as number, refs);
      case 'get_connection_history':
        return this.connectionHistory(refs);
      case 'search_activity':
        return this.searchActivity(args, refs);
    }
  }

  private listLights(refs: ReferenceRegistry) {
    const health = new Map(this.deps.connection.report().devices.map((d) => [d.deviceId, d]));
    return this.deps.devices.list().map((device) => {
      const h = health.get(device.id);
      return {
        ref: refs.add('light', device.id, device.name, `/devices/${device.id}`),
        id: device.id,
        name: device.name,
        model: device.sku,
        isGoveeAppGroup: device.isGoveeGroup,
        listedByGovee: device.discoveryStatus === 'present',
        missingSince: device.missingSince,
        connectivity: device.connectivity,
        health: h?.state ?? null,
        problemSince: h?.problemSince ?? null,
        lastOnlineAt: device.lastOnlineAt,
        lastCheckedAt: device.lastStatusRefreshAt,
        lastCommandAcceptedAt: device.lastAcceptedAt,
        dropsLast7Days: h?.dropsLast7Days ?? null,
        lastStatusError: device.lastStatusError ? { category: device.lastStatusError.category, at: device.lastStatusError.at } : null,
        note: h?.note ?? null,
      };
    });
  }

  private listSchedules(refs: ReferenceRegistry) {
    return this.deps.schedules.list().map((s) => ({
      ref: refs.add('schedule', s.id, s.name, '/schedules'),
      id: s.id,
      name: s.name,
      enabled: s.enabled,
      timeZone: s.timeZone,
      repeats: s.recurrence,
      target: s.targetName,
      does: s.actionSummary,
      missedRunPolicy: s.missedRunPolicy,
      nextRun: s.nextRun?.local ?? null,
      problem: s.problem,
      holidayShow: s.builtinShow,
      latestRun: s.lastExecution
        ? {
            ref: refs.add('run', s.lastExecution.id, `${s.name}, ${s.lastExecution.scheduledFor}`, '/schedules'),
            dueAt: s.lastExecution.scheduledFor,
            status: s.lastExecution.status,
            error: s.lastExecution.errorSummary,
          }
        : null,
    }));
  }

  private scheduleRuns(scheduleId: string, limit: number, refs: ReferenceRegistry) {
    const schedule = this.deps.schedules.get(scheduleId);
    return {
      schedule: schedule.name,
      runs: this.deps.schedules.executions(scheduleId, limit).map((run) => ({
        ref: refs.add('run', run.id, `${schedule.name}, ${run.scheduledFor}`, '/schedules'),
        dueAt: run.scheduledFor,
        startedAt: run.startedAt,
        finishedAt: run.completedAt,
        status: run.status,
        recoveredLate: run.isRecovery,
        error: run.errorSummary,
      })),
    };
  }

  private lightCommands(lightId: string, limit: number, refs: ReferenceRegistry) {
    const device = this.deps.devices.getRecord(lightId);
    return {
      light: device.name,
      commands: this.deps.commands.listForDevice(lightId, limit).map((c) => ({
        ref: refs.add('command', c.id, `${device.name}: ${c.summary}`, `/devices/${lightId}`),
        sent: c.summary,
        from: c.sourceType,
        status: c.status,
        confirmed: c.verification,
        attempts: c.attempts,
        errorCategory: c.errorCategory,
        error: c.errorMessage,
        createdAt: c.createdAt,
        acceptedAt: c.acceptedAt,
      })),
    };
  }

  private connectionHistory(refs: ReferenceRegistry) {
    const report = this.deps.connection.report();
    return {
      overall: report.overall,
      monitor: report.monitor,
      resendMissedEnabled: report.catchUpEnabled,
      diagnosis: report.advice.map((a) => ({ severity: a.severity, title: a.title, explanation: a.explanation })),
      incidents: report.incidents.slice(0, 30).map((i) => ({
        ref: refs.add('incident', String(i.id), `${i.deviceName ?? 'All lights'}: ${i.kind}`, '/connections'),
        kind: i.kind,
        light: i.deviceName,
        openedAt: i.openedAt,
        closedAt: i.closedAt,
      })),
      waitingToResend: report.waiting.map((w) => ({ light: w.deviceName, run: w.runName, since: w.createdAt })),
    };
  }

  private searchActivity(args: Record<string, unknown>, refs: ReferenceRegistry) {
    const limit = args.limit as number;
    // Sign-in events hold IP addresses, so they are never searched or returned.
    const page = this.deps.activity.list({
      ...(args.from ? { from: args.from as string } : {}),
      ...(args.to ? { to: args.to as string } : {}),
      ...(args.light_id ? { deviceId: args.light_id as string } : {}),
      ...(args.type ? { eventType: args.type as (typeof QUERYABLE_TYPES)[number] } : {}),
      ...(args.outcome ? { outcome: args.outcome as (typeof activityOutcomes)[number] } : {}),
      limit: Math.min(500, limit * 3),
    });
    return page.events
      .filter((e) => e.eventType !== 'auth')
      .slice(0, limit)
      .map((e) => ({
        ref: refs.add('activity', String(e.id), e.message, '/activity'),
        at: e.createdAt,
        type: e.eventType,
        outcome: e.outcome,
        light: e.deviceName,
        message: e.message,
      }));
  }
}
