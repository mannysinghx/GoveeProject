import { useState } from 'react';
import type { PresetDto, Target } from '@glm/shared';
import { RunResults } from '../../components/status';
import { Button, Dialog, ErrorNotice, Field, inputClass } from '../../components/ui';
import { useApplyPreset, useDevices, useGroups } from '../../lib/queries';

/** A select value of "device:<id>" or "group:<id>". */
function parseTarget(value: string): Target | undefined {
  const [type, id] = [value.slice(0, value.indexOf(':')), value.slice(value.indexOf(':') + 1)];
  if (type === 'device' && id) return { type: 'device', deviceId: id };
  if (type === 'group' && id) return { type: 'group', groupId: id };
  return undefined;
}

export function TargetOptions() {
  const devices = useDevices();
  const groups = useGroups();
  return (
    <>
      {(groups.data?.length ?? 0) > 0 ? (
        <optgroup label="Groups">
          {groups.data?.map((group) => (
            <option key={group.id} value={`group:${group.id}`}>
              {group.name}
            </option>
          ))}
        </optgroup>
      ) : null}
      <optgroup label="Devices">
        {devices.data?.map((device) => (
          <option key={device.id} value={`device:${device.id}`}>
            {device.name}
            {device.discoveryStatus === 'missing' ? ' (no longer discovered)' : ''}
          </option>
        ))}
      </optgroup>
    </>
  );
}

export { parseTarget };

export function ApplyPresetDialog({ preset, onClose }: { preset: PresetDto; onClose: () => void }) {
  const [targetValue, setTargetValue] = useState('');
  const apply = useApplyPreset();
  const target = parseTarget(targetValue);

  return (
    <Dialog title={`Apply "${preset.name}"`} open onClose={onClose}>
      <div className="space-y-4">
        <ol className="space-y-1 text-sm text-ink-300">
          {preset.actions.map((action, index) => (
            <li key={action.id}>
              {index + 1}. {action.summary}
              {action.deviceName ? <span className="text-ink-400"> · {action.deviceName}</span> : null}
            </li>
          ))}
        </ol>

        {preset.needsTarget ? (
          <Field label="Apply to" hint="Actions a device does not support are skipped for that device, with an explanation.">
            {(props) => (
              <select {...props} className={inputClass} value={targetValue} onChange={(e) => setTargetValue(e.target.value)}>
                <option value="">Choose a device or group</option>
                <TargetOptions />
              </select>
            )}
          </Field>
        ) : null}

        <Button
          variant="primary"
          busy={apply.isPending}
          disabled={preset.needsTarget && !target}
          onClick={() => apply.mutate({ id: preset.id, ...(target ? { target } : {}) })}
        >
          Apply preset
        </Button>

        {apply.isError ? <ErrorNotice error={apply.error} /> : null}
        {apply.data ? <RunResults run={apply.data} /> : null}
      </div>
    </Dialog>
  );
}
