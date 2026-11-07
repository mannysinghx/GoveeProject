import { Bell, BellOff, Check, Send, Trash2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import type { AppSettings, NotificationDto } from '@glm/shared';
import { Badge, Button, EmptyState, ErrorNotice, Loading, Notice, PageHeader, SectionCard } from '../../components/ui';
import { timeAgo } from '../../lib/format';
import { currentEndpoint, pushSupport, subscribeThisDevice, unsubscribeThisDevice } from '../../lib/push';
import {
  useMarkAllNotificationsRead,
  useNotifications,
  usePushStatus,
  useRemovePushDevice,
  useRespondToNotification,
  useSendTestNotification,
  useSettings,
  useSubscribePush,
  useUnsubscribePush,
  useUpdateSettings,
} from '../../lib/queries';

const ANSWER_TEXT: Record<NonNullable<NotificationDto['answer']>, string> = {
  looks_right: 'You said it looks right',
  didnt_change: "You said it didn't change",
  skip: 'Skipped',
};

const SEVERITY_TONE = { info: 'info', good: 'good', warn: 'warn', bad: 'bad' } as const;
const SEVERITY_LABEL: Record<NotificationDto['severity'], string> = {
  info: 'Update',
  good: 'Resolved',
  warn: 'Needs a look',
  bad: 'Problem',
};

function NotificationItem({ notification }: { notification: NotificationDto }) {
  const respond = useRespondToNotification();
  const unread = notification.readAt === null;
  return (
    <li className={`rounded-lg p-3 ${unread ? 'border border-amber-soft/40 bg-ink-850' : 'bg-ink-850/60'}`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="min-w-0 font-medium break-words">{notification.title}</h3>
        <Badge tone={SEVERITY_TONE[notification.severity]}>{SEVERITY_LABEL[notification.severity]}</Badge>
      </div>
      <p className="mt-1 text-sm whitespace-pre-line text-ink-300">{notification.body}</p>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        {notification.answer ? (
          <Badge tone="neutral" icon={<Check className="size-3" aria-hidden />}>
            {ANSWER_TEXT[notification.answer]}
          </Badge>
        ) : (
          notification.actions.map(({ action, label }) => (
            <Button
              key={action}
              size="sm"
              aria-label={`${label}: ${notification.title}`}
              busy={respond.isPending}
              onClick={() => respond.mutate({ id: notification.id, action })}
            >
              {label}
            </Button>
          ))
        )}
        {notification.link !== '/notifications' ? (
          <Link to={notification.link} className="text-xs text-amber-soft underline underline-offset-2">
            Open
          </Link>
        ) : null}
        <span className="ml-auto text-xs text-ink-400">{timeAgo(notification.createdAt)}</span>
      </div>
      {respond.isError ? (
        <div className="mt-2">
          <ErrorNotice error={respond.error} />
        </div>
      ) : null}
    </li>
  );
}

/** Turning push on must come from a tap, and each device says something different about it. */
function ThisDevice() {
  const status = usePushStatus();
  const subscribe = useSubscribePush();
  const unsubscribe = useUnsubscribePush();
  const test = useSendTestNotification();
  const remove = useRemovePushDevice();
  const [endpoint, setEndpoint] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const support = pushSupport();

  useEffect(() => {
    void currentEndpoint()
      .then(setEndpoint)
      .catch(() => setEndpoint(null));
  }, []);

  const turnOn = async () => {
    if (!status.data) return;
    setProblem(null);
    setBusy(true);
    try {
      const subscription = await subscribeThisDevice(status.data.publicKey);
      await subscribe.mutateAsync(subscription);
      setEndpoint(subscription.endpoint);
    } catch (error) {
      setProblem(error instanceof Error ? error.message : 'Could not turn on notifications.');
    } finally {
      setBusy(false);
    }
  };

  const turnOff = async () => {
    setProblem(null);
    setBusy(true);
    try {
      const gone = await unsubscribeThisDevice();
      if (gone) await unsubscribe.mutateAsync(gone);
      setEndpoint(null);
    } catch (error) {
      setProblem(error instanceof Error ? error.message : 'Could not turn off notifications.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <SectionCard
      title="Phone and browser alerts"
      description="Everything below always appears here in the app. Turn this on to also get it as a notification on this device, even with the app closed."
    >
      <div className="space-y-3">
        {support === 'needs_install' ? (
          <Notice title="On iPhone, add this app to your Home Screen first">
            Apple only allows notifications for apps on the Home Screen, on iOS 16.4 or later. In Safari, tap Share, then Add to
            Home Screen. Open the app from that icon, sign in, and return here.
          </Notice>
        ) : null}
        {support === 'unsupported' ? <Notice tone="warn">This browser can't receive push notifications.</Notice> : null}
        {support === 'denied' ? (
          <Notice tone="warn" title="Notifications are blocked for this site">
            Allow them in this browser's site settings, then reload this page.
          </Notice>
        ) : null}
        {support === 'supported' ? (
          <div className="flex flex-wrap gap-2">
            {endpoint ? (
              <Button icon={<BellOff className="size-4" aria-hidden />} busy={busy} onClick={() => void turnOff()}>
                Turn off on this device
              </Button>
            ) : (
              <Button variant="primary" icon={<Bell className="size-4" aria-hidden />} busy={busy} disabled={!status.data} onClick={() => void turnOn()}>
                Turn on for this device
              </Button>
            )}
            <Button icon={<Send className="size-4" aria-hidden />} busy={test.isPending} onClick={() => test.mutate()}>
              Send a test
            </Button>
          </div>
        ) : null}
        {problem ? <Notice tone="warn">{problem}</Notice> : null}
        {status.isError ? <ErrorNotice error={status.error} /> : null}
        {test.isError ? <ErrorNotice error={test.error} /> : null}
        {test.isSuccess ? (
          <p className="text-sm text-ink-300" role="status">
            Test sent. It appears below{(status.data?.devices.length ?? 0) > 0 ? ', and on your devices within a few seconds' : ''}.
          </p>
        ) : null}

        {status.data && status.data.devices.length > 0 ? (
          <div>
            <h3 className="mb-1 text-sm font-medium text-ink-200">Devices with alerts on</h3>
            <ul className="space-y-1">
              {status.data.devices.map((device) => (
                <li key={device.id} className="flex flex-wrap items-center gap-2 rounded-lg bg-ink-850 p-2 text-sm">
                  <span className="font-medium">{device.label}</span>
                  <span className="text-xs text-ink-400">
                    {device.lastError
                      ? device.lastError
                      : device.lastSuccessAt
                        ? `Last delivered to the push service ${timeAgo(device.lastSuccessAt)}`
                        : 'Nothing sent yet'}
                  </span>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="ml-auto"
                    aria-label={`Remove ${device.label}`}
                    icon={<Trash2 className="size-4" aria-hidden />}
                    busy={remove.isPending}
                    onClick={() => remove.mutate(device.id)}
                  />
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </div>
    </SectionCard>
  );
}

const CHOICES: { key: keyof Pick<AppSettings, 'notifyScheduleStarts' | 'notifyPatternStarts' | 'notifyHeadsUp' | 'notifyProblems'>; label: string; help: string }[] = [
  { key: 'notifyScheduleStarts', label: 'When a schedule starts', help: 'Includes your daily schedules. Later steps of a holiday show stay quiet.' },
  { key: 'notifyPatternStarts', label: 'When a pattern or preset starts', help: 'Including ones you send yourself.' },
  { key: 'notifyHeadsUp', label: 'Holiday heads-up', help: '15 minutes before a holiday show, with a button to skip it.' },
  { key: 'notifyProblems', label: 'Problems', help: "A run that didn't fully start, or a light going offline and coming back." },
];

function Choices() {
  const settings = useSettings();
  const update = useUpdateSettings();
  if (!settings.data) return null;
  const values = settings.data;
  return (
    <SectionCard title="What to tell you about">
      <div className="space-y-2">
        {CHOICES.map(({ key, label, help }) => (
          <label key={key} className="flex min-h-9 items-start gap-2 text-sm">
            <input
              type="checkbox"
              className="mt-0.5 size-4"
              checked={values[key]}
              disabled={update.isPending}
              onChange={(event) => update.mutate({ [key]: event.target.checked })}
            />
            <span>
              <span className="block font-medium">{label}</span>
              <span className="block text-xs text-ink-400">{help}</span>
            </span>
          </label>
        ))}
        {update.isError ? <ErrorNotice error={update.error} title="The choice was not saved" /> : null}
      </div>
    </SectionCard>
  );
}

export function NotificationsPage() {
  const notifications = useNotifications();
  const markRead = useMarkAllNotificationsRead();
  const unread = notifications.data?.unread ?? 0;

  return (
    <>
      <PageHeader
        title="Notifications"
        description="What your lights have been doing, and a quick way to say whether it looked right."
        actions={
          <Button disabled={unread === 0} busy={markRead.isPending} onClick={() => markRead.mutate()}>
            Mark all read
          </Button>
        }
      />
      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="min-w-0 space-y-4">
          <Notice title="Lights Check">
            Govee can only say it accepted a command, not that your lights changed. So each notification shows the colors that
            were sent, and asks you. Your answers are kept in Activity, and "Didn't change" starts a connection check.
          </Notice>
          {notifications.isPending ? <Loading label="Loading notifications" /> : null}
          {notifications.isError ? <ErrorNotice error={notifications.error} /> : null}
          {markRead.isError ? <ErrorNotice error={markRead.error} /> : null}
          {notifications.data?.items.length === 0 ? (
            <EmptyState icon={<Bell className="size-8" aria-hidden />} title="Nothing yet">
              You'll see an update here when a schedule or pattern starts.
            </EmptyState>
          ) : null}
          {notifications.data && notifications.data.items.length > 0 ? (
            <ul className="space-y-2">
              {notifications.data.items.map((notification) => (
                <NotificationItem key={notification.id} notification={notification} />
              ))}
            </ul>
          ) : null}
        </div>
        <div className="space-y-5">
          <ThisDevice />
          <Choices />
        </div>
      </div>
    </>
  );
}
