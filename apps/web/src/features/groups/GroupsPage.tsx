import { Layers, Pencil, Play, Plus, Power, PowerOff, Trash2 } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import type { DeviceAction, DeviceDto, GroupDto, RunResultDto } from '@glm/shared';
import { RunResults } from '../../components/status';
import { Button, Card, Dialog, EmptyState, ErrorNotice, Field, inputClass, Loading, PageHeader } from '../../components/ui';
import {
  useApplyGroupAction,
  useApplyPreset,
  useDeleteGroup,
  useDevices,
  useGroups,
  usePresets,
  useSaveGroup,
} from '../../lib/queries';
import { ActionFields, actionTypeLabel, defaultAction, type ActionType } from '../presets/ActionFields';

function GroupEditor({ group, devices, onClose }: { group: GroupDto | null; devices: DeviceDto[]; onClose: () => void }) {
  const [name, setName] = useState(group?.name ?? '');
  const [members, setMembers] = useState<string[]>(group?.deviceIds ?? []);
  const save = useSaveGroup();

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (group) save.mutate({ id: group.id, update: { name, deviceIds: members } }, { onSuccess: onClose });
    else save.mutate({ create: { name, deviceIds: members } }, { onSuccess: onClose });
  };

  return (
    <Dialog title={group ? `Edit "${group.name}"` : 'New group'} open onClose={onClose}>
      <form onSubmit={submit} className="space-y-4">
        <Field label="Group name" hint="For example: Front of House, Backyard, Driveway.">
          {(props) => (
            <input {...props} className={inputClass} required maxLength={80} value={name} onChange={(e) => setName(e.target.value)} />
          )}
        </Field>
        <fieldset>
          <legend className="mb-2 text-sm font-medium text-ink-200">Devices</legend>
          {devices.length === 0 ? <p className="text-sm text-ink-300">No devices discovered yet.</p> : null}
          <ul className="space-y-1">
            {devices.map((device) => (
              <li key={device.id}>
                <label className="flex min-h-11 items-center gap-3 rounded-lg px-2 hover:bg-ink-850">
                  <input
                    type="checkbox"
                    className="size-4"
                    checked={members.includes(device.id)}
                    onChange={(e) =>
                      setMembers((current) =>
                        e.target.checked ? [...current, device.id] : current.filter((id) => id !== device.id),
                      )
                    }
                  />
                  <span className="min-w-0 flex-1 truncate text-sm">{device.name}</span>
                  <span className="text-xs text-ink-400">{device.sku}</span>
                </label>
              </li>
            ))}
          </ul>
        </fieldset>
        {save.isError ? <ErrorNotice error={save.error} title="The group was not saved" /> : null}
        <div className="flex gap-2">
          <Button type="submit" variant="primary" busy={save.isPending}>
            Save group
          </Button>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

const GROUP_ACTIONS: ActionType[] = ['power', 'brightness', 'color', 'colorTemperature'];

function ActionDialog({ group, onClose }: { group: GroupDto; onClose: () => void }) {
  const [mode, setMode] = useState<ActionType | 'preset'>('brightness');
  const [action, setAction] = useState<DeviceAction>(defaultAction('brightness', undefined));
  const [presetId, setPresetId] = useState('');
  const presets = usePresets();
  const applyAction = useApplyGroupAction();
  const applyPreset = useApplyPreset();
  const [run, setRun] = useState<RunResultDto | null>(null);
  const busy = applyAction.isPending || applyPreset.isPending;
  const error = applyAction.error ?? applyPreset.error;

  const submit = () => {
    setRun(null);
    if (mode === 'preset') {
      applyPreset.mutate({ id: presetId, target: { type: 'group', groupId: group.id } }, { onSuccess: setRun });
    } else {
      applyAction.mutate({ id: group.id, action }, { onSuccess: setRun });
    }
  };

  return (
    <Dialog title={`Apply to "${group.name}"`} open onClose={onClose}>
      <div className="space-y-4">
        <Field label="What to apply">
          {(props) => (
            <select
              {...props}
              className={inputClass}
              value={mode}
              onChange={(e) => {
                const next = e.target.value as ActionType | 'preset';
                setMode(next);
                if (next !== 'preset') setAction(defaultAction(next, undefined));
              }}
            >
              {GROUP_ACTIONS.map((type) => (
                <option key={type} value={type}>
                  {actionTypeLabel(type)}
                </option>
              ))}
              <option value="preset">An app preset</option>
            </select>
          )}
        </Field>

        {mode === 'preset' ? (
          <Field label="Preset">
            {(props) => (
              <select {...props} className={inputClass} value={presetId} onChange={(e) => setPresetId(e.target.value)}>
                <option value="">Choose a preset</option>
                {presets.data?.map((preset) => (
                  <option key={preset.id} value={preset.id}>
                    {preset.name}
                  </option>
                ))}
              </select>
            )}
          </Field>
        ) : (
          <ActionFields action={action} onChange={setAction} />
        )}

        <p className="text-xs text-ink-400">
          Each device is checked on its own. Devices that cannot do this are skipped with an explanation. Devices update
          independently, not at the same instant.
        </p>

        <Button variant="primary" busy={busy} disabled={mode === 'preset' && !presetId} onClick={submit}>
          Apply
        </Button>
        {error ? <ErrorNotice error={error} /> : null}
        {run ? <RunResults run={run} /> : null}
      </div>
    </Dialog>
  );
}

function GroupCard({
  group,
  devices,
  onEdit,
  onApply,
}: {
  group: GroupDto;
  devices: DeviceDto[];
  onEdit: () => void;
  onApply: () => void;
}) {
  const remove = useDeleteGroup();
  const apply = useApplyGroupAction();
  const [confirming, setConfirming] = useState(false);
  const members = group.deviceIds.map((id) => devices.find((d) => d.id === id)).filter((d): d is DeviceDto => Boolean(d));

  return (
    <Card className="flex flex-col gap-3 p-4">
      <h3 className="font-semibold">{group.name}</h3>
      {members.length === 0 ? (
        <p className="text-sm text-ink-300">No devices in this group.</p>
      ) : (
        <ul className="text-sm text-ink-300">
          {members.map((device) => (
            <li key={device.id}>
              {device.name}
              {device.discoveryStatus === 'missing' ? <span className="text-warn"> (no longer discovered)</span> : null}
            </li>
          ))}
        </ul>
      )}
      <div className="mt-auto grid grid-cols-2 gap-2 pt-1">
        <Button
          size="sm"
          icon={<Power className="size-4" aria-hidden />}
          disabled={apply.isPending || members.length === 0}
          aria-label={`Turn ${group.name} on`}
          onClick={() => apply.mutate({ id: group.id, action: { type: 'power', on: true } })}
        >
          On
        </Button>
        <Button
          size="sm"
          icon={<PowerOff className="size-4" aria-hidden />}
          disabled={apply.isPending || members.length === 0}
          aria-label={`Turn ${group.name} off`}
          onClick={() => apply.mutate({ id: group.id, action: { type: 'power', on: false } })}
        >
          Off
        </Button>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button size="sm" icon={<Play className="size-4" aria-hidden />} disabled={members.length === 0} onClick={onApply}>
          More actions
        </Button>
        <Button size="sm" icon={<Pencil className="size-4" aria-hidden />} onClick={onEdit}>
          Edit
        </Button>
        {confirming ? (
          <>
            <Button size="sm" variant="danger" busy={remove.isPending} onClick={() => remove.mutate(group.id)}>
              Confirm delete
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setConfirming(false)}>
              Keep
            </Button>
          </>
        ) : (
          <Button size="sm" variant="ghost" aria-label={`Delete ${group.name}`} icon={<Trash2 className="size-4" aria-hidden />} onClick={() => setConfirming(true)} />
        )}
      </div>
      {remove.isError ? <ErrorNotice error={remove.error} /> : null}
      {apply.isError ? <ErrorNotice error={apply.error} /> : null}
      {apply.isPending ? <p className="text-sm text-ink-300" role="status">Sending...</p> : null}
      {apply.data ? <RunResults run={apply.data} /> : null}
    </Card>
  );
}

