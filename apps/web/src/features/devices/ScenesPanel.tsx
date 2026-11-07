import { Play, RefreshCw, Search } from 'lucide-react';
import { useMemo, useState } from 'react';
import type { DeviceDto, SceneDto, SceneKind } from '@glm/shared';
import { CommandResultLine } from '../../components/status';
import { Badge, Button, EmptyState, ErrorNotice, Loading, Notice, inputClass, SectionCard } from '../../components/ui';
import { timeAgo } from '../../lib/format';
import { useApplyScene, useRefreshScenes, useScenes } from '../../lib/queries';

export const SCENE_KIND_LABEL: Record<SceneKind, { label: string; description: string }> = {
  dynamic: { label: 'Govee scene', description: 'A Govee-provided scene from the scenes endpoint.' },
  static: { label: 'Govee scene', description: 'A Govee-provided scene listed with the device.' },
  diy: { label: 'Govee DIY scene', description: 'A DIY scene made in the Govee Home app. It can be activated here, not edited.' },
  snapshot: { label: 'Govee snapshot', description: 'A saved snapshot from the Govee Home app.' },
};

export function ScenesPanel({ device }: { device: DeviceDto }) {
  const scenes = useScenes(device.id);
  const refresh = useRefreshScenes(device.id);
  const apply = useApplyScene(device.id);
  const [filter, setFilter] = useState('');

  const visible = useMemo(() => {
    const needle = filter.trim().toLowerCase();
    const all = scenes.data?.scenes ?? [];
    return needle ? all.filter((s) => s.name.toLowerCase().includes(needle)) : all;
  }, [scenes.data, filter]);

  const grouped = useMemo(() => {
    const groups = new Map<string, SceneDto[]>();
    for (const scene of visible) {
      const { label } = SCENE_KIND_LABEL[scene.kind];
      groups.set(label, [...(groups.get(label) ?? []), scene]);
    }
    return [...groups.entries()];
  }, [visible]);

  return (
    <SectionCard
      title="Scenes from Govee"
      description={
        scenes.data?.fetchedAt
          ? `Scene list refreshed ${timeAgo(scenes.data.fetchedAt)}. Only scenes the API exposes appear here, which may be fewer than in the Govee app.`
          : 'Only scenes the API exposes appear here, which may be fewer than in the Govee app.'
      }
      action={
        <Button
          size="sm"
          icon={<RefreshCw className="size-4" aria-hidden />}
          busy={refresh.isPending}
          onClick={() => refresh.mutate()}
        >
          Refresh scenes
        </Button>
      }
    >
      <div className="space-y-3">
        {refresh.isError ? <ErrorNotice error={refresh.error} /> : null}
        {scenes.isPending ? <Loading label="Loading scenes" /> : null}
        {scenes.isError ? <ErrorNotice error={scenes.error} /> : null}
        {scenes.data?.lastRefreshErrors.map((error) => (
          <Notice key={error.source} tone="warn" title={`Could not refresh ${error.source} scenes`}>
            {error.message} Previously fetched scenes are kept.
          </Notice>
        ))}

        {scenes.data && scenes.data.scenes.length === 0 ? (
          <EmptyState title="No scenes loaded">
            Use Refresh scenes to ask Govee what this device exposes.
          </EmptyState>
        ) : null}

        {scenes.data && scenes.data.scenes.length > 0 ? (
          <>
            <div className="relative max-w-sm">
              <Search className="absolute top-3.5 left-3 size-4 text-ink-400" aria-hidden />
              <input
                aria-label="Filter scenes"
                placeholder={`Filter ${scenes.data.scenes.length} scenes`}
                className={`${inputClass} pl-9`}
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
              />
            </div>

            {grouped.map(([label, list]) => (
              <div key={label}>
                <div className="mb-2 flex items-center gap-2">
                  <Badge tone="info">{label}</Badge>
                  <span className="text-xs text-ink-400">{list.length}</span>
                </div>
                <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                  {list.map((scene) => (
                    <li key={scene.key}>
                      <Button
                        className="w-full justify-start text-left"
                        icon={<Play className="size-4 shrink-0" aria-hidden />}
                        disabled={apply.isPending}
                        busy={apply.isPending && apply.variables === scene.key}
                        onClick={() => apply.mutate(scene.key)}
                      >
                        <span className="min-w-0 truncate">{scene.name}</span>
                      </Button>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
            {visible.length === 0 ? <p className="text-sm text-ink-300">No scenes match that filter.</p> : null}
          </>
        ) : null}

        {apply.isError ? <ErrorNotice error={apply.error} /> : null}
        {apply.data ? <CommandResultLine command={apply.data.command} /> : null}
      </div>
    </SectionCard>
  );
}
