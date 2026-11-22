import crypto from 'node:crypto';
import { afterEach, describe, expect, it } from 'vitest';
import { BUILTIN_PRESETS, MEMBER_LIMITS, SHARE_LIMITS, type ImportPreviewDto, type PresetDto, type ScheduleDto, type SharedItemDto, type SharedListDto } from '@glm/shared';
import { fitSegments } from '../src/sharing/importer.js';
import { mockFullDevice } from './support/mock-govee.js';
import { MEMBER_PASSWORD, membersHarness, type MembersHarness } from './support/members.js';

/*
 * The Shared space: display names, sharing, the owner's moderation, and importing into a
 * person's own account. The owner's lights come from the local Govee mock; a member's lights
 * are copies of those rows written into the member's own file, with the model and number of
 * segments changed where a test needs it. Nothing here contacts Govee.
 */

const OWNER_PLACE = { latitude: 51.4778, longitude: -0.0015 };
const MEMBER_PLACE = { latitude: 34.0522, longitude: -118.2437 };

let m: MembersHarness;
afterEach(async () => {
  await m?.close();
});

async function start() {
  m = await membersHarness();
  m.h.mock.devices = [mockFullDevice()];
  expect((await m.owner.post('/api/v1/devices/discover')).statusCode).toBe(200);
  const light = ownerDb().prepare('SELECT id FROM devices LIMIT 1').get() as { id: string };
  expect((await m.owner.post(`/api/v1/devices/${light.id}/scenes/refresh`)).statusCode).toBe(200);
  return m;
}

const ownerDb = () => m.h.platform.accounts.forUser(1)!.db;
const ownerLight = () => ownerDb().prepare('SELECT * FROM devices LIMIT 1').get() as Record<string, unknown> & { id: string; name: string; govee_device_id: string };

/** Writes lights into a member's own file, copied from the owner's discovered one. */
function giveLights(userId: number, specs: { name: string; sku?: string; segments?: number; scenes?: boolean }[]): string[] {
  const template = ownerLight();
  const scenes = ownerDb().prepare('SELECT * FROM device_scenes WHERE device_id = ?').all(template.id) as Record<string, unknown>[];
  const db = m.h.platform.accounts.forUser(userId)!.db;
  return specs.map((spec, i) => {
    const caps = JSON.parse(String(template.capabilities_json)) as { instance: string; parameters: { fields?: { fieldName: string; elementRange?: { max: number }; size?: { max: number } }[] } }[];
    if (spec.segments !== undefined) {
      for (const cap of caps) {
        for (const field of cap.parameters.fields ?? []) {
          if (field.fieldName === 'segment' && field.elementRange && field.size) {
            field.elementRange.max = spec.segments - 1;
            field.size.max = spec.segments;
          }
        }
      }
    }
    const row = { ...template, id: crypto.randomUUID(), govee_device_id: `11:22:33:44:55:${String(i).padStart(2, '0')}`, name: spec.name, sku: spec.sku ?? String(template.sku), capabilities_json: JSON.stringify(caps) };
    const columns = Object.keys(row);
    db.prepare(`INSERT INTO devices (${columns.join(',')}) VALUES (${columns.map(() => '?').join(',')})`).run(...columns.map((c) => (row as Record<string, unknown>)[c]));
    if (spec.scenes !== false) {
      for (const scene of scenes) {
        const copy = { ...scene, device_id: row.id };
        const cols = Object.keys(copy);
        db.prepare(`INSERT INTO device_scenes (${cols.join(',')}) VALUES (${cols.map(() => '?').join(',')})`).run(...cols.map((c) => (copy as Record<string, unknown>)[c]));
      }
    }
    return row.id;
  });
}

