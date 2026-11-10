import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import type {
  ActivityListDto,
  AiAnswerDto,
  AiQuestionListDto,
  AiStatusDto,
  ActivityQuery,
  AppSettings,
  CommandDto,
  ConnectionReportDto,
  DashboardSummaryDto,
  DeviceAction,
  DeviceDetailDto,
  DeviceDto,
  DiagnosticsDto,
  DiscoveryResultDto,
  HolidayDto,
  HolidayUpdate,
  NotificationAction,
  NotificationDto,
  NotificationListDto,
  PushStatusDto,
  PushSubscribe,
  GroupCreate,
  GroupDto,
  GroupUpdate,
  PresetActionInput,
  PresetCreate,
  PresetDto,
  PresetUpdate,
  RefreshResultDto,
  RunResultDto,
  ScenesDto,
  ScheduleCreate,
  ScheduleDto,
  ScheduleExecutionDto,
  SchedulePreviewDto,
  SchedulePreviewRequest,
  ScheduleUpdate,
  SegmentsRequest,
  SettingsUpdate,
  Target,
} from '@glm/shared';
import { api } from './api';

export const keys = {
  session: ['session'] as const,
  devices: ['devices'] as const,
  device: (id: string) => ['devices', id] as const,
  scenes: (id: string) => ['devices', id, 'scenes'] as const,
  groups: ['groups'] as const,
  presets: ['presets'] as const,
  schedules: ['schedules'] as const,
  executions: (id: string) => ['schedules', id, 'executions'] as const,
  activity: (filters: unknown) => ['activity', filters] as const,
  diagnostics: ['diagnostics'] as const,
  settings: ['settings'] as const,
  summary: ['summary'] as const,
};

/* ------------------------------- devices --------------------------------- */

export function useDevices() {
  return useQuery({
    queryKey: keys.devices,
    queryFn: async () => (await api<{ devices: DeviceDto[] }>('/devices')).devices,
    // Reads the app's cache, not Govee. Pending commands need this to stay current.
    refetchInterval: 5000,
  });
}

export function useDevice(id: string) {
  return useQuery({
    queryKey: keys.device(id),
    queryFn: () => api<DeviceDetailDto>(`/devices/${encodeURIComponent(id)}`),
    refetchInterval: 4000,
  });
}

function invalidateDeviceData(client: QueryClient, id?: string) {
  void client.invalidateQueries({ queryKey: keys.devices, exact: !id });
  if (id) void client.invalidateQueries({ queryKey: keys.device(id) });
  void client.invalidateQueries({ queryKey: keys.summary });
}

export function useDiscover() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: () => api<DiscoveryResultDto>('/devices/discover', { method: 'POST' }),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: keys.devices });
      void client.invalidateQueries({ queryKey: keys.diagnostics });
    },
    onError: () => {
      void client.invalidateQueries({ queryKey: keys.diagnostics });
      void client.invalidateQueries({ queryKey: keys.summary });
    },
  });
}

export function useRefreshDevice(id: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: () => api<RefreshResultDto>(`/devices/${encodeURIComponent(id)}/refresh`, { method: 'POST' }),
    onSettled: () => invalidateDeviceData(client, id),
  });
}

export function useRefreshDue() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: () => api<{ devices: DeviceDto[] }>('/devices/refresh-due', { method: 'POST' }),
    onSettled: () => {
      void client.invalidateQueries({ queryKey: keys.devices });
    },
  });
}

export interface CommandResponse {
  command: CommandDto;
  device: DeviceDto;
}

type ControlAction =
  | { kind: 'power'; on: boolean }
  | { kind: 'brightness'; value: number }
  | { kind: 'color'; hex: string }
  | { kind: 'colorTemperature'; kelvin: number };

export function useDeviceControl(id: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (action: ControlAction): Promise<CommandResponse> => {
      const base = `/devices/${encodeURIComponent(id)}`;
      switch (action.kind) {
        case 'power':
          return api(`${base}/power`, { method: 'POST', body: { on: action.on } });
        case 'brightness':
          return api(`${base}/brightness`, { method: 'POST', body: { value: action.value } });
        case 'color':
          return api(`${base}/color`, { method: 'POST', body: { hex: action.hex } });
        case 'colorTemperature':
          return api(`${base}/color-temperature`, { method: 'POST', body: { kelvin: action.kelvin } });
      }
    },
    onSettled: () => invalidateDeviceData(client, id),
  });
}

