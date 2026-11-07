import type { NormalizedCapability, SceneDto, SceneKind } from '@glm/shared';
import type { Db } from '../database/database.js';
import { parseSceneOptions, type ParsedSceneOption } from '../govee/capabilities.js';
import type { RawCapability } from '../govee/transport.js';

export type SceneSource = 'device_list' | 'scenes_endpoint' | 'diy_endpoint';

export interface StoredScene {
  key: string;
  name: string;
  kind: SceneKind;
  capabilityType: string;
  instance: string;
  value: ParsedSceneOption['value'];
  fetchedAt: string;
}

interface SceneRow {
  device_id: string;
  scene_key: string;
  name: string;
  kind: SceneKind;
  capability_type: string;
  instance: string;
  value_json: string;
  source: SceneSource;
  fetched_at: string;
}

function toStored(row: SceneRow): StoredScene {
  return {
    key: row.scene_key,
    name: row.name,
    kind: row.kind,
    capabilityType: row.capability_type,
    instance: row.instance,
    value: JSON.parse(row.value_json),
    fetchedAt: row.fetched_at,
  };
}

export function sceneToDto(scene: StoredScene): SceneDto {
  return {
    key: scene.key,
    name: scene.name,
    kind: scene.kind,
    instance: scene.instance,
    fetchedAt: scene.fetchedAt,
  };
}

export class SceneStore {
  constructor(private readonly db: Db) {}

  list(deviceId: string): StoredScene[] {
    const rows = this.db
      .prepare('SELECT * FROM device_scenes WHERE device_id = ? ORDER BY kind, name COLLATE NOCASE')
      .all(deviceId) as SceneRow[];
    return rows.map(toStored);
  }

  find(deviceId: string, key: string): StoredScene | null {
    const row = this.db
      .prepare('SELECT * FROM device_scenes WHERE device_id = ? AND scene_key = ?')
      .get(deviceId, key) as SceneRow | undefined;
    return row ? toStored(row) : null;
  }

  /** Replaces one source's scenes for a device. Other sources' rows stay as they are. */
  replace(
    deviceId: string,
    source: SceneSource,
    scenes: { option: ParsedSceneOption; kind: SceneKind; capabilityType: string; instance: string }[],
    fetchedAt: string,
  ): void {
    const del = this.db.prepare('DELETE FROM device_scenes WHERE device_id = ? AND source = ?');
    const insert = this.db.prepare(
      `INSERT OR REPLACE INTO device_scenes
         (device_id, scene_key, name, kind, capability_type, instance, value_json, source, fetched_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    this.db.transaction(() => {
      del.run(deviceId, source);
      for (const scene of scenes) {
        insert.run(
          deviceId,
          scene.option.key,
          scene.option.name,
          scene.kind,
          scene.capabilityType,
          scene.instance,
          JSON.stringify(scene.option.value),
          source,
          fetchedAt,
        );
      }
    })();
  }

  /** Scenes listed inline in the device-list response. */
  syncFromDeviceList(
    deviceId: string,
    raw: RawCapability[],
    normalized: NormalizedCapability[],
    fetchedAt: string,
  ): void {
    const scenes: { option: ParsedSceneOption; kind: SceneKind; capabilityType: string; instance: string }[] = [];
    for (const capability of normalized) {
      if (capability.kind !== 'scene') continue;
      const source = raw.find((r) => r.type === capability.type && r.instance === capability.instance);
      for (const option of parseSceneOptions(capability.sceneKind, source?.parameters)) {
        scenes.push({
          option,
          kind: capability.sceneKind,
          capabilityType: capability.type,
          instance: capability.instance,
        });
      }
    }
    this.replace(deviceId, 'device_list', scenes, fetchedAt);
  }
}