/** The owner's designs: a group, a pattern, a scene preset, a sunset schedule and a daily one. */
async function ownerDesigns() {
  const light = ownerLight();
  await m.owner.patch('/api/v1/settings', { ...OWNER_PLACE, defaultTimeZone: 'Europe/London' });
  const scene = ownerDb().prepare("SELECT scene_key, name FROM device_scenes WHERE device_id = ? AND kind = 'dynamic' LIMIT 1").get(light.id) as { scene_key: string; name: string };
  const group = (await m.owner.post('/api/v1/groups', { name: 'Front of house', deviceIds: [light.id] })).json();
  const pattern = (
    await m.owner.post('/api/v1/presets', {
      name: 'Red and blue',
      description: 'Half and half',
      actions: [
        { deviceId: light.id, action: { type: 'segmentColor', segments: [0, 1, 2, 3, 4, 5, 6], hex: '#ff0000' } },
        { deviceId: light.id, action: { type: 'segmentColor', segments: [7, 8, 9, 10, 11, 12, 13, 14], hex: '#0000ff' } },
      ],
    })
  ).json() as PresetDto;
  const scenePreset = (
    await m.owner.post('/api/v1/presets', { name: 'Party', actions: [{ deviceId: light.id, action: { type: 'scene', sceneKey: scene.scene_key, sceneName: scene.name } }] })
  ).json() as PresetDto;
  const sunset = (
    await m.owner.post('/api/v1/schedules', {
      name: 'Evening pattern',
      timeZone: 'Europe/London',
      recurrence: { kind: 'solar', event: 'sunset', offsetMinutes: 0, ...OWNER_PLACE },
      target: { type: 'group', groupId: group.id },
      action: { type: 'preset', presetId: pattern.id },
      missedRunPolicy: 'skip',
    })
  ).json() as ScheduleDto;
  const morning = (
    await m.owner.post('/api/v1/schedules', {
      name: 'Morning off',
      timeZone: 'Europe/London',
      recurrence: { kind: 'daily', time: '07:00' },
      target: { type: 'device', deviceId: light.id },
      action: { type: 'power', on: false },
      missedRunPolicy: 'skip',
    })
  ).json() as ScheduleDto;
  for (const made of [group, pattern, scenePreset, sunset, morning]) expect(made.id).toBeTruthy();
  return { light, group, pattern, scenePreset, scene, sunset, morning };
}

const ownerShare = (body: object) => m.owner.post('/api/v1/shared', body);
const counts = (userId: number) => {
  const db = m.h.platform.accounts.forUser(userId)!.db;
  const one = (sql: string) => (db.prepare(sql).get() as { n: number }).n;
  return {
    presets: one('SELECT COUNT(*) AS n FROM presets WHERE builtin_key IS NULL'),
    groups: one('SELECT COUNT(*) AS n FROM groups'),
    schedules: one('SELECT COUNT(*) AS n FROM schedules WHERE builtin_show IS NULL'),
  };
};

async function memberWithLights(email: string, lights: Parameters<typeof giveLights>[1], place = true) {
  const member = await m.member(email);
  const userId = (m.h.platform.control.prepare('SELECT id FROM users WHERE email = ?').get(email) as { id: number }).id;
  const ids = giveLights(userId, lights);
  await member.patch('/settings', { defaultTimeZone: 'America/Los_Angeles', ...(place ? MEMBER_PLACE : {}) });
  return { member, userId, ids };
}


describe('fitting a pattern onto a light with a different number of segments', () => {
  const range = (n: number) => Array.from({ length: n }, (_, i) => i);

  it('keeps the same segments when the counts match', () => {
    expect(fitSegments([0, 1, 2], range(15), range(15))).toEqual([0, 1, 2]);
  });

  it('scales by position, from 27 to 20 and from 27 to 54', () => {
    const firstHalf = range(14); // 0..13 of 27
    const down = fitSegments(firstHalf, range(27), range(20));
    expect(down[0]).toBe(0);
    expect(down.length).toBeGreaterThanOrEqual(10);
    expect(down.length).toBeLessThanOrEqual(11);
    expect(Math.max(...down)).toBeLessThan(11);
    const up = fitSegments(firstHalf, range(27), range(54));
    expect(up).toEqual(range(28));
  });

  it('follows the light\'s own segment numbers, and gives nothing for a light without segments', () => {
    expect(fitSegments([1, 2], [1, 2, 3, 4], [10, 11, 12, 13])).toEqual([10, 11]);
    expect(fitSegments([0], range(15), [])).toEqual([]);
  });
});