export function useSegments(id: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (body: SegmentsRequest) =>
      api<RunResultDto>(`/devices/${encodeURIComponent(id)}/segments`, { method: 'POST', body }),
    onSettled: () => invalidateDeviceData(client, id),
  });
}

/* -------------------------------- scenes --------------------------------- */

export function useScenes(id: string, enabled = true) {
  return useQuery({
    queryKey: keys.scenes(id),
    queryFn: () => api<ScenesDto>(`/devices/${encodeURIComponent(id)}/scenes`),
    enabled,
  });
}

export function useRefreshScenes(id: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: () => api<ScenesDto>(`/devices/${encodeURIComponent(id)}/scenes/refresh`, { method: 'POST' }),
    onSuccess: (data) => client.setQueryData(keys.scenes(id), data),
  });
}

export function useApplyScene(id: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (sceneKey: string) =>
      api<CommandResponse>(
        `/devices/${encodeURIComponent(id)}/scenes/${encodeURIComponent(sceneKey)}/apply`,
        { method: 'POST' },
      ),
    onSettled: () => invalidateDeviceData(client, id),
  });
}

/* -------------------------------- groups --------------------------------- */

export function useGroups() {
  return useQuery({
    queryKey: keys.groups,
    queryFn: async () => (await api<{ groups: GroupDto[] }>('/groups')).groups,
  });
}

export function useSaveGroup() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: { id?: string; create?: GroupCreate; update?: GroupUpdate }) =>
      input.id
        ? api<GroupDto>(`/groups/${input.id}`, { method: 'PATCH', body: input.update })
        : api<GroupDto>('/groups', { method: 'POST', body: input.create }),
    onSuccess: () => client.invalidateQueries({ queryKey: keys.groups }),
  });
}

export function useDeleteGroup() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api<void>(`/groups/${id}`, { method: 'DELETE' }),
    onSuccess: () => client.invalidateQueries({ queryKey: keys.groups }),
  });
}

export function useApplyGroupAction() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ id, action }: { id: string; action: DeviceAction }) =>
      api<RunResultDto>(`/groups/${id}/apply`, { method: 'POST', body: { action } }),
    onSettled: () => {
      void client.invalidateQueries({ queryKey: keys.devices });
      void client.invalidateQueries({ queryKey: keys.summary });
    },
  });
}

/* -------------------------------- presets -------------------------------- */

export function usePresets() {
  return useQuery({
    queryKey: keys.presets,
    queryFn: async () => (await api<{ presets: PresetDto[] }>('/presets')).presets,
  });
}

export function useSavePreset() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: { id?: string; create?: PresetCreate; update?: PresetUpdate }) =>
      input.id
        ? api<PresetDto>(`/presets/${input.id}`, { method: 'PATCH', body: input.update })
        : api<PresetDto>('/presets', { method: 'POST', body: input.create }),
    onSuccess: () => client.invalidateQueries({ queryKey: keys.presets }),
  });
}

export function useDuplicatePreset() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api<PresetDto>(`/presets/${id}/duplicate`, { method: 'POST' }),
    onSuccess: () => client.invalidateQueries({ queryKey: keys.presets }),
  });
}

export function useDeletePreset() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api<void>(`/presets/${id}`, { method: 'DELETE' }),
    onSuccess: () => client.invalidateQueries({ queryKey: keys.presets }),
  });
}

export function useApplyPreset() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ id, target }: { id: string; target?: Target }) =>
      api<RunResultDto>(`/presets/${id}/apply`, { method: 'POST', body: target ? { target } : {} }),
    onSettled: () => {
      void client.invalidateQueries({ queryKey: keys.devices });
      void client.invalidateQueries({ queryKey: keys.summary });
    },
  });
}

export function useApplyDraft() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (body: { name: string; target?: Target; actions: PresetActionInput[] }) =>
      api<RunResultDto>('/presets/apply-draft', { method: 'POST', body }),
    onSettled: () => {
      void client.invalidateQueries({ queryKey: keys.devices });
      void client.invalidateQueries({ queryKey: keys.summary });
    },
  });
}

/* ------------------------------- schedules ------------------------------- */

export function useSchedules() {
  return useQuery({
    queryKey: keys.schedules,
    queryFn: async () => (await api<{ schedules: ScheduleDto[] }>('/schedules')).schedules,
    refetchInterval: 30_000,
  });
}

