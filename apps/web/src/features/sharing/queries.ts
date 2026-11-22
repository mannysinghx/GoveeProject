import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  AdminAccountListDto,
  AdminSharedItemDto,
  ImportPreviewDto,
  ImportRequest,
  ImportResultDto,
  ShareAllResultDto,
  SharedItemDto,
  SharedKind,
  SharedListDto,
} from '@glm/shared';
import { api } from '../../lib/api';
import { keys } from '../../lib/queries';
import { accountKeys } from '../account/queries';

export const sharingKeys = {
  list: ['shared'] as const,
  admin: ['admin', 'shared'] as const,
};

export function useShared() {
  return useQuery({ queryKey: sharingKeys.list, queryFn: () => api<SharedListDto>('/shared') });
}

function useSharedChanged() {
  const client = useQueryClient();
  return () => {
    void client.invalidateQueries({ queryKey: sharingKeys.list });
    void client.invalidateQueries({ queryKey: sharingKeys.admin });
  };
}

export function useSetDisplayName() {
  const changed = useSharedChanged();
  return useMutation({
    mutationFn: (displayName: string) => api<{ displayName: string }>('/account/display-name', { method: 'PUT', body: { displayName } }),
    onSuccess: changed,
  });
}

export function useShare() {
  const changed = useSharedChanged();
  return useMutation({
    mutationFn: (body: { kind: SharedKind; sourceId: string; title?: string; description?: string }) =>
      api<SharedItemDto>('/shared', { method: 'POST', body }),
    onSuccess: changed,
  });
}

export function useUpdateShare() {
  const changed = useSharedChanged();
  return useMutation({
    mutationFn: ({ id, ...body }: { id: string; title?: string; description?: string; slotLabels?: Record<string, string>; refresh?: boolean }) =>
      api<SharedItemDto>(`/shared/${encodeURIComponent(id)}`, { method: 'PUT', body }),
    onSuccess: changed,
  });
}

export function useStopSharing() {
  const changed = useSharedChanged();
  return useMutation({
    mutationFn: (id: string) => api<void>(`/shared/${encodeURIComponent(id)}`, { method: 'DELETE' }),
    onSuccess: changed,
  });
}

export function useShareAll() {
  const changed = useSharedChanged();
  return useMutation({ mutationFn: () => api<ShareAllResultDto>('/shared/share-all', { method: 'POST' }), onSuccess: changed });
}

export function useImportPreview(itemIds: string[], enabled: boolean) {
  return useQuery({
    queryKey: ['shared', 'preview', [...itemIds].sort()],
    queryFn: () => api<ImportPreviewDto>('/shared/import/preview', { method: 'POST', body: { itemIds } }),
    enabled: enabled && itemIds.length > 0,
    staleTime: 0,
    gcTime: 0,
  });
}

export function useImport() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (body: ImportRequest) => api<ImportResultDto>('/shared/import', { method: 'POST', body }),
    onSuccess: () => {
      for (const key of [sharingKeys.list, keys.presets, keys.groups, keys.schedules, keys.summary]) void client.invalidateQueries({ queryKey: key });
    },
  });
}

/* ---------------------------------- owner ----------------------------------- */

export function useAdminShared() {
  return useQuery({ queryKey: sharingKeys.admin, queryFn: async () => (await api<{ items: AdminSharedItemDto[] }>('/admin/shared')).items });
}

export function useModerateShared() {
  const client = useQueryClient();
  const done = (items: AdminSharedItemDto[]) => {
    client.setQueryData(sharingKeys.admin, items);
    void client.invalidateQueries({ queryKey: sharingKeys.list });
  };
  const hide = useMutation({
    mutationFn: ({ id, hidden }: { id: string; hidden: boolean }) =>
      api<{ items: AdminSharedItemDto[] }>(`/admin/shared/${encodeURIComponent(id)}`, { method: 'PATCH', body: { hidden } }),
    onSuccess: ({ items }) => done(items),
  });
  const remove = useMutation({
    mutationFn: (id: string) => api<{ items: AdminSharedItemDto[] }>(`/admin/shared/${encodeURIComponent(id)}`, { method: 'DELETE' }),
    onSuccess: ({ items }) => done(items),
  });
  return { hide, remove };
}

export function useModerateAccount() {
  const client = useQueryClient();
  const done = (data: AdminAccountListDto) => client.setQueryData(accountKeys.admin, data);
  const block = useMutation({
    mutationFn: ({ id, blocked }: { id: number; blocked: boolean }) => api<AdminAccountListDto>(`/admin/accounts/${id}/sharing`, { method: 'PUT', body: { blocked } }),
    onSuccess: done,
  });
  const resetName = useMutation({
    mutationFn: (id: number) => api<AdminAccountListDto>(`/admin/accounts/${id}/display-name`, { method: 'DELETE' }),
    onSuccess: done,
  });
  return { block, resetName };
}