describe('sharing', () => {
  it('shares a snapshot that holds no ids, light names, place, time zone or email', async () => {
    await start();
    const { sunset, light } = await ownerDesigns();
    const shared = await ownerShare({ kind: 'schedule', sourceId: sunset.id });
    expect(shared.statusCode).toBe(201);
    const item = shared.json() as SharedItemDto;
    expect(item).toMatchObject({ kind: 'schedule', title: 'Evening pattern', by: 'Light Manager', official: true, counts: { presets: 1, groups: 1, schedules: 1 } });
    expect(item.colors).toEqual(['#ff0000', '#0000ff']);
    expect(item.slots).toEqual([{ key: expect.stringMatching(/^[a-f0-9]{12}$/), label: `Light 1 (${String(light.sku)})`, sku: String(light.sku), segmentCount: 15 }]);
    expect(item.sourceId).toBe(sunset.id);

    const stored = m.h.platform.control.prepare('SELECT bundle_json FROM shared_items').get() as { bundle_json: string };
    for (const secret of [light.id, light.govee_device_id, light.name, String(OWNER_PLACE.latitude), String(OWNER_PLACE.longitude), 'Europe/London', 'owner', sunset.id]) {
      expect(stored.bundle_json).not.toContain(secret);
    }
    const bundle = JSON.parse(stored.bundle_json);
    expect(bundle.schedules[0].recurrence).toEqual({ kind: 'solar', event: 'sunset', offsetMinutes: 0 });
    // What other people are sent holds no source id either.
    const member = await m.member('viewer@example.com');
    const list = (await member.get('/shared')).body;
    expect(list).not.toContain(sunset.id);
    expect(list).not.toContain(light.id);
  });

  it('asks members for a display name first, keeps names unique, and keeps "Light Manager" for the owner', async () => {
    await start();
    const member = await m.member('maker@example.com');
    const preset = (await member.post('/presets', { name: 'Warm', actions: [{ deviceId: null, action: { type: 'color', hex: '#ffaa00' } }] })).json() as PresetDto;
    const first = await member.post('/shared', { kind: 'preset', sourceId: preset.id });
    expect([first.statusCode, first.json().error.code]).toEqual([409, 'display_name_required']);
    expect((await member.put('/account/display-name', { displayName: 'Light Manager' })).json().error.code).toBe('display_name_taken');
    expect((await member.put('/account/display-name', { displayName: 'visit lights.com' })).statusCode).toBe(400);
    expect((await member.put('/account/display-name', { displayName: 'Maker Jo' })).statusCode).toBe(200);
    const other = await m.member('other@example.com');
    expect((await other.put('/account/display-name', { displayName: 'maker jo' })).json().error.code).toBe('display_name_taken');

    const shared = await member.post('/shared', { kind: 'preset', sourceId: preset.id });
    expect(shared.statusCode).toBe(201);
    expect(shared.json()).toMatchObject({ by: 'Maker Jo', official: false, mine: true });
    expect((await member.post('/shared', { kind: 'preset', sourceId: preset.id })).json().error.code).toBe('already_shared');
  });

  it('refuses links anywhere in what is shared, and built-in presets', async () => {
    await start();
    const { pattern } = await ownerDesigns();
    const link = await ownerShare({ kind: 'preset', sourceId: pattern.id, description: 'More at www.example.org' });
    expect([link.statusCode, link.json().error.code]).toEqual([422, 'share_has_link']);
    const named = (await m.owner.post('/api/v1/presets', { name: 'see lights.com', actions: [{ deviceId: null, action: { type: 'color', hex: '#ffffff' } }] })).json();
    expect((await ownerShare({ kind: 'preset', sourceId: named.id })).json().error.code).toBe('share_has_link');
    // A preset that comes with the app: everyone has it already.
    const plain = (await m.owner.post('/api/v1/presets', { name: 'Looks built in', actions: [{ deviceId: null, action: { type: 'color', hex: '#ffffff' } }] })).json();
    ownerDb().prepare('UPDATE presets SET builtin_key = ? WHERE id = ?').run(BUILTIN_PRESETS[0]!.key, plain.id);
    expect((await ownerShare({ kind: 'preset', sourceId: plain.id })).json().error.code).toBe('share_builtin');
  });

  it(`caps a member at ${SHARE_LIMITS.itemsPerMember} shared items, and not the owner`, async () => {
    await start();
    const member = await m.member('many@example.com');
    await member.put('/account/display-name', { displayName: 'Many Shares' });
    for (let i = 0; i <= SHARE_LIMITS.itemsPerMember; i++) {
      const preset = (await member.post('/presets', { name: `Colour ${i}`, actions: [{ deviceId: null, action: { type: 'color', hex: '#112233' } }] })).json() as PresetDto;
      const shared = await member.post('/shared', { kind: 'preset', sourceId: preset.id });
      if (i < SHARE_LIMITS.itemsPerMember) expect(shared.statusCode).toBe(201);
      else expect([shared.statusCode, shared.json().error.code]).toEqual([409, 'share_limit_reached']);
    }
    for (let i = 0; i <= SHARE_LIMITS.itemsPerMember; i++) {
      const preset = (await m.owner.post('/api/v1/presets', { name: `Owner ${i}`, actions: [{ deviceId: null, action: { type: 'color', hex: '#112233' } }] })).json() as PresetDto;
      expect((await ownerShare({ kind: 'preset', sourceId: preset.id })).statusCode).toBe(201);
    }
  });

  it('updates a share with a new snapshot, and stops sharing; only the sharer can', async () => {
    await start();
    const { pattern } = await ownerDesigns();
    const item = (await ownerShare({ kind: 'preset', sourceId: pattern.id })).json() as SharedItemDto;
    await m.owner.patch(`/api/v1/presets/${pattern.id}`, { actions: [{ deviceId: ownerLight().id, action: { type: 'color', hex: '#00ff00' } }] });
    const stale = (await m.owner.put(`/api/v1/shared/${item.id}`, { refresh: false, title: 'Renamed' })).json() as SharedItemDto;
    expect([stale.title, stale.colors]).toEqual(['Renamed', ['#ff0000', '#0000ff']]);
    const fresh = (await m.owner.put(`/api/v1/shared/${item.id}`, {})).json() as SharedItemDto;
    expect(fresh.colors).toEqual(['#00ff00']);

    const member = await m.member('nosy@example.com');
    expect((await member.put(`/shared/${item.id}`, { title: 'Mine now' })).statusCode).toBe(404);
    expect((await member.delete(`/shared/${item.id}`)).statusCode).toBe(404);
    expect((await m.owner.delete(`/api/v1/shared/${item.id}`)).statusCode).toBe(204);
    expect(((await member.get('/shared')).json() as SharedListDto).items).toEqual([]);
  });
});

