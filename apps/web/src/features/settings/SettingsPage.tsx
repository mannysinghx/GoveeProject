import { useEffect, useState, type FormEvent } from 'react';
import type { AppSettings } from '@glm/shared';
import { Button, ErrorNotice, Field, inputClass, Loading, Notice, PageHeader, SectionCard } from '../../components/ui';
import { timeZoneOptions } from '../../lib/format';
import { useDiagnostics, useSettings, useUpdateSettings } from '../../lib/queries';
import { PASSWORD_MIN_LENGTH, useChangePassword } from '../auth/useSession';

function GeneralSettings({ settings }: { settings: AppSettings }) {
  const update = useUpdateSettings();
  const [form, setForm] = useState(settings);
  const [latitude, setLatitude] = useState(settings.latitude?.toString() ?? '');
  const [longitude, setLongitude] = useState(settings.longitude?.toString() ?? '');
  const browserZone = Intl.DateTimeFormat().resolvedOptions().timeZone;

  useEffect(() => {
    setForm(settings);
  }, [settings]);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    // These are edited on their own screens. A stale copy here must not overwrite them.
    const {
      patternStrings: _patternStrings,
      catchUpEnabled: _catchUpEnabled,
      notifyScheduleStarts: _notifyScheduleStarts,
      notifyPatternStarts: _notifyPatternStarts,
      notifyHeadsUp: _notifyHeadsUp,
      notifyProblems: _notifyProblems,
      ...rest
    } = form;
    update.mutate({
      ...rest,
      latitude: latitude === '' ? null : Number(latitude),
      longitude: longitude === '' ? null : Number(longitude),
    });
  };

  return (
    <SectionCard title="General">
      <form onSubmit={submit} className="space-y-4">
        <Field
          label="Default time zone for new schedules"
          hint={form.defaultTimeZone !== browserZone ? `This browser is in ${browserZone}.` : undefined}
        >
          {(props) => (
            <select
              {...props}
              className={inputClass}
              value={form.defaultTimeZone}
              onChange={(e) => setForm({ ...form, defaultTimeZone: e.target.value })}
            >
              {timeZoneOptions(form.defaultTimeZone).map((zone) => (
                <option key={zone} value={zone}>
                  {zone}
                </option>
              ))}
            </select>
          )}
        </Field>

        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Status check interval (seconds)" hint="How often an open dashboard asks Govee for status. Minimum 30.">
            {(props) => (
              <input
                {...props}
                type="number"
                min={30}
                max={3600}
                className={inputClass}
                value={form.statusPollSeconds}
                onChange={(e) => setForm({ ...form, statusPollSeconds: Number(e.target.value) })}
              />
            )}
          </Field>
          <Field label="Mark status stale after (seconds)">
            {(props) => (
              <input
                {...props}
                type="number"
                min={60}
                max={86400}
                className={inputClass}
                value={form.staleAfterSeconds}
                onChange={(e) => setForm({ ...form, staleAfterSeconds: Number(e.target.value) })}
              />
            )}
          </Field>
          <Field label="Sliders send">
            {(props) => (
              <select
                {...props}
                className={inputClass}
                value={form.sliderSendMode}
                onChange={(e) => setForm({ ...form, sliderSendMode: e.target.value as AppSettings['sliderSendMode'] })}
              >
                <option value="release">When released</option>
                <option value="interval">While dragging, at an interval</option>
              </select>
            )}
          </Field>
          {form.sliderSendMode === 'interval' ? (
            <Field label="Slider interval (milliseconds)" hint="500 to 5000.">
              {(props) => (
                <input
                  {...props}
                  type="number"
                  min={500}
                  max={5000}
                  className={inputClass}
                  value={form.sliderIntervalMs}
                  onChange={(e) => setForm({ ...form, sliderIntervalMs: Number(e.target.value) })}
                />
              )}
            </Field>
          ) : null}
        </div>

        <fieldset>
          <legend className="mb-2 text-sm font-medium text-ink-200">Location for sunrise and sunset schedules (optional)</legend>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Latitude" hint="Entered by hand. Nothing is looked up or sent anywhere.">
              {(props) => (
                <input {...props} type="number" step="any" min={-90} max={90} className={inputClass} value={latitude} onChange={(e) => setLatitude(e.target.value)} />
              )}
            </Field>
            <Field label="Longitude">
              {(props) => (
                <input {...props} type="number" step="any" min={-180} max={180} className={inputClass} value={longitude} onChange={(e) => setLongitude(e.target.value)} />
              )}
            </Field>
          </div>
        </fieldset>

        {update.isError ? <ErrorNotice error={update.error} title="Settings were not saved" /> : null}
        {update.isSuccess ? <Notice tone="good">Settings saved.</Notice> : null}
        <Button type="submit" variant="primary" busy={update.isPending}>
          Save settings
        </Button>
      </form>
    </SectionCard>
  );
}

