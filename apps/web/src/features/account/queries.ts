import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  AdminAccountListDto,
  AiProviderId,
  GoveeKeyStatusDto,
  PersonalAiDto,
} from '@glm/shared';
import { api, apiDownload } from '../../lib/api';
import { showSignedOut } from '../auth/useSession';
import { keys } from '../../lib/queries';

/*
 * The person's own account. Keys are sent once and never come back. After a key is sent, the
 * page resets the request (mutation.reset()), so no copy stays in the query client either.
 */

export const accountKeys = {
  govee: ['account', 'govee'] as const,
  ai: ['account', 'ai'] as const,
  admin: ['admin', 'accounts'] as const,
};

export function useGoveeKey() {
  return useQuery({ queryKey: accountKeys.govee, queryFn: () => api<GoveeKeyStatusDto>('/account/govee') });
}

/** After the key changes, everything that depends on it is asked again. */
function useGoveeChanged() {
  const client = useQueryClient();
  return (data: GoveeKeyStatusDto) => {
    client.setQueryData(accountKeys.govee, data);
    void client.invalidateQueries({ queryKey: keys.diagnostics });
    void client.invalidateQueries({ queryKey: keys.devices });
  };
}

export function useConnectGovee() {
  const changed = useGoveeChanged();
  return useMutation({
    mutationFn: (apiKey: string) => api<GoveeKeyStatusDto>('/account/govee', { method: 'PUT', body: { apiKey } }),
    onSuccess: changed,
  });
}

export function useRemoveGovee() {
  const changed = useGoveeChanged();
  return useMutation({
    mutationFn: () => api<GoveeKeyStatusDto>('/account/govee', { method: 'DELETE' }),
    onSuccess: changed,
  });
}

export function usePersonalAi() {
  return useQuery({ queryKey: accountKeys.ai, queryFn: () => api<PersonalAiDto>('/account/ai') });
}

function useAiChanged() {
  const client = useQueryClient();
  return (data: PersonalAiDto) => {
    client.setQueryData(accountKeys.ai, data);
    void client.invalidateQueries({ queryKey: ['ai'] });
  };
}

export function useConnectAiKey() {
  const changed = useAiChanged();
  return useMutation({
    mutationFn: ({ provider, model, apiKey }: { provider: AiProviderId; model: string; apiKey: string }) =>
      api<PersonalAiDto>(`/account/ai/keys/${provider}`, { method: 'PUT', body: { model, apiKey } }),
    onSuccess: changed,
  });
}

export function useRemoveAiKey() {
  const changed = useAiChanged();
  return useMutation({
    mutationFn: (provider: AiProviderId) => api<PersonalAiDto>(`/account/ai/keys/${provider}`, { method: 'DELETE' }),
    onSuccess: changed,
  });
}

export function useSetAiLimit() {
  const changed = useAiChanged();
  return useMutation({
    mutationFn: (monthlyLimitUsd: number) => api<PersonalAiDto>('/account/ai', { method: 'PATCH', body: { monthlyLimitUsd } }),
    onSuccess: changed,
  });
}

/** Saves the export as a file in the browser. Nothing is kept in the page. */
export function useExportAccount() {
  return useMutation({
    mutationFn: async (currentPassword: string) => {
      const { blob, filename } = await apiDownload('/account/export', { currentPassword });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      return filename;
    },
  });
}

export function useDeleteAccount() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (currentPassword: string) => api<void>('/account/delete', { method: 'POST', body: { currentPassword, confirm: 'DELETE' } }),
    onSuccess: () => showSignedOut(client),
  });
}

export function useAdminAccounts() {
  return useQuery({ queryKey: accountKeys.admin, queryFn: () => api<AdminAccountListDto>('/admin/accounts') });
}

export function useSetAccountStatus() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ id, status }: { id: number; status: 'active' | 'suspended' }) =>
      api<AdminAccountListDto>(`/admin/accounts/${id}`, { method: 'PATCH', body: { status } }),
    onSuccess: (data) => client.setQueryData(accountKeys.admin, data),
  });
}