describe('the owner\'s moderation', () => {
  it('hides and removes items, stops a person sharing, and resets a display name', async () => {
    await start();
    const maker = await m.member('maker@example.com');
    await maker.put('/account/display-name', { displayName: 'Rude Name' });
    const preset = (await maker.post('/presets', { name: 'Mine', actions: [{ deviceId: null, action: { type: 'color', hex: '#ff00ff' } }] })).json() as PresetDto;
    const item = (await maker.post('/shared', { kind: 'preset', sourceId: preset.id })).json() as SharedItemDto;
    const viewer = await m.member('viewer@example.com');
    expect(((await viewer.get('/shared')).json() as SharedListDto).items).toHaveLength(1);

    expect((await m.owner.patch(`/api/v1/admin/shared/${item.id}`, { hidden: true })).statusCode).toBe(200);
    expect(((await viewer.get('/shared')).json() as SharedListDto).items).toEqual([]);
    expect(((await maker.get('/shared')).json() as SharedListDto).items[0]).toMatchObject({ hidden: true, mine: true });
    expect((await viewer.post('/shared/import/preview', { itemIds: [item.id] })).statusCode).toBe(404);
    // Members cannot reach the owner's routes: to them they do not exist.
    expect((await viewer.get('/admin/shared')).statusCode).toBe(404);
    expect((await viewer.patch(`/admin/shared/${item.id}`, { hidden: false })).statusCode).toBe(404);

    expect((await m.owner.put('/api/v1/admin/accounts/2/sharing', { blocked: true })).statusCode).toBe(200);
    const other = (await maker.post('/presets', { name: 'Another', actions: [{ deviceId: null, action: { type: 'color', hex: '#00ffff' } }] })).json() as PresetDto;
    expect((await maker.post('/shared', { kind: 'preset', sourceId: other.id })).json().error.code).toBe('sharing_blocked');
    expect(((await maker.get('/shared')).json() as SharedListDto).canShare).toBe(false);

    const reset = await m.owner.delete('/api/v1/admin/accounts/2/display-name');
    expect(reset.json().accounts.find((a: { id: number }) => a.id === 2)).toMatchObject({ displayName: null, sharingBlocked: true });
    expect((await m.owner.delete(`/api/v1/admin/shared/${item.id}`)).json().items).toEqual([]);
  });
});

