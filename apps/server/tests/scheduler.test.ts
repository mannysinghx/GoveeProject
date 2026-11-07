import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { DeviceDto, GroupDto, PresetDto, ScheduleCreate, ScheduleDto } from '@glm/shared';
import { Scheduler } from '../src/scheduler/scheduler.js';
import { authedClient, createHarness, type Harness } from './support/harness.js';
import { mockBasicDevice, mockFullDevice } from './support/mock-govee.js';

type Client = Awaited<ReturnType<typeof authedClient>>;

describe('scheduler', () => {
  let h: Harness;
  let client: Client;
  let device: DeviceDto;
  let basic: DeviceDto;

  beforeEach(async () => {
    h = await createHarness();
    h.mock.devices = [mockFullDevice(), mockBasicDevice()];
    client = await authedClient(h.app);
    const discovered = (await client.post('/api/v1/devices/discover')).json() as { devices: DeviceDto[] };
    device = discovered.devices.find((d) => d.sku === 'H805C')!;
    basic = discovered.devices.find((d) => d.sku === 'H6001')!;
    h.clock.set('2026-06-15T12:00:00Z');
  });

  afterEach(() => h.close());

  async function createSchedule(overrides: Partial<ScheduleCreate> = {}): Promise<ScheduleDto> {
    const response = await client.post('/api/v1/schedules', {
      name: 'Evening on',
      timeZone: 'UTC',
      recurrence: { kind: 'daily', time: '18:00' },
      target: { type: 'device', deviceId: device.id },
      action: { type: 'power', on: true },
      ...overrides,
    });
    expect(response.statusCode, response.body).toBe(201);
    return response.json() as ScheduleDto;
  }

  const executions = (id: string) => h.ctx.schedules.executions(id, 100);
  const controls = () => h.mock.controlRequests();

  async function tick(): Promise<void> {
    await h.ctx.scheduler.tick();
    await h.ctx.scheduler.idle();
    await h.ctx.queue.idle();
  }

  describe('one-time schedules', () => {
    it('runs once at the set time, then has no next run', async () => {
      const schedule = await createSchedule({ recurrence: { kind: 'once', date: '2026-06-15', time: '13:00' } });
      expect(schedule.nextRun?.at).toBe('2026-06-15T13:00:00.000Z');

      await tick();
      expect(controls()).toHaveLength(0);

      h.clock.set('2026-06-15T13:00:05Z');
      await tick();
      expect(controls()).toHaveLength(1);
      expect(controls()[0]?.capability).toMatchObject({ instance: 'powerSwitch', value: 1 });

      const [execution] = executions(schedule.id);
      expect(execution).toMatchObject({ status: 'all_accepted', isRecovery: false });
      expect(h.ctx.schedules.get(schedule.id).nextRun).toBeNull();

      h.clock.set('2026-06-16T13:00:05Z');
      await tick();
      expect(controls()).toHaveLength(1);
    });

    it('refuses a time that has already passed', async () => {
      const response = await client.post('/api/v1/schedules', {
        name: 'Too late',
        timeZone: 'UTC',
        recurrence: { kind: 'once', date: '2026-06-15', time: '11:00' },
        target: { type: 'device', deviceId: device.id },
        action: { type: 'power', on: true },
      });
      expect(response.statusCode).toBe(422);
      expect(response.json().error.code).toBe('schedule_never_runs');
    });
  });

  describe('recurring schedules', () => {
    it('runs each day and moves its next run forward', async () => {
      const schedule = await createSchedule();
      h.clock.set('2026-06-15T18:00:01Z');
      await tick();
      expect(controls()).toHaveLength(1);
      expect(h.ctx.schedules.get(schedule.id).nextRun?.at).toBe('2026-06-16T18:00:00.000Z');

      h.clock.set('2026-06-16T18:00:01Z');
      await tick();
      expect(controls()).toHaveLength(2);
      expect(executions(schedule.id).map((e) => e.occurrenceKey)).toEqual(['2026-06-16T18:00', '2026-06-15T18:00']);
    });

    it('does nothing while disabled, and treats that time as not missed', async () => {
      const schedule = await createSchedule();
      await client.post(`/api/v1/schedules/${schedule.id}/disable`);
      h.clock.set('2026-06-20T18:00:01Z');
      await tick();
      expect(controls()).toHaveLength(0);

      h.clock.set('2026-06-21T12:00:00Z');
      const enabled = (await client.post(`/api/v1/schedules/${schedule.id}/enable`)).json() as ScheduleDto;
      expect(enabled.nextRun?.at).toBe('2026-06-21T18:00:00.000Z');
      await tick();
      expect(executions(schedule.id)).toEqual([]);
    });

    it('evaluates wall-clock time in the schedule zone', async () => {
      const schedule = await createSchedule({ timeZone: 'America/New_York' });
      expect(schedule.nextRun?.at).toBe('2026-06-15T22:00:00.000Z');
      expect(schedule.nextRun?.local).toContain('18:00');
      h.clock.set('2026-06-15T18:00:01Z');
      await tick();
      expect(controls()).toHaveLength(0);
      h.clock.set('2026-06-15T22:00:01Z');
      await tick();
      expect(controls()).toHaveLength(1);
    });

    it('runs once through a fall-back day and at the moved time on a spring-forward day', async () => {
      // Through the service: these dates are past the test login session's expiry.
      h.clock.set('2026-10-31T12:00:00Z');
      const fall = h.ctx.schedules.create({
        name: 'Fall',
        enabled: true,
        timeZone: 'America/New_York',
        recurrence: { kind: 'daily', time: '01:30' },
        target: { type: 'device', deviceId: device.id },
        action: { type: 'power', on: true },
        missedRunPolicy: 'skip',
      });
      h.clock.set('2026-11-01T05:30:10Z');
      await tick();
      h.clock.set('2026-11-01T06:30:10Z'); // The second 01:30.
      await tick();
      expect(executions(fall.id).filter((e) => e.occurrenceKey === '2026-11-01T01:30')).toHaveLength(1);
      expect(controls()).toHaveLength(1);

      h.clock.set('2027-03-13T12:00:00Z');
      const spring = h.ctx.schedules.create({
        name: 'Spring',
        enabled: true,
        timeZone: 'America/New_York',
        recurrence: { kind: 'daily', time: '02:30' },
        target: { type: 'device', deviceId: device.id },
        action: { type: 'power', on: true },
        missedRunPolicy: 'skip',
      });
      expect(spring.nextRun?.note).toBe('dst_gap_moved_forward');
      expect(spring.nextRun?.local).toContain('03:30');
      expect(spring.nextRun?.at).toBe('2027-03-14T07:30:00.000Z');
    });
  });

  describe('duplicate prevention', () => {
    it('runs nothing twice across repeated ticks', async () => {
      const schedule = await createSchedule();
      h.clock.set('2026-06-15T18:00:01Z');
      await tick();
      await tick();
      await tick();
      expect(controls()).toHaveLength(1);
      expect(executions(schedule.id)).toHaveLength(1);
    });

    it('cannot run a claimed occurrence again even if schedule state goes backwards', async () => {
      const schedule = await createSchedule();
      h.clock.set('2026-06-15T18:00:01Z');
      await tick();
      expect(controls()).toHaveLength(1);

      // As if a restored backup, or a crash before the schedule row moved on, rewound it.
      h.ctx.db
        .prepare('UPDATE schedules SET last_evaluated_at = ?, next_run_at = ? WHERE id = ?')
        .run('2026-06-15T12:00:00.000Z', '2026-06-15T18:00:00.000Z', schedule.id);
      await tick();

      expect(controls()).toHaveLength(1);
      expect(executions(schedule.id)).toHaveLength(1);
    });

    it('keeps the guard when a second scheduler shares the database', async () => {
      await createSchedule();
      const { db, devices, groups, presets, actions, activity, logger, clock, config } = h.ctx;
      const second = new Scheduler(db, devices.repository, groups, presets, actions, activity, logger, clock, config.scheduler);
      h.clock.set('2026-06-15T18:00:01Z');
      await Promise.all([h.ctx.scheduler.tick(), second.tick()]);
      await Promise.all([h.ctx.scheduler.idle(), second.idle()]);
      await h.ctx.queue.idle();
      expect(controls()).toHaveLength(1);
    });
  });

  describe('restart recovery', () => {
    it('finds due work from the database with a fresh scheduler', async () => {
      const schedule = await createSchedule();
      const { db, devices, groups, presets, actions, activity, logger, clock, config } = h.ctx;
      h.clock.set('2026-06-15T18:00:30Z');
      // A new instance, as after a restart: everything it knows comes from SQLite.
      const restarted = new Scheduler(db, devices.repository, groups, presets, actions, activity, logger, clock, config.scheduler);
      await restarted.tick();
      await restarted.idle();
      await h.ctx.queue.idle();
      expect(controls()).toHaveLength(1);
      expect(executions(schedule.id)[0]?.status).toBe('all_accepted');
    });

    it('marks a run that was in progress as interrupted and does not repeat it', async () => {
      const schedule = await createSchedule();
      h.ctx.db
        .prepare(
          `INSERT INTO schedule_executions (id, schedule_id, occurrence_key, scheduled_for, started_at, status, created_at)
           VALUES ('stuck', ?, '2026-06-15T18:00', '2026-06-15T18:00:00.000Z', ?, 'running', ?)`,
        )
        .run(schedule.id, h.clock.nowIso(), h.clock.nowIso());

      expect(h.ctx.scheduler.recoverInterrupted()).toBe(1);
      h.clock.set('2026-06-15T18:00:30Z');
      await tick();

      const rows = executions(schedule.id);
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ id: 'stuck', status: 'interrupted' });
      expect(rows[0]?.errorSummary).toContain('not repeated');
      expect(controls()).toHaveLength(0);
    });
  });

  describe('missed-run policy', () => {
    it('within the grace period, a late run still counts as on time', async () => {
      const schedule = await createSchedule();
      h.clock.set('2026-06-15T18:01:30Z'); // 90 s late, grace is 120 s.
      await tick();
      expect(executions(schedule.id)[0]).toMatchObject({ status: 'all_accepted', isRecovery: false });
    });

    it('"skip" records missed runs and sends nothing', async () => {
      const schedule = await createSchedule({ missedRunPolicy: 'skip' });
      h.clock.set('2026-06-18T12:00:00Z'); // Down for three evening runs.
      await tick();

      expect(controls()).toHaveLength(0);
      const rows = executions(schedule.id);
      expect(rows.map((e) => e.occurrenceKey)).toEqual(['2026-06-17T18:00', '2026-06-16T18:00', '2026-06-15T18:00']);
      expect(rows.every((e) => e.status === 'missed')).toBe(true);

      const events = h.ctx.activity.list({ eventType: 'schedule', outcome: 'warning', limit: 10 }).events;
      expect(events[0]?.message).toContain('3 missed run(s)');
      expect(h.ctx.schedules.get(schedule.id).nextRun?.at).toBe('2026-06-18T18:00:00.000Z');
    });

    it('"run_latest" records older runs as missed and runs only the newest', async () => {
      const schedule = await createSchedule({ missedRunPolicy: 'run_latest' });
      h.clock.set('2026-06-17T20:00:00Z'); // Newest occurrence is 2 hours old.
      await tick();

      expect(controls()).toHaveLength(1);
      const rows = executions(schedule.id);
      expect(rows[0]).toMatchObject({ occurrenceKey: '2026-06-17T18:00', status: 'all_accepted', isRecovery: true });
      expect(rows.slice(1).every((e) => e.status === 'missed')).toBe(true);
      expect(rows).toHaveLength(3);
    });

    it('"run_latest" does not recover a run older than the catch-up limit', async () => {
      const schedule = await createSchedule({ missedRunPolicy: 'run_latest' });
      h.clock.set('2026-06-16T17:00:00Z'); // 23 hours late, limit is 12.
      await tick();
      expect(controls()).toHaveLength(0);
      expect(executions(schedule.id)[0]?.status).toBe('missed');
    });

    it('caps how many missed runs it itemizes after a long outage', async () => {
      const schedule = await createSchedule();
      h.clock.set('2027-06-15T12:00:00Z');
      await tick();
      expect(executions(schedule.id)).toHaveLength(100);
      const [event] = h.ctx.activity.list({ eventType: 'schedule', outcome: 'warning', limit: 1 }).events;
      expect(event?.message).toContain('older ones not itemized');
    });
  });

  describe('targets and actions', () => {
    it('reports per-device results for a group, including unsupported actions', async () => {
      const group = (
        await client.post('/api/v1/groups', { name: 'All', deviceIds: [device.id, basic.id] })
      ).json() as GroupDto;
      const preset = (
        await client.post('/api/v1/presets', {
          name: 'Warm',
          actions: [
            { deviceId: null, action: { type: 'power', on: true } },
            { deviceId: null, action: { type: 'color', hex: '#ff8800' } },
          ],
        })
      ).json() as PresetDto;

      const schedule = await createSchedule({
        target: { type: 'group', groupId: group.id },
        action: { type: 'preset', presetId: preset.id },
      });
      h.clock.set('2026-06-15T18:00:01Z');
      await tick();

      const [execution] = executions(schedule.id);
      expect(execution?.status).toBe('partial');
      expect(execution?.errorSummary).toContain('does not report RGB colour');
      // The full device got power and colour. The basic one got power only.
      expect(controls().map((c) => c.capability.instance).sort()).toEqual(['colorRgb', 'powerSwitch', 'powerSwitch']);
    });

    it('records a failure when the target vanishes after the schedule was made', async () => {
      const group = (await client.post('/api/v1/groups', { name: 'Temp', deviceIds: [device.id] })).json() as GroupDto;
      const schedule = await createSchedule({ target: { type: 'group', groupId: group.id } });
      h.ctx.db.prepare('DELETE FROM groups WHERE id = ?').run(group.id);
      h.clock.set('2026-06-15T18:00:01Z');
      await tick();
      expect(executions(schedule.id)[0]).toMatchObject({ status: 'failed' });
      expect(executions(schedule.id)[0]?.errorSummary).toContain('no longer exists');
    });

    it('records a failed run honestly when Govee is unreachable', async () => {
      const schedule = await createSchedule();
      h.mock.intercept = (_request, res) => {
        res.writeHead(500);
        res.end();
        return true;
      };
      h.clock.set('2026-06-15T18:00:01Z');
      await tick();
      expect(executions(schedule.id)[0]).toMatchObject({ status: 'failed' });
      const failures = h.ctx.activity.list({ eventType: 'command', outcome: 'failure', limit: 10 }).events;
      expect(failures).toHaveLength(1);
    });

    it('stops one bad schedule from blocking the rest', async () => {
      const broken = await createSchedule({ name: 'Broken' });
      const good = await createSchedule({ name: 'Good' });
      h.ctx.db.prepare(`UPDATE schedules SET recurrence_json = '{not json' WHERE id = ?`).run(broken.id);
      h.clock.set('2026-06-15T18:00:01Z');
      await h.ctx.scheduler.tick();
      await h.ctx.scheduler.idle();
      await h.ctx.queue.idle();
      expect(executions(good.id)).toHaveLength(1);
      expect(controls()).toHaveLength(1);
      h.ctx.db.prepare('DELETE FROM schedules WHERE id = ?').run(broken.id);
    });
  });

  describe('editing', () => {
    it('recomputes the next run and does not count old-time runs as missed', async () => {
      const schedule = await createSchedule();
      h.clock.set('2026-06-16T12:00:00Z');
      const updated = (
        await client.patch(`/api/v1/schedules/${schedule.id}`, { recurrence: { kind: 'daily', time: '13:00' } })
      ).json() as ScheduleDto;
      expect(updated.nextRun?.at).toBe('2026-06-16T13:00:00.000Z');
      h.clock.set('2026-06-16T13:00:01Z');
      await tick();
      const rows = executions(schedule.id);
      expect(rows).toHaveLength(1);
      expect(rows[0]?.status).toBe('all_accepted');
    });

    it('rejects an invalid time zone', async () => {
      const response = await client.post('/api/v1/schedules', {
        name: 'Bad zone',
        timeZone: 'Mars/Olympus',
        recurrence: { kind: 'daily', time: '18:00' },
        target: { type: 'device', deviceId: device.id },
        action: { type: 'power', on: true },
      });
      expect(response.statusCode).toBe(400);
      expect(response.json().error.message).toContain('IANA');
    });

    it('rejects an end date before the start date', async () => {
      const response = await client.post('/api/v1/schedules/preview', {
        timeZone: 'UTC',
        recurrence: { kind: 'daily', time: '18:00', startDate: '2026-07-02', endDate: '2026-07-01' },
      });
      expect(response.statusCode).toBe(400);
      expect(response.json().error.message).toContain('before the start date');
    });

    it('previews upcoming runs without creating anything', async () => {
      const response = await client.post('/api/v1/schedules/preview', {
        timeZone: 'UTC',
        recurrence: { kind: 'weekly', time: '09:00', weekdays: [1] },
        count: 2,
      });
      expect(response.statusCode).toBe(200);
      expect(response.json().nextRuns.map((r: { at: string }) => r.at)).toEqual([
        '2026-06-22T09:00:00.000Z',
        '2026-06-29T09:00:00.000Z',
      ]);
      expect(h.ctx.schedules.list()).toEqual([]);
    });

    it('blocks deleting a group or preset that a schedule uses', async () => {
      const group = (await client.post('/api/v1/groups', { name: 'G', deviceIds: [device.id] })).json() as GroupDto;
      const preset = (
        await client.post('/api/v1/presets', {
          name: 'P',
          actions: [{ deviceId: null, action: { type: 'power', on: true } }],
        })
      ).json() as PresetDto;
      await createSchedule({ target: { type: 'group', groupId: group.id }, action: { type: 'preset', presetId: preset.id } });

      const deleteGroup = await client.delete(`/api/v1/groups/${group.id}`);
      expect(deleteGroup.statusCode).toBe(409);
      expect(deleteGroup.json().error.code).toBe('group_in_use');
      const deletePreset = await client.delete(`/api/v1/presets/${preset.id}`);
      expect(deletePreset.statusCode).toBe(409);
      expect(deletePreset.json().error.code).toBe('preset_in_use');
    });
  });
});