export function GroupsPage() {
  const groups = useGroups();
  const devices = useDevices();
  const [editing, setEditing] = useState<GroupDto | 'new' | null>(null);
  const [applying, setApplying] = useState<GroupDto | null>(null);
  const deviceList = devices.data ?? [];

  return (
    <>
      <PageHeader
        title="Groups"
        description="Groups exist in this app only. Applying to a group sends each device its own commands, so changes are not perfectly synchronized."
        actions={
          <Button variant="primary" icon={<Plus className="size-4" aria-hidden />} onClick={() => setEditing('new')}>
            New group
          </Button>
        }
      />
      {groups.isPending ? <Loading label="Loading groups" /> : null}
      {groups.isError ? <ErrorNotice error={groups.error} /> : null}
      {groups.data?.length === 0 ? (
        <EmptyState
          icon={<Layers className="size-8" aria-hidden />}
          title="No groups yet"
          action={
            <Button variant="primary" onClick={() => setEditing('new')}>
              Create a group
            </Button>
          }
        >
          Group lights by area, such as Front of House or Backyard, to control them together.
        </EmptyState>
      ) : null}
      {groups.data && groups.data.length > 0 ? (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {groups.data.map((group) => (
            <GroupCard
              key={group.id}
              group={group}
              devices={deviceList}
              onEdit={() => setEditing(group)}
              onApply={() => setApplying(group)}
            />
          ))}
        </div>
      ) : null}
      {editing ? <GroupEditor group={editing === 'new' ? null : editing} devices={deviceList} onClose={() => setEditing(null)} /> : null}
      {applying ? <ActionDialog group={applying} onClose={() => setApplying(null)} /> : null}
    </>
  );
}