describe('importing', () => {
  it('suggests the same model first, imports independent copies onto the member\'s lights, with schedules off', async () => {
    await start();
    const designs = await ownerDesigns();
    const item = (await ownerShare({ kind: 'schedule', sourceId: designs.sunset.id })).json() as SharedItemDto;
    const { member, userId, ids } = await memberWithLights('importer@example.com', [
      // Another model with the same 15 segments, and the same model with 20: the model wins.
      { name: 'Porch', sku: 'H6199', segments: 15 },
      { name: 'Roof', segments: 20 },
    ]);
    const ownerBefore = counts(1);

    const preview = (await member.post('/shared/import/preview', { itemIds: [item.id] })).json() as ImportPreviewDto;
    expect(preview.slots).toHaveLength(1);
    expect(preview.slots[0]).toMatchObject({ segmentCount: 15, needsSegments: true, suggestion: ids[1] });
    expect(preview.devices.map((d) => d.segmentCount).sort()).toEqual([15, 20]);
    expect(preview.create).toEqual({ presets: 1, groups: 1, schedules: 1 });
    expect(preview.needsLocation).toBe(false);

    // Imported onto the suggested light, which has 20 segments where the original had 15.
    const slot = preview.slots[0]!.key;
    const done = await member.post('/shared/import', { itemIds: [item.id], slots: { [slot]: ids[1] } });
    expect(done.statusCode).toBe(200);
    expect(done.json().created).toEqual({ presets: 1, groups: 1, schedules: 1 });
    expect(counts(userId)).toEqual({ presets: 1, groups: 1, schedules: 1 });

    const schedules = (await member.get('/schedules')).json().schedules as ScheduleDto[];
    const schedule = schedules.find((s) => s.name === 'Evening pattern')!;
    expect(schedule).toMatchObject({ enabled: false, timeZone: 'America/Los_Angeles', importedFrom: 'Light Manager' });
    expect(schedule.recurrence).toMatchObject({ kind: 'solar', event: 'sunset', ...MEMBER_PLACE });
    const presets = (await member.get('/presets')).json().presets as PresetDto[];
    const copy = presets.find((p) => p.name === 'Red and blue')!;
    expect(copy.importedFrom).toBe('Light Manager');
    expect(copy.actions.every((a) => a.deviceId === ids[1])).toBe(true);
    const segmentsOf = (hex: string) => (copy.actions.find((a) => a.action.type === 'segmentColor' && a.action.hex === hex)!.action as { segments: number[] }).segments;
    // Red was 0..6 of 15 and blue 7..14: on 20 segments, red is 0..9 and blue 10..19.
    expect(segmentsOf('#ff0000')).toEqual(Array.from({ length: 10 }, (_, i) => i));
    expect(segmentsOf('#0000ff')).toEqual(Array.from({ length: 10 }, (_, i) => i + 10));
    const groups = (await member.get('/groups')).json().groups;
    expect(groups[0]).toMatchObject({ name: 'Front of house', deviceIds: [ids[1]], importedFrom: 'Light Manager' });

    // Independent: the owner's changes and deletes leave the copy alone, and the owner's account gained nothing.
    expect(counts(1)).toEqual(ownerBefore);
    await m.owner.patch(`/api/v1/presets/${designs.pattern.id}`, { name: 'Changed by owner' });
    await m.owner.delete(`/api/v1/schedules/${designs.sunset.id}`);
    expect(((await member.get('/presets')).json().presets as PresetDto[]).some((p) => p.name === 'Red and blue')).toBe(true);
    expect(((await member.get('/schedules')).json().schedules as ScheduleDto[])).toHaveLength(1);

    // The list says it was imported, and the share counts it.
    const listed = ((await member.get('/shared')).json() as SharedListDto).items[0]!;
    expect(listed).toMatchObject({ importedByMe: true, imports: 1 });
    expect(((await member.post('/shared/import/preview', { itemIds: [item.id] })).json() as ImportPreviewDto).alreadyImported).toEqual(['Evening pattern']);
  });

  it('asks for a scene when the matched light does not have it, and writes nothing until it is chosen', async () => {
    await start();
    const { scenePreset, scene } = await ownerDesigns();
    const item = (await ownerShare({ kind: 'preset', sourceId: scenePreset.id })).json() as SharedItemDto;
    const { member, userId, ids } = await memberWithLights('scenes@example.com', [{ name: 'Bare', scenes: false }, { name: 'Full' }]);
    const preview = (await member.post('/shared/import/preview', { itemIds: [item.id] })).json() as ImportPreviewDto;
    expect(preview.scenes).toEqual([expect.objectContaining({ sceneKey: scene.scene_key, portable: true })]);
    const slot = preview.slots[0]!.key;

    const refused = await member.post('/shared/import', { itemIds: [item.id], slots: { [slot]: ids[0] } });
    expect([refused.statusCode, refused.json().error.code]).toEqual([422, 'import_scene_needed']);
    expect(counts(userId)).toEqual({ presets: 0, groups: 0, schedules: 0 });

    // On a light that has the same scene, it copies as it is.
    expect((await member.post('/shared/import', { itemIds: [item.id], slots: { [slot]: ids[1] } })).statusCode).toBe(200);
    const copy = ((await member.get('/presets')).json().presets as PresetDto[]).find((p) => p.name === 'Party')!;
    expect(copy.actions[0]).toMatchObject({ deviceId: ids[1], action: { type: 'scene', sceneKey: scene.scene_key } });
  });

  it('never copies a DIY scene without a choice, even when the key exists', async () => {
    await start();
    const light = ownerLight();
    const diy = ownerDb().prepare("SELECT scene_key, name FROM device_scenes WHERE device_id = ? AND kind = 'diy' LIMIT 1").get(light.id) as { scene_key: string; name: string } | undefined;
    expect(diy, 'the mock light has a DIY scene').toBeDefined();
    const preset = (await m.owner.post('/api/v1/presets', { name: 'My DIY', actions: [{ deviceId: light.id, action: { type: 'scene', sceneKey: diy!.scene_key } }] })).json() as PresetDto;
    const item = (await ownerShare({ kind: 'preset', sourceId: preset.id })).json() as SharedItemDto;
    const { member, ids } = await memberWithLights('diy@example.com', [{ name: 'Same' }]);
    const preview = (await member.post('/shared/import/preview', { itemIds: [item.id] })).json() as ImportPreviewDto;
    expect(preview.scenes[0]).toMatchObject({ portable: false });
    const slot = preview.slots[0]!.key;
    expect((await member.post('/shared/import', { itemIds: [item.id], slots: { [slot]: ids[0] } })).json().error.code).toBe('import_scene_needed');
    const dynamic = ownerDb().prepare("SELECT scene_key FROM device_scenes WHERE device_id = ? AND kind = 'dynamic' LIMIT 1").get(light.id) as { scene_key: string };
    const chosen = await member.post('/shared/import', { itemIds: [item.id], slots: { [slot]: ids[0] }, scenes: { [preview.scenes[0]!.choiceKey]: dynamic.scene_key } });
    expect(chosen.statusCode).toBe(200);
  });

  it('needs the member\'s location for a sunset schedule, and writes nothing without it', async () => {
    await start();
    const { sunset } = await ownerDesigns();
    const item = (await ownerShare({ kind: 'schedule', sourceId: sunset.id })).json() as SharedItemDto;
    const { member, userId, ids } = await memberWithLights('noplace@example.com', [{ name: 'Light' }], false);
    const preview = (await member.post('/shared/import/preview', { itemIds: [item.id] })).json() as ImportPreviewDto;
    expect(preview.needsLocation).toBe(true);
    const refused = await member.post('/shared/import', { itemIds: [item.id], slots: { [preview.slots[0]!.key]: ids[0] } });
    expect(refused.json().error.code).toBe('import_location_needed');
    expect(counts(userId)).toEqual({ presets: 0, groups: 0, schedules: 0 });
  });

  it('refuses an import that would go over a member\'s caps, and writes nothing', async () => {
    await start();
    const { pattern } = await ownerDesigns();
    const item = (await ownerShare({ kind: 'preset', sourceId: pattern.id })).json() as SharedItemDto;
    const { member, userId, ids } = await memberWithLights('full@example.com', [{ name: 'Light' }]);
    const db = m.h.platform.accounts.forUser(userId)!.db;
    const now = new Date().toISOString();
    const insert = db.prepare('INSERT INTO presets (id, name, description, created_at, updated_at) VALUES (?, ?, ?, ?, ?)');
    for (let i = 0; i < MEMBER_LIMITS.presets; i++) insert.run(crypto.randomUUID(), `Filler ${i}`, '', now, now);
    const preview = (await member.post('/shared/import/preview', { itemIds: [item.id] })).json() as ImportPreviewDto;
    const refused = await member.post('/shared/import', { itemIds: [item.id], slots: { [preview.slots[0]!.key]: ids[0] } });
    expect([refused.statusCode, refused.json().error.code]).toEqual([409, 'account_limit_reached']);
    expect(counts(userId).presets).toBe(MEMBER_LIMITS.presets);
  });

  it('imports everything the owner shared, matching each light once and making each preset once', async () => {
    await start();
    await ownerDesigns();
    const all = await m.owner.post('/api/v1/shared/share-all');
    expect(all.json()).toEqual({ shared: 5, skipped: [] });
    const { member, userId, ids } = await memberWithLights('everything@example.com', [{ name: 'One' }]);
    const items = ((await member.get('/shared')).json() as SharedListDto).items;
    expect(items).toHaveLength(5);
    expect(items.every((i) => i.official)).toBe(true);
    const preview = (await member.post('/shared/import/preview', { itemIds: items.map((i) => i.id) })).json() as ImportPreviewDto;
    expect(preview.slots).toHaveLength(1);
    // The pattern is shared alone and inside the sunset schedule: it is made once.
    expect(preview.create).toEqual({ presets: 2, groups: 1, schedules: 2 });
    const done = await member.post('/shared/import', { itemIds: items.map((i) => i.id), slots: { [preview.slots[0]!.key]: ids[0] } });
    expect(done.statusCode).toBe(200);
    expect(counts(userId)).toEqual({ presets: 2, groups: 1, schedules: 2 });
    expect(((await member.get('/schedules')).json().schedules as ScheduleDto[]).every((s) => !s.enabled)).toBe(true);
    // Shared again: nothing new.
    expect((await m.owner.post('/api/v1/shared/share-all')).json()).toEqual({ shared: 0, skipped: [] });
  });
});

