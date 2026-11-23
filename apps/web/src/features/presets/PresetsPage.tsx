import { Brush, Copy, Pencil, Play, Plus, Search, Sparkles, Trash2, X } from 'lucide-react';
import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import type { DeviceDto, PresetDto } from '@glm/shared';
import { Spectrum } from '../../components/light';
import { Badge, Button, Card, EmptyState, ErrorNotice, Field, inputClass, Loading, PageHeader, SectionCard } from '../../components/ui';
import { ImportedBadge, ShareButton } from '../sharing/ShareButton';
import { useDeletePreset, useDevices, useDuplicatePreset, usePresets } from '../../lib/queries';
import { MoodBox } from '../ai/MoodBox';
import { ScenesPanel } from '../devices/ScenesPanel';
import { isPatternPreset } from '../patterns/pattern-model';
import { ApplyPresetDialog } from './ApplyPresetDialog';
import { DailySchemeCard } from './DailySchemeCard';
import { FestivalPresets } from './FestivalPresets';
import { MasterBrightness } from './MasterBrightness';
import { PresetEditor } from './PresetEditor';
import { filterAndSort, isFiltering, NO_FILTER, PRESET_SORTS, type PresetFilter, type PresetKind, type PresetSort } from './preset-list';

/** Search, order and type for every pattern on the page: the ready-made ones and the owner's own. */
function PatternFinder({ filter, onChange, shown, total }: { filter: PresetFilter; onChange: (next: PresetFilter) => void; shown: number; total: number }) {
  return (
    <Card className="p-4 sm:p-5">
      <div className="grid grid-cols-1 gap-3 md:grid-cols-[minmax(0,1fr)_12rem_12rem]">
        <Field label="Search patterns">
          {(props) => (
            <div className="relative">
              <Search className="pointer-events-none absolute top-1/2 left-4 size-4 -translate-y-1/2 text-fg-4" aria-hidden />
              <input
                {...props}
                type="search"
                className={`${inputClass} rounded-full pl-10 pr-10`}
                placeholder="Name, occasion or color, such as gold or Christmas"
                value={filter.query}
                onChange={(event) => onChange({ ...filter, query: event.target.value })}
              />
              {filter.query ? (
                <button
                  type="button"
                  aria-label="Clear the search"
                  className="absolute top-1/2 right-1 flex size-9 -translate-y-1/2 items-center justify-center rounded-lg text-fg-3 hover:text-fg"
                  onClick={() => onChange({ ...filter, query: '' })}
                >
                  <X className="size-4" aria-hidden />
                </button>
              ) : null}
            </div>
          )}
        </Field>
        <Field label="Sort by">
          {(props) => (
            <select {...props} className={inputClass} value={filter.sort} onChange={(event) => onChange({ ...filter, sort: event.target.value as PresetSort })}>
              {PRESET_SORTS.map((sort) => (
                <option key={sort.value} value={sort.value}>
                  {sort.label}
                </option>
              ))}
            </select>
          )}
        </Field>
        <Field label="Show">
          {(props) => (
            <select {...props} className={inputClass} value={filter.kind} onChange={(event) => onChange({ ...filter, kind: event.target.value as PresetKind })}>
              <option value="all">Everything</option>
              <option value="pattern">Still patterns</option>
              <option value="effect">Moving effects</option>
            </select>
          )}
        </Field>
      </div>
      <p className="mt-3 text-xs text-fg-4" role="status">
        {isFiltering(filter) ? `Showing ${shown} of ${total} patterns and presets.` : `${total} patterns and presets.`}
        {filter.sort === 'calendar' ? ' Ready-made looks are in calendar order, and your own are by name.' : ''}
      </p>
    </Card>
  );
}

