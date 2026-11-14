import { useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { ErrorNotice, Loading } from '../components/ui';
import { LoginPage } from '../features/auth/LoginPage';
import { SetupPage } from '../features/auth/SetupPage';
import { useSession } from '../features/auth/useSession';
import { ActivityPage } from '../features/activity/ActivityPage';
import { ConnectPage } from '../features/dashboard/ConnectPage';
import { ConnectionPage } from '../features/connection/ConnectionPage';
import { LightsCheckPage } from '../features/lights-check/LightsCheckPage';
import { DashboardPage } from '../features/dashboard/DashboardPage';
import { NotificationsPage } from '../features/notifications/NotificationsPage';
import { DeviceDetailPage } from '../features/devices/DeviceDetailPage';
import { GroupsPage } from '../features/groups/GroupsPage';
import { PatternEditorPage } from '../features/patterns/PatternEditorPage';
import { PresetsPage } from '../features/presets/PresetsPage';
import { SchedulesPage } from '../features/schedules/SchedulesPage';
import { SettingsPage } from '../features/settings/SettingsPage';
import { setUnauthenticatedHandler } from '../lib/api';
import { keys } from '../lib/queries';
import { AppShell } from './AppShell';

export function App() {
  const session = useSession();
  const client = useQueryClient();

  useEffect(() => {
    setUnauthenticatedHandler(() => {
      void client.invalidateQueries({ queryKey: keys.session });
    });
    return () => setUnauthenticatedHandler(null);
  }, [client]);

  if (session.isPending) return <Loading label="Starting" />;
  if (session.isError || !session.data) {
    return (
      <main className="mx-auto max-w-lg p-6">
        <ErrorNotice error={session.error} title="Could not reach the app server" />
      </main>
    );
  }

  if (session.data.setupRequired) return <SetupPage setupCodeRequired={session.data.setupCodeRequired} />;
  if (!session.data.authenticated) return <LoginPage />;

  return (
    <AppShell username={session.data.username ?? ''}>
      <Routes>
        <Route path="/" element={<DashboardPage />} />
        <Route path="/connect" element={<ConnectPage />} />
        <Route path="/devices/:id" element={<DeviceDetailPage />} />
        <Route path="/presets" element={<PresetsPage />} />
        <Route path="/patterns/new" element={<PatternEditorPage />} />
        <Route path="/patterns/check" element={<LightsCheckPage />} />
        <Route path="/patterns/:presetId" element={<PatternEditorPage />} />
        <Route path="/groups" element={<GroupsPage />} />
        <Route path="/schedules" element={<SchedulesPage />} />
        <Route path="/activity" element={<ActivityPage />} />
        <Route path="/connections" element={<ConnectionPage />} />
        <Route path="/notifications" element={<NotificationsPage />} />
        <Route path="/settings" element={<SettingsPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </AppShell>
  );
}
