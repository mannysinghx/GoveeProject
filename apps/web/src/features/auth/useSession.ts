import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { PASSWORD_MIN_LENGTH, type SessionDto } from '@glm/shared';
import { api, setCsrfToken } from '../../lib/api';
import { keys } from '../../lib/queries';

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

export function useLogout() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: () => api<void>('/auth/logout', { method: 'POST' }),
    onSettled: () => {
      setCsrfToken(null);
      client.clear();
      void client.invalidateQueries({ queryKey: keys.session });
    },
  });
}