describe('the app\'s own group, and lights matched twice', () => {
  it('never shares the "All light strings" group, and points imports at the importer\'s own', async () => {
    await start();
    const { group, sunset } = await ownerDesigns();
    ownerDb().prepare("INSERT INTO builtin_installs (install_key, value, installed_at) VALUES ('group:all-strings', ?, ?)").run(group.id, new Date().toISOString());
    expect((await ownerShare({ kind: 'group', sourceId: group.id })).json().error.code).toBe('share_builtin');
    expect((await m.owner.post('/api/v1/shared/share-all')).json().skipped).toEqual([expect.objectContaining({ name: 'Front of house' })]);

    const { member, userId, ids } = await memberWithLights('own-group@example.com', [{ name: 'Mine' }]);
    const own = (await member.post('/groups', { name: 'All light strings', deviceIds: [ids[0]] })).json();
    m.h.platform.accounts.forUser(userId)!.db.prepare("INSERT INTO builtin_installs (install_key, value, installed_at) VALUES ('group:all-strings', ?, ?)").run(own.id, new Date().toISOString());
    const item = ((await member.get('/shared')).json() as SharedListDto).items.find((i) => i.title === sunset.name)!;
    const preview = (await member.post('/shared/import/preview', { itemIds: [item.id] })).json() as ImportPreviewDto;
    expect(preview.create.groups).toBe(0);
    expect((await member.post('/shared/import', { itemIds: [item.id], slots: { [preview.slots[0]!.key]: ids[0] } })).statusCode).toBe(200);
    expect(counts(userId).groups).toBe(1);
    const schedule = ((await member.get('/schedules')).json().schedules as ScheduleDto[]).find((s) => s.name === sunset.name)!;
    expect(schedule.target).toEqual({ type: 'group', groupId: own.id });
  });

  it('merges the same step when two of the sharer\'s lights go to one of yours', async () => {
    m = await membersHarness();
    m.h.mock.devices = [mockFullDevice(), { ...mockFullDevice(), device: 'AA:BB:CC:DD:EE:99', deviceName: 'Second string' }];
    await m.owner.post('/api/v1/devices/discover');
    const lights = ownerDb().prepare('SELECT id FROM devices ORDER BY id').all() as { id: string }[];
    expect(lights).toHaveLength(2);
    const both = lights.map((l) => ({ deviceId: l.id, action: { type: 'segmentColor', segments: [0, 1, 2], hex: '#ff0000' } }));
    const preset = (await m.owner.post('/api/v1/presets', { name: 'Both strings', actions: both })).json() as PresetDto;
    const item = (await ownerShare({ kind: 'preset', sourceId: preset.id })).json() as SharedItemDto;
    const { member, ids } = await memberWithLights('one-light@example.com', [{ name: 'Only one' }]);
    const preview = (await member.post('/shared/import/preview', { itemIds: [item.id] })).json() as ImportPreviewDto;
    expect(preview.slots).toHaveLength(2);
    const slots = Object.fromEntries(preview.slots.map((s) => [s.key, ids[0]!]));
    expect((await member.post('/shared/import', { itemIds: [item.id], slots })).statusCode).toBe(200);
    const copy = ((await member.get('/presets')).json().presets as PresetDto[]).find((p) => p.name === 'Both strings')!;
    expect(copy.actions).toHaveLength(1);
  });
});

