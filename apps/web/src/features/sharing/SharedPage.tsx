import { Download, Search, Share2 } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { describeRecurrence, OFFICIAL_SHARER_NAME, type ImportPreviewDto, type Recurrence, type SharedItemDto, type SharedKind } from '@glm/shared';
import { Badge, Button, Card, Dialog, EmptyState, ErrorNotice, Field, inputClass, Loading, Notice, PageHeader, SectionCard } from '../../components/ui';
import { useScenes } from '../../lib/queries';
import { useSession } from '../auth/useSession';
import { useImport, useImportPreview, useShareAll, useShared, useStopSharing } from './queries';
import { DisplayNameForm } from './ShareButton';

const KIND_LABEL: Record<SharedKind, string> = { preset: 'Preset', group: 'Group', schedule: 'Schedule' };

function Swatches({ colors }: { colors: string[] }) {
  if (colors.length === 0) return null;
  return (
    <div role="img" className="flex flex-wrap gap-1" aria-label={`Colours: ${colors.join(', ')}`}>
      {colors.map((hex) => (
        <span key={hex} aria-hidden className="size-5 rounded border border-line-strong" style={{ backgroundColor: hex }} />
      ))}
    </div>
  );
}

function summaryLine(item: SharedItemDto): string {
  const parts: string[] = [];
  if (item.recurrence) {
    try {
      parts.push(describeRecurrence(item.recurrence as unknown as Recurrence));
    } catch {
      // A timing this version cannot describe is simply left out.
    }
  }
  if (item.scheduleAction) parts.push(item.scheduleAction);
  const lights = item.slots.length;
  if (lights > 0) parts.push(`${lights} light${lights === 1 ? '' : 's'} (${[...new Set(item.slots.map((s) => s.sku))].join(', ')})`);
  return parts.join(' · ');
}

function SharedCard({ item, onImport }: { item: SharedItemDto; onImport: () => void }) {
  const stop = useStopSharing();
  return (
    <Card className="flex flex-col gap-3 p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 className="font-semibold break-words">{item.title}</h3>
          <p className="text-xs text-fg-4">
            {KIND_LABEL[item.kind]} by {item.by}
            {item.imports > 0 ? ` · imported ${item.imports} time${item.imports === 1 ? '' : 's'}` : ''}
          </p>
        </div>
        <div className="flex flex-wrap gap-1">
          {item.official ? <Badge tone="amber">Official</Badge> : null}
          {item.importedByMe ? <Badge tone="good">Imported</Badge> : null}
          {item.hidden ? <Badge tone="warn">Hidden by the owner</Badge> : null}
        </div>
      </div>
      {item.description ? <p className="text-sm whitespace-pre-line text-fg-3">{item.description}</p> : null}
      <Swatches colors={item.colors} />
      <p className="text-sm text-fg-3">{summaryLine(item)}</p>
      <div className="mt-auto flex flex-wrap gap-2 pt-1">
        <Button size="sm" variant="primary" icon={<Download className="size-4" aria-hidden />} onClick={onImport}>
          {item.importedByMe ? 'Import again' : 'Import'}
        </Button>
        {item.mine ? (
          <Button size="sm" variant="ghost" busy={stop.isPending} onClick={() => stop.mutate(item.id)}>
            Stop sharing
          </Button>
        ) : null}
      </div>
      {stop.isError ? <ErrorNotice error={stop.error} /> : null}
    </Card>
  );
}

/** A scene step: shown as it is when the chosen light has the scene, otherwise a choice. */
function SceneChoice({
  scene,
  deviceId,
  value,
  onChange,
}: {
  scene: ImportPreviewDto['scenes'][number];
  deviceId: string | null;
  value: string | undefined;
  onChange: (key: string | undefined) => void;
}) {
  const scenes = useScenes(deviceId ?? '', deviceId !== null);
  const list = scenes.data?.scenes ?? [];
  const hasSame = scene.portable && list.some((s) => s.key === scene.sceneKey);
  useEffect(() => {
    if (hasSame && value !== undefined) onChange(undefined);
  }, [hasSame, value, onChange]);
  if (deviceId === null) return null;
  if (scenes.isPending) return <Loading label="Loading scenes" />;
  if (hasSame) return <p className="text-sm text-fg-3">"{scene.presetName}" uses {scene.sceneName}, which this light has.</p>;
  return (
    <Field label={`Scene for "${scene.presetName}"`} hint={`${scene.sceneName} is not on this light${scene.portable ? '' : ' (made in someone else’s Govee app)'}. Choose one of its scenes.`}>
      {(props) => (
        <select {...props} className={inputClass} required value={value ?? ''} onChange={(e) => onChange(e.target.value || undefined)}>
          <option value="">Choose a scene</option>
          {list.map((s) => (
            <option key={s.key} value={s.key}>
              {s.name}
            </option>
          ))}
        </select>
      )}
    </Field>
  );
}

