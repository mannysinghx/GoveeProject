import { ArrowDown, ArrowUp, Plus, Trash2 } from 'lucide-react';
import { useMemo, useState, type FormEvent } from 'react';
import { describeAction, type DeviceAction, type DeviceDto, type PresetDto } from '@glm/shared';
import { Button, Card, Dialog, ErrorNotice, Field, inputClass } from '../../components/ui';
import { useDevices, useSavePreset, useScenes } from '../../lib/queries';
import {
  ActionFields,
  actionTypeLabel,
  availableActionTypes,
  defaultAction,
  type ActionType,
} from './ActionFields';

interface DraftAction {
  key: number;
  deviceId: string | null;
  action: DeviceAction;
}

let nextKey = 1;

function ActionRow({
  draft,
  index,
  count,
  devices,
  onChange,
  onMove,
  onRemove,
}: {
  draft: DraftAction;
  index: number;
  count: number;
  devices: DeviceDto[];
  onChange: (draft: DraftAction) => void;
  onMove: (direction: -1 | 1) => void;
  onRemove: () => void;
}) {
  const device = devices.find((d) => d.id === draft.deviceId);
  const types = availableActionTypes(device);
  const scenes = useScenes(draft.deviceId ?? '', draft.action.type === 'scene' && Boolean(draft.deviceId));

  return (
    <Card className="space-y-3 bg-ink-850 p-3">
      <div className="flex items-center justify-between gap-2">
        <span className="text-sm font-medium">Step {index + 1}</span>
        <div className="flex gap-1">
          <Button size="sm" variant="ghost" aria-label={`Move step ${index + 1} up`} disabled={index === 0} icon={<ArrowUp className="size-4" aria-hidden />} onClick={() => onMove(-1)} />
          <Button size="sm" variant="ghost" aria-label={`Move step ${index + 1} down`} disabled={index === count - 1} icon={<ArrowDown className="size-4" aria-hidden />} onClick={() => onMove(1)} />
          <Button size="sm" variant="ghost" aria-label={`Remove step ${index + 1}`} icon={<Trash2 className="size-4" aria-hidden />} onClick={onRemove} />
        </div>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Device">
          {(props) => (
            <select
              {...props}
              className={inputClass}
              value={draft.deviceId ?? ''}
              onChange={(e) => {
                const deviceId = e.target.value || null;
                const nextDevice = devices.find((d) => d.id === deviceId);
                const nextTypes = availableActionTypes(nextDevice);
                const keepType = nextTypes.includes(draft.action.type);
                onChange({
                  ...draft,
                  deviceId,
                  action: keepType ? draft.action : defaultAction(nextTypes[0] ?? 'power', nextDevice),
                });
              }}
            >
              <option value="">Whichever device or group it is applied to</option>
              {devices.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </select>
          )}
        </Field>
        <Field label="Action">
          {(props) => (
            <select
              {...props}
              className={inputClass}
              value={draft.action.type}
              onChange={(e) => onChange({ ...draft, action: defaultAction(e.target.value as ActionType, device) })}
            >
              {types.map((type) => (
                <option key={type} value={type}>
                  {actionTypeLabel(type)}
                </option>
              ))}
            </select>
          )}
        </Field>
      </div>
      <ActionFields
        action={draft.action}
        device={device}
        scenes={scenes.data?.scenes}
        onChange={(action) => onChange({ ...draft, action })}
      />
    </Card>
  );
}

function Preview({ drafts, devices }: { drafts: DraftAction[]; devices: DeviceDto[] }) {
  return (
    <div className="rounded-lg border border-ink-700 p-3">
      <p className="text-sm font-medium">Preview</p>
      <ol className="mt-2 space-y-1.5 text-sm text-ink-300">
        {drafts.map((draft, index) => {
          const hex = 'hex' in draft.action ? draft.action.hex : null;
          const device = devices.find((d) => d.id === draft.deviceId);
          return (
            <li key={draft.key} className="flex items-center gap-2">
              <span className="tabular-nums text-ink-400">{index + 1}.</span>
              {hex ? <span aria-hidden className="size-3.5 rounded border border-ink-600" style={{ backgroundColor: hex }} /> : null}
              <span className="min-w-0 break-words">
                {describeAction(draft.action)} <span className="text-ink-400">· {device?.name ?? 'the chosen target'}</span>
              </span>
            </li>
          );
        })}
      </ol>
      <p className="mt-2 text-xs text-ink-400">
        Steps run in this order on each device. Devices are updated independently, not at the same instant. Steps a device
        cannot do are skipped and reported.
      </p>
    </div>
  );
}

export function PresetEditor({ preset, onClose }: { preset: PresetDto | null; onClose: () => void }) {
  const devices = useDevices();
  const save = useSavePreset();
  const [name, setName] = useState(preset?.name ?? '');
  const [description, setDescription] = useState(preset?.description ?? '');
  const [drafts, setDrafts] = useState<DraftAction[]>(() =>
    preset
      ? preset.actions.map((a) => ({ key: nextKey++, deviceId: a.deviceId, action: a.action }))
      : [{ key: nextKey++, deviceId: null, action: defaultAction('power', undefined) }],
  );
  const list = useMemo(() => devices.data ?? [], [devices.data]);

  const move = (index: number, direction: -1 | 1) => {
    setDrafts((current) => {
      const next = [...current];
      const [item] = next.splice(index, 1);
      if (item) next.splice(index + direction, 0, item);
      return next;
    });
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const actions = drafts.map((d) => ({ deviceId: d.deviceId, action: d.action }));
    if (preset) {
      save.mutate({ id: preset.id, update: { name, description, actions } }, { onSuccess: onClose });
    } else {
      save.mutate({ create: { name, description, actions } }, { onSuccess: onClose });
    }
  };

  return (
    <Dialog title={preset ? `Edit "${preset.name}"` : 'New preset'} open onClose={onClose} wide>
      <form onSubmit={submit} className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Name">
            {(props) => (
              <input {...props} className={inputClass} required maxLength={80} value={name} onChange={(e) => setName(e.target.value)} />
            )}
          </Field>
          <Field label="Description (optional)">
            {(props) => (
              <input {...props} className={inputClass} maxLength={500} value={description} onChange={(e) => setDescription(e.target.value)} />
            )}
          </Field>
        </div>

        <div className="space-y-3">
          {drafts.map((draft, index) => (
            <ActionRow
              key={draft.key}
              draft={draft}
              index={index}
              count={drafts.length}
              devices={list}
              onChange={(next) => setDrafts((current) => current.map((d) => (d.key === draft.key ? next : d)))}
              onMove={(direction) => move(index, direction)}
              onRemove={() => setDrafts((current) => current.filter((d) => d.key !== draft.key))}
            />
          ))}
          <Button
            icon={<Plus className="size-4" aria-hidden />}
            onClick={() =>
              setDrafts((current) => [...current, { key: nextKey++, deviceId: null, action: defaultAction('brightness', undefined) }])
            }
          >
            Add step
          </Button>
        </div>

        {drafts.length > 0 ? <Preview drafts={drafts} devices={list} /> : null}

        {save.isError ? <ErrorNotice error={save.error} title="The preset was not saved" /> : null}

        <div className="flex gap-2">
          <Button type="submit" variant="primary" busy={save.isPending} disabled={drafts.length === 0}>
            Save preset
          </Button>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