describe('deleting and exporting', () => {
  it('removes a deleted member\'s shares, keeps copies others imported, and puts shares in the export', async () => {
    await start();
    const maker = await m.member('leaving@example.com');
    await maker.put('/account/display-name', { displayName: 'Leaving Soon' });
    const preset = (await maker.post('/presets', { name: 'Goodbye', actions: [{ deviceId: null, action: { type: 'color', hex: '#abcdef' } }] })).json() as PresetDto;
    const item = (await maker.post('/shared', { kind: 'preset', sourceId: preset.id })).json() as SharedItemDto;
    const exported = await maker.post('/account/export', { currentPassword: MEMBER_PASSWORD });
    expect(exported.json().sharedItems).toEqual([expect.objectContaining({ title: 'Goodbye', kind: 'preset', imports: 0 })]);

    const keeper = await m.member('keeper@example.com');
    const preview = (await keeper.post('/shared/import/preview', { itemIds: [item.id] })).json() as ImportPreviewDto;
    expect(preview.slots).toEqual([]);
    expect((await keeper.post('/shared/import', { itemIds: [item.id], slots: {} })).statusCode).toBe(200);

    expect((await maker.post('/account/delete', { currentPassword: MEMBER_PASSWORD, confirm: 'DELETE' })).statusCode).toBe(204);
    expect(m.h.platform.control.prepare('SELECT COUNT(*) AS n FROM shared_items').get()).toEqual({ n: 0 });
    const kept = ((await keeper.get('/presets')).json().presets as PresetDto[]).find((p) => p.name === 'Goodbye');
    expect(kept).toMatchObject({ importedFrom: 'Leaving Soon', needsTarget: true });
  });
});