function ChangePassword() {
  const change = useChangePassword();
  const [currentPassword, setCurrent] = useState('');
  const [newPassword, setNew] = useState('');
  const [confirm, setConfirm] = useState('');
  const mismatch = confirm !== '' && newPassword !== confirm;

  return (
    <SectionCard title="Change password" description="Other signed-in browsers are signed out when you change it.">
      <form
        className="max-w-md space-y-4"
        onSubmit={(event) => {
          event.preventDefault();
          if (newPassword !== confirm) return;
          change.mutate(
            { currentPassword, newPassword },
            {
              onSuccess: () => {
                setCurrent('');
                setNew('');
                setConfirm('');
              },
            },
          );
        }}
      >
        <Field label="Current password">
          {(props) => (
            <input {...props} type="password" autoComplete="current-password" className={inputClass} required value={currentPassword} onChange={(e) => setCurrent(e.target.value)} />
          )}
        </Field>
        <Field label="New password" hint={`At least ${PASSWORD_MIN_LENGTH} characters.`}>
          {(props) => (
            <input {...props} type="password" autoComplete="new-password" minLength={PASSWORD_MIN_LENGTH} className={inputClass} required value={newPassword} onChange={(e) => setNew(e.target.value)} />
          )}
        </Field>
        <Field label="Confirm new password" error={mismatch ? 'The two passwords do not match.' : null}>
          {(props) => (
            <input {...props} type="password" autoComplete="new-password" className={inputClass} required value={confirm} onChange={(e) => setConfirm(e.target.value)} />
          )}
        </Field>
        {change.isError ? <ErrorNotice error={change.error} /> : null}
        {change.isSuccess ? <Notice tone="good">Password changed.</Notice> : null}
        <Button type="submit" busy={change.isPending} disabled={mismatch}>
          Change password
        </Button>
      </form>
    </SectionCard>
  );
}

function ServerConfiguration() {
  const diagnostics = useDiagnostics();
  return (
    <SectionCard title="Govee API key">
      {diagnostics.data ? (
        diagnostics.data.govee.keyConfigured ? (
          <Notice tone="good">A key is configured on the server. It is never shown here or sent to this browser.</Notice>
        ) : (
          <Notice tone="warn">No key is configured.</Notice>
        )
      ) : null}
      <p className="mt-3 text-sm text-ink-300">
        To change the key, edit <code className="font-mono text-ink-100">GOVEE_API_KEY</code> in the server's{' '}
        <code className="font-mono text-ink-100">.env</code> file and restart the app. Applying for a new key in the Govee
        app may invalidate the old one, along with anything else using it.
      </p>
    </SectionCard>
  );
}

export function SettingsPage() {
  const settings = useSettings();
  return (
    <>
      <PageHeader title="Settings" />
      {settings.isPending ? <Loading label="Loading settings" /> : null}
      {settings.isError ? <ErrorNotice error={settings.error} /> : null}
      <div className="max-w-3xl space-y-5">
        {settings.data ? <GeneralSettings settings={settings.data} /> : null}
        <ServerConfiguration />
        <ChangePassword />
      </div>
    </>
  );
}