function PresetCard({
  preset,
  onEdit,
  onApply,
}: {
  preset: PresetDto;
  onEdit: () => void;
  onApply: () => void;
}) {
  const duplicate = useDuplicatePreset();
  const remove = useDeletePreset();
  const [confirming, setConfirming] = useState(false);

  const colors = preset.actions.flatMap((step) => ('hex' in step.action ? [step.action.hex] : []));
  return (
    <article className="tile flex flex-col gap-3 rounded-3xl p-5">
      {colors.length > 0 ? (
        <div className="pb-2">
          <Spectrum colors={colors} height="h-9" />
        </div>
      ) : null}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="font-display text-lg font-semibold tracking-tight">{preset.name}</h3>
        <Badge tone="amber">App preset</Badge>
      </div>
      <ImportedBadge from={preset.importedFrom} />
      {preset.description ? <p className="text-sm text-fg-3">{preset.description}</p> : null}
      <ol className="space-y-1 text-sm text-fg-3">
        {preset.actions.map((action, index) => (
          <li key={action.id} className="flex items-center gap-2">
            <span className="text-fg-4 tabular-nums">{index + 1}.</span>
            {'hex' in action.action ? (
              <span aria-hidden className="size-3 shrink-0 rounded-full border border-line-strong" style={{ backgroundColor: action.action.hex }} />
            ) : null}
            <span className="min-w-0 break-words">
              {action.summary}
              {action.deviceName ? <span className="text-fg-4"> · {action.deviceName}</span> : null}
            </span>
          </li>
        ))}
      </ol>
      <div className="mt-auto flex flex-wrap gap-2 pt-1">
        <Button size="sm" variant="primary" icon={<Play className="size-4" aria-hidden />} onClick={onApply}>
          Apply
        </Button>
        <Button size="sm" icon={<Pencil className="size-4" aria-hidden />} onClick={onEdit}>
          Edit
        </Button>
        <Button size="sm" icon={<Copy className="size-4" aria-hidden />} busy={duplicate.isPending} onClick={() => duplicate.mutate(preset.id)}>
          Duplicate
        </Button>
        {preset.builtin ? null : <ShareButton kind="preset" sourceId={preset.id} name={preset.name} />}
        {confirming ? (
          <>
            <Button size="sm" variant="danger" busy={remove.isPending} onClick={() => remove.mutate(preset.id)}>
              Confirm delete
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setConfirming(false)}>
              Keep
            </Button>
          </>
        ) : (
          <Button size="sm" variant="ghost" aria-label={`Delete ${preset.name}`} icon={<Trash2 className="size-4" aria-hidden />} onClick={() => setConfirming(true)} />
        )}
      </div>
      {duplicate.isError ? <ErrorNotice error={duplicate.error} /> : null}
      {remove.isError ? <ErrorNotice error={remove.error} /> : null}
    </article>
  );
}

function GoveeScenes({ devices }: { devices: DeviceDto[] }) {
  const withScenes = devices.filter((d) => d.discoveryStatus === 'present' && d.capabilities.some((c) => c.kind === 'scene'));
  const [selected, setSelected] = useState<string>('');
  const device = withScenes.find((d) => d.id === selected) ?? withScenes[0];

  if (withScenes.length === 0) {
    return (
      <EmptyState title="No device reports scenes">
        Scenes appear here only when Govee's API exposes them for a discovered device.
      </EmptyState>
    );
  }
  return (
    <div className="space-y-4">
      {withScenes.length > 1 ? (
        <div className="max-w-sm">
          <Field label="Device">
            {(props) => (
              <select {...props} className={inputClass} value={device?.id ?? ''} onChange={(e) => setSelected(e.target.value)}>
                {withScenes.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name}
                  </option>
                ))}
              </select>
            )}
          </Field>
        </div>
      ) : null}
      {device ? <ScenesPanel key={device.id} device={device} /> : null}
    </div>
  );
}

