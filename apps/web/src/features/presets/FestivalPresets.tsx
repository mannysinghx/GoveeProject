import { Copy, PartyPopper, Play } from 'lucide-react';
import { Link } from 'react-router-dom';
import { BUILTIN_PRESETS, describeRecurrence, type PresetDto } from '@glm/shared';
import { Badge, Button, Card, ErrorNotice, Notice } from '../../components/ui';
import { useDuplicatePreset, useSchedules } from '../../lib/queries';

function Swatches({ colors }: { colors: string[] }) {
  return (
    <div aria-hidden className="flex h-5 gap-px overflow-hidden rounded border border-ink-600">
      {colors.map((color, index) => (
        <span key={index} className="min-w-0 flex-1" style={{ backgroundColor: color }} />
      ))}
    </div>
  );
}

function usesEffect(preset: PresetDto): boolean {
  return preset.actions.some((a) => a.action.type === 'scene');
}

function FestivalCard({ preset, onApply }: { preset: PresetDto; onApply: () => void }) {
  const duplicate = useDuplicatePreset();
  const builtin = preset.builtin;
  if (!builtin) return null;
  const effect = usesEffect(preset);
  return (
    <Card className="flex flex-col gap-2 p-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <h4 className="min-w-0 text-sm font-semibold break-words">{preset.name}</h4>
        <Badge tone={effect ? 'info' : 'neutral'}>{effect ? 'Moving effect' : 'Pattern'}</Badge>
      </div>
      <Swatches colors={builtin.colors} />
      <p className="text-xs text-ink-300">{preset.description}</p>
      <p className="text-xs text-ink-400">{builtin.when}</p>
      <div className="mt-auto flex flex-wrap gap-2 pt-1">
        <Button size="sm" variant="primary" aria-label={`Apply ${preset.name}`} icon={<Play className="size-4" aria-hidden />} onClick={onApply}>
          Apply
        </Button>
        <Button
          size="sm"
          aria-label={`Duplicate ${preset.name}`}
          icon={<Copy className="size-4" aria-hidden />}
          busy={duplicate.isPending}
          onClick={() => duplicate.mutate(preset.id)}
        >
          Duplicate
        </Button>
      </div>
      {duplicate.isError ? <ErrorNotice error={duplicate.error} /> : null}
    </Card>
  );
}

/** Whether the automatic show is set up, when it next runs, and how to change it. */
function FireworksNotice({ preset, onApply }: { preset: PresetDto; onApply: () => void }) {
  const schedules = useSchedules();
  const show = schedules.data?.find((s) => s.action.type === 'preset' && s.action.presetId === preset.id);
  const effect = usesEffect(preset);
  return (
    <Notice
      tone="info"
      title="New Year fireworks"
      action={
        <Button size="sm" aria-label={`Try ${preset.name}`} icon={<PartyPopper className="size-4" aria-hidden />} onClick={onApply}>
          Try it
        </Button>
      }
    >
      {show ? (
        <p>
          {show.enabled
            ? `Runs automatically. ${describeRecurrence(show.recurrence)} (${show.timeZone}). Next: ${show.nextRun?.local ?? 'not scheduled'}.`
            : 'The automatic show is turned off.'}{' '}
          <Link to="/schedules" className="underline underline-offset-2">
            Change it under Schedules
          </Link>
          .
        </p>
      ) : (
        <p>
          No schedule runs this right now. You can add one under{' '}
          <Link to="/schedules" className="underline underline-offset-2">
            Schedules
          </Link>
          .
        </p>
      )}
      <p className="mt-1">
        {effect
          ? "It turns on your lights at full brightness and starts Govee's Fireworks effect on each string. The lights stop at 12:30 AM unless you change that schedule. The strings start a moment apart and aren't synchronized."
          : "Your lights don't list Govee's Fireworks effect yet, so this shows fixed firework colors, with no movement."}
      </p>
    </Notice>
  );
}

export function FestivalPresets({ presets, onApply }: { presets: PresetDto[]; onApply: (preset: PresetDto) => void }) {
  // In calendar order, as the catalog lists them, rather than by name.
  const catalogOrder = (preset: PresetDto) => BUILTIN_PRESETS.findIndex((b) => b.key === preset.builtin?.key);
  const builtin = presets.filter((p) => p.builtin).sort((a, b) => catalogOrder(a) - catalogOrder(b));
  if (builtin.length === 0) return null;
  const fireworks = builtin.find((p) => p.builtin?.isAutomaticShow);
  const festival = builtin.filter((p) => !p.builtin?.isAutomaticShow);
  const occasions = [...new Set(festival.map((p) => p.builtin?.occasion as string))];

  return (
    <section aria-labelledby="festival-heading" className="space-y-4">
      <div>
        <h2 id="festival-heading" className="text-lg font-semibold">
          Festival presets
        </h2>
        <p className="mt-1 text-sm text-ink-300">
          {festival.length} ready-made looks that span all your strings. Patterns are fixed colors. Moving effects are Govee's
          own, so Govee decides how they look. To change one, duplicate it and edit the copy.
        </p>
      </div>
      {fireworks ? <FireworksNotice preset={fireworks} onApply={() => onApply(fireworks)} /> : null}
      {occasions.map((occasion) => (
        <div key={occasion}>
          <h3 className="mb-2 text-sm font-medium text-ink-200">{occasion}</h3>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {festival
              .filter((p) => p.builtin?.occasion === occasion)
              .map((preset) => (
                <FestivalCard key={preset.id} preset={preset} onApply={() => onApply(preset)} />
              ))}
          </div>
        </div>
      ))}
    </section>
  );
}
