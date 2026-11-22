import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { PASSWORD_MIN_LENGTH, type LinkCheckDto, type SessionDto } from '@glm/shared';
import { api, setCsrfToken } from '../../lib/api';
import { keys } from '../../lib/queries';
import { proveWork } from './proof-of-work';

export { PASSWORD_MIN_LENGTH };

export function useSession() {
  return useQuery({
    queryKey: keys.session,
    queryFn: async () => {
      const session = await api<SessionDto>('/auth/session');
      setCsrfToken(session.csrfToken);
      return session;
    },
    staleTime: 60_000,
    refetchInterval: 5 * 60_000,
  });
}

/**
 * After this browser's session has ended (sign-out, or the account was deleted): forget every
 * cached answer and show the signed-out pages at once, then ask the server for the real state.
 * Clearing the cache alone is not enough, because it also removes the session query that
 * decides which pages to show, so nothing would ask again.
 */
export function showSignedOut(client: QueryClient): void {
  setCsrfToken(null);
  const previous = client.getQueryData<SessionDto>(keys.session);
  client.removeQueries({ predicate: (query) => query.queryKey[0] !== keys.session[0] });
  if (previous) {
    client.setQueryData<SessionDto>(keys.session, {
      ...previous,
      authenticated: false,
      username: null,
      csrfToken: null,
      expiresAt: null,
      email: null,
      role: null,
    });
  }
  void client.invalidateQueries({ queryKey: keys.session });
}

function useSessionMutation<T>(path: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (body: T) => api<SessionDto>(path, { method: 'POST', body }),
    onSuccess: (session) => {
      setCsrfToken(session.csrfToken);
      client.setQueryData(keys.session, session);
    },
  });
}

export const useLogin = () => useSessionMutation<{ username: string; password: string }>('/auth/login');

export const useSetup = () =>
  useSessionMutation<{ username: string; password: string; setupCode?: string }>('/auth/setup');

export const useChangePassword = () =>
  useSessionMutation<{ currentPassword: string; newPassword: string }>('/auth/change-password');

/* --------------------------- email sign-up and reset -------------------------- */

/** Solves the puzzle, then sends the form. Sends `website` only if a bot filled it in. */
function useProvenForm(path: string) {
  return useMutation({
    mutationFn: async (input: { email: string; website: string }) => {
      const proof = await proveWork();
      return api<{ ok: true }>(path, {
        method: 'POST',
        body: { email: input.email, ...proof, ...(input.website ? { website: input.website } : {}) },
      });
    },
  });
}

export const useRegister = () => useProvenForm('/auth/register');
export const useForgotPassword = () => useProvenForm('/auth/password/forgot');

/** What an emailed link is for. Asking changes nothing on the server. */
export function useLinkCheck(token: string | null) {
  return useQuery({
    queryKey: ['auth', 'link', token],
    queryFn: () => api<LinkCheckDto>('/auth/link/check', { method: 'POST', body: { token } }),
    enabled: token !== null,
    staleTime: Infinity,
    gcTime: 0,
    retry: false,
  });
}

export const useCompleteSignup = () =>
  useMutation({ mutationFn: (body: { token: string; password: string }) => api<{ email: string }>('/auth/register/complete', { method: 'POST', body }) });

export function useResetPassword() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (body: { token: string; password: string }) => api<{ email: string }>('/auth/password/reset', { method: 'POST', body }),
    // A reset signs this person out everywhere, this browser included.
    onSuccess: () => {
      setCsrfToken(null);
      void client.invalidateQueries({ queryKey: keys.session });
    },
  });
}

export function useConfirmEmail() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (body: { token: string }) => api<{ email: string }>('/auth/email/confirm', { method: 'POST', body }),
    onSuccess: () => void client.invalidateQueries({ queryKey: keys.session }),
  });
}

export const useChangeEmail = () =>
  useMutation({
    mutationFn: (body: { newEmail: string; currentPassword: string }) => api<{ ok: true }>('/auth/email/change', { method: 'POST', body }),
  });

export function useLogout() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: () => api<void>('/auth/logout', { method: 'POST' }),
    // Before 22 November 2026 this cleared the cache and asked again, which left the signed-in
    // pages on screen after signing out: clearing removed the very query it then asked to refresh.
    onSettled: () => showSignedOut(client),
  });
}
