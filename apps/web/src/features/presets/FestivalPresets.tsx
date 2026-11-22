import { Copy, PartyPopper, Play } from 'lucide-react';
import { Link } from 'react-router-dom';
import { DAILY_SCHEME_PRESET, describeRecurrence, type PresetDto } from '@glm/shared';
import { Spectrum } from '../../components/light';
import { Badge, Button, ErrorNotice, Notice } from '../../components/ui';
import { useDuplicatePreset, useSchedules } from '../../lib/queries';
import { filterAndSort, isFiltering, usesEffect, type PresetFilter } from './preset-list';

/** `level` is one below the heading above it: an occasion heading when grouped by calendar, the section heading when not. */
function FestivalCard({ preset, onApply, level }: { preset: PresetDto; onApply: () => void; level: 3 | 4 }) {
  const Heading = level === 3 ? 'h3' : 'h4';
  const duplicate = useDuplicatePreset();
  const builtin = preset.builtin;
  if (!builtin) return null;
  const effect = usesEffect(preset);
  return (
    <article className="tile flex flex-col overflow-hidden rounded-3xl">
      <div className="px-4 pt-4 pb-5">
        <Spectrum colors={builtin.colors} height="h-11" />
      </div>
      <div className="flex flex-1 flex-col gap-2 px-4 pb-4">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <Heading className="min-w-0 font-display text-base font-semibold tracking-tight break-words">{preset.name}</Heading>
          <Badge tone={effect ? 'info' : 'neutral'}>{effect ? 'Moving effect' : 'Pattern'}</Badge>
        </div>
        <p className="text-sm text-fg-3">{preset.description}</p>
        <p className="text-xs text-fg-4">{builtin.when}</p>
        <div className="mt-auto flex flex-wrap gap-2 pt-2">
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
      </div>
    </article>
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
        <Button size="sm" aria-label={`Try it: ${preset.name}`} icon={<PartyPopper className="size-4" aria-hidden />} onClick={onApply}>
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

export function FestivalPresets({
  presets,
  filter,
  onApply,
}: {
  presets: PresetDto[];
  filter: PresetFilter;
  onApply: (preset: PresetDto) => void;
}) {
  const builtin = presets.filter((p) => p.builtin);
  if (builtin.length === 0) return null;
  // The fireworks show and "Today's Color Scheme" have their own sections, not a card here.
  const all = builtin.filter((p) => !p.builtin?.isAutomaticShow && p.builtin?.key !== DAILY_SCHEME_PRESET.key);
  const fireworks = filterAndSort(builtin, { ...filter, sort: 'calendar' }).find((p) => p.builtin?.isAutomaticShow);
  // In calendar order, as the catalog lists them, unless another order is chosen.
  const festival = filterAndSort(all, filter);
  const grouped = filter.sort === 'calendar';
  const occasions = [...new Set(festival.map((p) => p.builtin?.occasion as string))];

  return (
    <section aria-labelledby="festival-heading" className="space-y-4">
      <div>
        <h2 id="festival-heading" className="font-display text-2xl font-semibold tracking-tight">
          Festival presets
        </h2>
        <p className="mt-1 text-sm text-fg-3">
          {isFiltering(filter) ? `${festival.length} of ${all.length}` : festival.length} ready-made looks that span all your strings. Patterns are fixed colors. Moving effects are Govee's
          own, so Govee decides how they look. To change one, duplicate it and edit the copy.
        </p>
      </div>
      {fireworks ? <FireworksNotice preset={fireworks} onApply={() => onApply(fireworks)} /> : null}
      {festival.length === 0 && !fireworks ? (
        <p className="rounded-3xl border border-dashed border-line-strong p-5 text-sm text-fg-3" role="status">
          No ready-made look matches. Try fewer words, or clear the search.
        </p>
      ) : null}
      {grouped ? (
        occasions.map((occasion) => (
          <div key={occasion}>
            <h3 className="mb-3 text-xs font-semibold tracking-[0.14em] text-fg-4 uppercase">{occasion}</h3>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {festival
                .filter((p) => p.builtin?.occasion === occasion)
                .map((preset) => (
                  <FestivalCard key={preset.id} preset={preset} level={4} onApply={() => onApply(preset)} />
                ))}
            </div>
          </div>
        ))
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {festival.map((preset) => (
            <FestivalCard key={preset.id} preset={preset} level={3} onApply={() => onApply(preset)} />
          ))}
        </div>
      )}
    </section>
  );
}