export function useSaveSchedule() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: { id?: string; create?: ScheduleCreate; update?: ScheduleUpdate }) =>
      input.id
        ? api<ScheduleDto>(`/schedules/${input.id}`, { method: 'PATCH', body: input.update })
        : api<ScheduleDto>('/schedules', { method: 'POST', body: input.create }),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: keys.schedules });
      void client.invalidateQueries({ queryKey: keys.summary });
    },
  });
}

export function useToggleSchedule() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ id, enabled }: { id: string; enabled: boolean }) =>
      api<ScheduleDto>(`/schedules/${id}/${enabled ? 'enable' : 'disable'}`, { method: 'POST' }),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: keys.schedules });
      void client.invalidateQueries({ queryKey: keys.summary });
    },
  });
}

export function useDeleteSchedule() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api<void>(`/schedules/${id}`, { method: 'DELETE' }),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: keys.schedules });
      void client.invalidateQueries({ queryKey: keys.summary });
    },
  });
}

export function useScheduleExecutions(id: string) {
  return useQuery({
    queryKey: keys.executions(id),
    queryFn: async () =>
      (await api<{ executions: ScheduleExecutionDto[] }>(`/schedules/${id}/executions?limit=50`)).executions,
  });
}

export function useSchedulePreview(request: SchedulePreviewRequest | null) {
  return useQuery({
    queryKey: ['schedule-preview', request],
    queryFn: () => api<SchedulePreviewDto>('/schedules/preview', { method: 'POST', body: request }),
    enabled: request !== null,
    retry: false,
    staleTime: 15_000,
  });
}

/* ---------------------------- activity, settings -------------------------- */

export function useActivity(filters: Partial<ActivityQuery>) {
  return useQuery({
    queryKey: keys.activity(filters),
    queryFn: () => {
      const params = new URLSearchParams();
      for (const [key, value] of Object.entries(filters)) {
        if (value !== undefined && value !== '') params.set(key, String(value));
      }
      return api<ActivityListDto>(`/activity?${params.toString()}`);
    },
    refetchInterval: 10_000,
  });
}

export function useDiagnostics() {
  return useQuery({
    queryKey: keys.diagnostics,
    queryFn: () => api<DiagnosticsDto>('/system/status'),
    refetchInterval: 15_000,
  });
}

export function useConnectionReport() {
  return useQuery({
    queryKey: ['connection'],
    queryFn: () => api<ConnectionReportDto>('/connection/report'),
    refetchInterval: 30_000,
  });
}

/** Checking, sending and dismissing all answer with the new report. */
function useConnectionAction<Input>(call: (input: Input) => Promise<ConnectionReportDto>) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: call,
    onSuccess: (report) => client.setQueryData(['connection'], report),
    onSettled: () => {
      void client.invalidateQueries({ queryKey: keys.devices });
      void client.invalidateQueries({ queryKey: keys.summary });
    },
  });
}

export function useRunConnectionCheck() {
  return useConnectionAction(() =>
    api<{ ran: boolean; report: ConnectionReportDto }>('/connection/check', { method: 'POST' }).then((r) => r.report),
  );
}

export function useSendMissed() {
  return useConnectionAction((id: number) => api<ConnectionReportDto>(`/connection/missed/${id}/send`, { method: 'POST' }));
}

export function useDismissMissed() {
  return useConnectionAction((id: number) => api<ConnectionReportDto>(`/connection/missed/${id}/dismiss`, { method: 'POST' }));
}

/* ------------------------------- holidays -------------------------------- */

const HOLIDAYS_KEY = ['holidays'];

export function useHolidays() {
  return useQuery({
    queryKey: HOLIDAYS_KEY,
    queryFn: async () => (await api<{ holidays: HolidayDto[] }>('/holidays')).holidays,
    refetchInterval: 60_000,
  });
}

function useHolidayChange<Input>(call: (input: Input) => Promise<{ holidays: HolidayDto[] }>) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: call,
    onSuccess: ({ holidays }) => client.setQueryData(HOLIDAYS_KEY, holidays),
    onSettled: () => void client.invalidateQueries({ queryKey: keys.schedules }),
  });
}