/**
 * Importing: each light the items use is matched to one of yours (suggested, then confirmed),
 * scenes are chosen where needed, and copies are made in your account. Schedules come in off.
 */
function ImportDialog({ items, onClose }: { items: SharedItemDto[]; onClose: () => void }) {
  const itemIds = useMemo(() => items.map((i) => i.id), [items]);
  const preview = useImportPreview(itemIds, true);
  const run = useImport();
  const [slots, setSlots] = useState<Record<string, string | null>>({});
  const [scenes, setScenes] = useState<Record<string, string>>({});

  useEffect(() => {
    if (preview.data) setSlots(Object.fromEntries(preview.data.slots.map((s) => [s.key, s.suggestion])));
  }, [preview.data]);

  const title = items.length === 1 ? `Import "${items[0]!.title}"` : `Import ${items.length} items`;
  const data = preview.data;

  return (
    <Dialog title={title} open onClose={onClose} wide>
      {preview.isPending ? <Loading label="Checking what this needs" /> : null}
      {preview.isError ? <ErrorNotice error={preview.error} /> : null}
      {run.data ? (
        <div className="space-y-4">
          <Notice tone="good" title="Imported">
            Made {run.data.created.presets} preset(s), {run.data.created.groups} group(s) and {run.data.created.schedules} schedule(s) in your account.
            They are yours: change or delete them freely. Schedules start switched off, so nothing runs until you turn one on.
          </Notice>
          <div className="flex flex-wrap gap-2">
            <Link to="/presets" className="text-sm text-accent-text underline underline-offset-2">
              Presets
            </Link>
            <Link to="/schedules" className="text-sm text-accent-text underline underline-offset-2">
              Schedules
            </Link>
            <Link to="/groups" className="text-sm text-accent-text underline underline-offset-2">
              Groups
            </Link>
          </div>
          <Button onClick={onClose}>Done</Button>
        </div>
      ) : data ? (
        <form
          className="space-y-5"
          onSubmit={(event) => {
            event.preventDefault();
            run.mutate({ itemIds, slots, scenes });
          }}
        >
          <p className="text-sm text-fg-3">
            This makes {data.create.presets} preset(s), {data.create.groups} group(s) and {data.create.schedules} schedule(s) in your account, as copies. Nothing
            changes on anyone else&apos;s lights, and schedules start switched off.
          </p>
          {data.alreadyImported.length > 0 ? <Notice tone="info">You imported {data.alreadyImported.join(', ')} before. This makes another copy.</Notice> : null}
          {data.needsLocation ? (
            <Notice tone="warn" title="Your location is needed">
              A schedule here runs at sunrise or sunset. Add your latitude and longitude in{' '}
              <Link to="/settings" className="underline underline-offset-2">
                Settings
              </Link>{' '}
              first.
            </Notice>
          ) : null}
          {data.slots.length > 0 && data.devices.length === 0 ? (
            <Notice tone="warn">
              You have no lights yet.{' '}
              <Link to="/connect" className="underline underline-offset-2">
                Connect your Govee key and find your lights
              </Link>{' '}
              first.
            </Notice>
          ) : null}
          {data.slots.length > 0 ? (
            <section className="space-y-3">
              <h3 className="text-sm font-semibold text-fg">Which of your lights?</h3>
              {data.slots.map((slot) => (
                <Field
                  key={slot.key}
                  label={slot.label}
                  hint={`Made for a ${slot.sku}${slot.segmentCount ? ` with ${slot.segmentCount} segments` : ''}. Patterns are fitted to your light's segments.`}
                >
                  {(props) => (
                    <select
                      {...props}
                      className={inputClass}
                      value={slots[slot.key] ?? ''}
                      onChange={(e) => setSlots((current) => ({ ...current, [slot.key]: e.target.value || null }))}
                    >
                      <option value="">Pick a light when applying</option>
                      {data.devices
                        .filter((d) => (!slot.needsSegments || d.segmentCount > 0) && (!slot.needsColor || d.hasColor))
                        .map((d) => (
                          <option key={d.id} value={d.id}>
                            {d.name} ({d.sku}{d.segmentCount ? `, ${d.segmentCount} segments` : ''})
                          </option>
                        ))}
                    </select>
                  )}
                </Field>
              ))}
            </section>
          ) : null}
          {data.scenes.length > 0 ? (
            <section className="space-y-3">
              <h3 className="text-sm font-semibold text-fg">Scenes</h3>
              {data.scenes.map((scene) => (
                <SceneChoice
                  key={scene.choiceKey}
                  scene={scene}
                  deviceId={scene.slot ? (slots[scene.slot] ?? null) : null}
                  value={scenes[scene.choiceKey]}
                  onChange={(key) =>
                    setScenes((current) => {
                      const next = { ...current };
                      if (key) next[scene.choiceKey] = key;
                      else delete next[scene.choiceKey];
                      return next;
                    })
                  }
                />
              ))}
            </section>
          ) : null}
          {run.isError ? <ErrorNotice error={run.error} title="Nothing was imported" /> : null}
          <div className="flex flex-wrap gap-2">
            <Button type="submit" variant="primary" busy={run.isPending} disabled={data.needsLocation}>
              Import
            </Button>
            <Button variant="ghost" onClick={onClose}>
              Cancel
            </Button>
          </div>
        </form>
      ) : null}
    </Dialog>
  );
}

