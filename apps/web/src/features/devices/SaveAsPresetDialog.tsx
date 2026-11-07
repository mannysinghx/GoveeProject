import { useState } from 'react';
import type { DeviceAction, DeviceDto } from '@glm/shared';
import { Button, Dialog, ErrorNotice, Field, inputClass } from '../../components/ui';
import { useSavePreset } from '../../lib/queries';

export function SaveAsPresetDialog({
  device,
  actions,
  onClose,
  defaultName,
}: {
  device: DeviceDto;
  actions: DeviceAction[];
  onClose: () => void;
  defaultName: string;
}) {
  const [name, setName] = useState(defaultName);
  const save = useSavePreset();
  return (
    <Dialog title="Save as preset" open onClose={onClose}>
      <form
        className="space-y-4"
        onSubmit={(event) => {
          event.preventDefault();
          save.mutate(
            { create: { name, description: '', actions: actions.map((action) => ({ deviceId: device.id, action })) } },
            { onSuccess: onClose },
          );
        }}
      >
        <Field label="Preset name">
          {(props) => (
            <input {...props} className={inputClass} required maxLength={80} value={name} onChange={(e) => setName(e.target.value)} />
          )}
        </Field>
        {save.isError ? <ErrorNotice error={save.error} /> : null}
        <Button type="submit" variant="primary" busy={save.isPending}>
          Save preset
        </Button>
      </form>
    </Dialog>
  );
}