export function useUpdateHoliday() {
  return useHolidayChange(({ key, update }: { key: string; update: HolidayUpdate }) =>
    api<{ holidays: HolidayDto[] }>(`/holidays/${key}`, { method: 'PATCH', body: update }),
  );
}

export function useSetHolidayEnabled() {
  return useHolidayChange(({ key, enabled }: { key: string; enabled: boolean }) =>
    api<{ holidays: HolidayDto[] }>(`/holidays/${key}/enabled`, { method: 'POST', body: { enabled } }),
  );
}

export function useSetHolidaySkipped() {
  return useHolidayChange(({ key, skip }: { key: string; skip: boolean }) =>
    api<{ holidays: HolidayDto[] }>(`/holidays/${key}/skip`, { method: 'POST', body: { skip } }),
  );
}

/* ----------------------------- notifications ----------------------------- */

const NOTIFICATIONS_KEY = ['notifications'];
const PUSH_KEY = ['notifications', 'push'];

export function useNotifications() {
  return useQuery({
    queryKey: NOTIFICATIONS_KEY,
    queryFn: () => api<NotificationListDto>('/notifications'),
    refetchInterval: 30_000,
  });
}

export function useRespondToNotification() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ id, action }: { id: number; action: NotificationAction }) =>
      api<NotificationDto>(`/notifications/${id}/respond`, { method: 'POST', body: { action } }),
    onSettled: () => {
      void client.invalidateQueries({ queryKey: NOTIFICATIONS_KEY });
      void client.invalidateQueries({ queryKey: HOLIDAYS_KEY });
    },
  });
}

export function useMarkAllNotificationsRead() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: () => api<NotificationListDto>('/notifications/read-all', { method: 'POST' }),
    onSuccess: (list) => client.setQueryData(NOTIFICATIONS_KEY, list),
  });
}

export function useSendTestNotification() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: () => api<NotificationDto>('/notifications/test', { method: 'POST' }),
    onSettled: () => void client.invalidateQueries({ queryKey: NOTIFICATIONS_KEY }),
  });
}

export function usePushStatus() {
  return useQuery({ queryKey: PUSH_KEY, queryFn: () => api<PushStatusDto>('/notifications/push') });
}

function usePushChange<Input>(call: (input: Input) => Promise<PushStatusDto>) {
  const client = useQueryClient();
  return useMutation({ mutationFn: call, onSuccess: (status) => client.setQueryData(PUSH_KEY, status) });
}

export function useSubscribePush() {
  return usePushChange((subscription: PushSubscribe) =>
    api<PushStatusDto>('/notifications/push/subscribe', { method: 'POST', body: subscription }),
  );
}

export function useUnsubscribePush() {
  return usePushChange((endpoint: string) =>
    api<PushStatusDto>('/notifications/push/unsubscribe', { method: 'POST', body: { endpoint } }),
  );
}

export function useRemovePushDevice() {
  return usePushChange((id: number) => api<PushStatusDto>(`/notifications/push/${id}`, { method: 'DELETE' }));
}

export function useSummary() {
  return useQuery({
    queryKey: keys.summary,
    queryFn: () => api<DashboardSummaryDto>('/dashboard/summary'),
    refetchInterval: 30_000,
  });
}

export function useSettings() {
  return useQuery({
    queryKey: keys.settings,
    queryFn: () => api<AppSettings>('/settings'),
    staleTime: 60_000,
  });
}

export function useUpdateSettings() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (changes: SettingsUpdate) => api<AppSettings>('/settings', { method: 'PATCH', body: changes }),
    onSuccess: (data) => {
      client.setQueryData(keys.settings, data);
      void client.invalidateQueries({ queryKey: ['connection'] });
    },
  });
}

/* ----------------------------------- AI ----------------------------------- */

export function useAiStatus() {
  return useQuery({ queryKey: ['ai', 'status'], queryFn: () => api<AiStatusDto>('/ai/status') });
}

export function useAiQuestions(limit = 5) {
  return useQuery({
    queryKey: ['ai', 'questions', limit],
    queryFn: () => api<AiQuestionListDto>(`/ai/questions?limit=${limit}`),
  });
}

export function useAskAi() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (question: string) => api<AiAnswerDto>('/ai/ask', { method: 'POST', body: { question } }),
    // Spend and provider health change with every question, answered or not.
    onSettled: () => client.invalidateQueries({ queryKey: ['ai'] }),
  });
}