export function SharedPage() {
  const shared = useShared();
  const session = useSession();
  const shareAll = useShareAll();
  const [importing, setImporting] = useState<SharedItemDto[] | null>(null);
  const [filter, setFilter] = useState('');
  const [kind, setKind] = useState<SharedKind | 'all' | 'mine'>('all');
  const isOwner = session.data?.role === 'owner';

  if (shared.isPending) return <Loading />;
  if (shared.isError) return <ErrorNotice error={shared.error} />;
  const data = shared.data;
  const words = filter.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const visible = data.items.filter((item) => {
    if (kind === 'mine' && !item.mine) return false;
    if (kind !== 'all' && kind !== 'mine' && item.kind !== kind) return false;
    const text = `${item.title} ${item.description} ${item.by}`.toLowerCase();
    return words.every((w) => text.includes(w));
  });
  const official = visible.filter((i) => i.official);
  const community = visible.filter((i) => !i.official);
  const allOfficial = data.items.filter((i) => i.official && !i.hidden);

  return (
    <>
      <PageHeader
        title="Shared"
        description="Presets, groups and schedules people have shared. Import a copy into your own account, onto your own lights."
        actions={
          isOwner ? (
            <Button icon={<Share2 className="size-4" aria-hidden />} busy={shareAll.isPending} onClick={() => shareAll.mutate()}>
              Share all my lights and schedules
            </Button>
          ) : null
        }
      />
      <div className="space-y-6">
        {shareAll.data ? (
          <Notice tone="good">
            Shared {shareAll.data.shared} more item(s).{shareAll.data.skipped.length > 0 ? ` Left out: ${shareAll.data.skipped.map((s) => `${s.name} (${s.reason})`).join('; ')}` : ''}
          </Notice>
        ) : null}
        {shareAll.isError ? <ErrorNotice error={shareAll.error} /> : null}

        {!isOwner ? (
          <SectionCard
            title="Your display name"
            description={data.displayName ? `Shown on what you share: ${data.displayName}.` : 'Choose one before you share anything. Your email address is never shown.'}
          >
            {data.canShare ? <DisplayNameForm key={data.displayName ?? ''} current={data.displayName} /> : <Notice tone="warn">Sharing is turned off for your account.</Notice>}
            {data.shareLimit !== null ? (
              <p className="mt-3 text-xs text-fg-4">
                You share {data.sharedCount} of up to {data.shareLimit} items. Share from the Presets, Groups or Schedules pages.
              </p>
            ) : null}
          </SectionCard>
        ) : null}

        <div className="flex flex-wrap gap-3">
          <label className="relative min-w-56 flex-1">
            <span className="sr-only">Search shared items</span>
            <Search className="pointer-events-none absolute top-3 left-3 size-4 text-fg-4" aria-hidden />
            <input className={`${inputClass} pl-9`} placeholder="Search" value={filter} onChange={(e) => setFilter(e.target.value)} />
          </label>
          <label>
            <span className="sr-only">Show</span>
            <select className={inputClass} value={kind} onChange={(e) => setKind(e.target.value as typeof kind)}>
              <option value="all">Everything</option>
              <option value="preset">Presets</option>
              <option value="schedule">Schedules</option>
              <option value="group">Groups</option>
              <option value="mine">Shared by me</option>
            </select>
          </label>
        </div>

        <section className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-lg font-semibold">{OFFICIAL_SHARER_NAME}</h2>
            {allOfficial.length > 1 ? (
              <Button size="sm" icon={<Download className="size-4" aria-hidden />} onClick={() => setImporting(allOfficial)}>
                Import everything from {OFFICIAL_SHARER_NAME}
              </Button>
            ) : null}
          </div>
          {official.length === 0 ? (
            <EmptyState title="Nothing here yet">{isOwner ? 'Share your presets, groups and schedules, and they appear here for everyone.' : 'Official presets and schedules will appear here.'}</EmptyState>
          ) : (
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
              {official.map((item) => (
                <SharedCard key={item.id} item={item} onImport={() => setImporting([item])} />
              ))}
            </div>
          )}
        </section>

        <section className="space-y-3">
          <h2 className="text-lg font-semibold">Community</h2>
          {community.length === 0 ? (
            <EmptyState title="Nothing shared yet">Share a preset, group or schedule from its page, and it appears here.</EmptyState>
          ) : (
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
              {community.map((item) => (
                <SharedCard key={item.id} item={item} onImport={() => setImporting([item])} />
              ))}
            </div>
          )}
        </section>
      </div>
      {importing ? <ImportDialog items={importing} onClose={() => setImporting(null)} /> : null}
    </>
  );
}