export function PresetsPage() {
  const presets = usePresets();
  const devices = useDevices();
  const [editing, setEditing] = useState<PresetDto | 'new' | null>(null);
  const [applying, setApplying] = useState<PresetDto | null>(null);
  const navigate = useNavigate();
  const [filter, setFilter] = useState<PresetFilter>(NO_FILTER);
  const allYours = presets.data?.filter((preset) => !preset.builtin);
  const yourPresets = allYours ? filterAndSort(allYours, filter) : undefined;
  const total = presets.data?.length ?? 0;
  const shown = presets.data ? filterAndSort(presets.data, filter).length : 0;

  return (
    <>
      <PageHeader
        title="Scenes & Presets"
        description="There are three different things here, and they behave differently."
        actions={
          <>
            <Button icon={<Brush className="size-4" aria-hidden />} onClick={() => navigate('/patterns/new')}>
              Paint a pattern
            </Button>
            <Button variant="primary" icon={<Plus className="size-4" aria-hidden />} onClick={() => setEditing('new')}>
              New preset
            </Button>
          </>
        }
      />

      {devices.data && devices.data.length > 0 ? (
        <div className="mb-8">
          <MoodBox />
        </div>
      ) : null}

      <div className="mb-8 grid grid-cols-1 gap-2 md:grid-cols-3">
        {[
          {
            tone: 'amber' as const,
            name: 'App preset',
            text: 'Saved in this app. A list of steps it sends one at a time. It keeps working with any device that supports the steps.',
          },
          {
            tone: 'info' as const,
            name: 'Govee scene',
            text: "Provided by Govee and stored on Govee's side. The app can activate those the API exposes, not change them.",
          },
          {
            tone: 'info' as const,
            name: 'Govee DIY scene',
            text: 'Made by you in the Govee Home app. The app can activate those the API exposes. It cannot create or edit them.',
          },
        ].map((kind) => (
          <div key={kind.name} className="rounded-3xl border border-line bg-inset/60 p-4">
            <Badge tone={kind.tone}>{kind.name}</Badge>
            <p className="mt-2 text-xs leading-relaxed text-fg-3">{kind.text}</p>
          </div>
        ))}
      </div>

      <div className="space-y-8">
        {devices.data ? <MasterBrightness devices={devices.data} /> : null}
        {presets.data?.some((preset) => preset.builtin) ? <DailySchemeCard presets={presets.data} onApply={setApplying} /> : null}
        {presets.data && presets.data.length > 0 ? <PatternFinder filter={filter} onChange={setFilter} shown={shown} total={total} /> : null}
        {presets.data ? <FestivalPresets presets={presets.data} filter={filter} onApply={setApplying} /> : null}

        <section aria-labelledby="presets-heading">
          <h2 id="presets-heading" className="mb-4 font-display text-2xl font-semibold tracking-tight">
            App presets
          </h2>
          {presets.isPending ? <Loading label="Loading presets" /> : null}
          {presets.isError ? <ErrorNotice error={presets.error} /> : null}
          {allYours && allYours.length > 0 && yourPresets?.length === 0 ? (
            <p className="rounded-3xl border border-dashed border-line-strong p-5 text-sm text-fg-3" role="status">
              None of your {allYours.length} preset{allYours.length === 1 ? '' : 's'} match. Try fewer words, or clear the search.
            </p>
          ) : null}
          {allYours?.length === 0 ? (
            <EmptyState
              icon={<Sparkles className="size-8" aria-hidden />}
              title="No presets yet"
              action={
                <Button variant="primary" onClick={() => setEditing('new')}>
                  Create a preset
                </Button>
              }
            >
              A preset is a saved list of steps, such as turn on, set brightness, set a warm colour.
            </EmptyState>
          ) : null}
          {yourPresets && yourPresets.length > 0 ? (
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
              {yourPresets.map((preset) => (
                <PresetCard
                  key={preset.id}
                  preset={preset}
                  onEdit={() => (isPatternPreset(preset) ? navigate(`/patterns/${preset.id}`) : setEditing(preset))}
                  onApply={() => setApplying(preset)}
                />
              ))}
            </div>
          ) : null}
        </section>

        <section aria-label="Scenes from Govee">
          {devices.data ? (
            devices.data.length > 0 ? (
              <GoveeScenes devices={devices.data} />
            ) : (
              <SectionCard title="No devices yet">
                <p className="text-sm text-fg-3">
                  <Link to="/connect" className="underline underline-offset-2">
                    Connect to Govee
                  </Link>{' '}
                  first.
                </p>
              </SectionCard>
            )
          ) : null}
        </section>
      </div>

      {editing ? <PresetEditor preset={editing === 'new' ? null : editing} onClose={() => setEditing(null)} /> : null}
      {applying ? <ApplyPresetDialog preset={applying} onClose={() => setApplying(null)} /> : null}
    </>
  );
}
