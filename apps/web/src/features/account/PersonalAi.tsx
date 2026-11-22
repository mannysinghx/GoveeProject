import { useEffect, useState, type FormEvent } from 'react';
import { aiProviderIds, type AiProviderId, type PersonalAiDto } from '@glm/shared';
import { Button, ErrorNotice, Field, inputClass, Loading, Notice } from '../../components/ui';
import { dateTime } from '../../lib/format';
import { AiKeyGuideList } from './KeyGuide';
import { useConnectAiKey, usePersonalAi, useRemoveAiKey, useSetAiLimit } from './queries';

const LABELS: Record<AiProviderId, string> = { deepseek: 'DeepSeek', gemini: 'Google Gemini', glm: 'Z.ai GLM' };

/** One provider at a time: pick it, a model with a listed price, and paste the key. */
function AddKeyForm({ data }: { data: PersonalAiDto }) {
  const connect = useConnectAiKey();
  const [provider, setProvider] = useState<AiProviderId>(aiProviderIds[0]);
  const [model, setModel] = useState(data.models[aiProviderIds[0]][0] ?? '');
  const [apiKey, setApiKey] = useState('');
  const [error, setError] = useState<unknown>(null);

  const choose = (next: AiProviderId) => {
    setProvider(next);
    setModel(data.models[next][0] ?? '');
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    connect.mutate(
      { provider, model, apiKey: apiKey.trim() },
      {
        // The key leaves the page either way: the field is emptied and the request forgotten.
        onSettled: (_data, failure) => {
          setApiKey('');
          setError(failure ?? null);
          connect.reset();
        },
      },
    );
  };

  return (
    <form onSubmit={submit} className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Provider">
          {(props) => (
            <select {...props} className={inputClass} value={provider} onChange={(e) => choose(e.target.value as AiProviderId)}>
              {aiProviderIds.map((id) => (
                <option key={id} value={id}>
                  {LABELS[id]}
                </option>
              ))}
            </select>
          )}
        </Field>
        <Field label="Model">
          {(props) => (
            <select {...props} className={inputClass} value={model} onChange={(e) => setModel(e.target.value)}>
              {data.models[provider].map((name) => (
                <option key={name} value={name}>
                  {name}
                </option>
              ))}
            </select>
          )}
        </Field>
      </div>
      <Field label={`${LABELS[provider]} API key`} hint="Checked with one tiny request before it is saved, then stored encrypted and never shown again. A new key for a provider replaces the old one.">
        {(props) => (
          <input
            {...props}
            type="password"
            autoComplete="off"
            spellCheck={false}
            className={`${inputClass} font-mono`}
            required
            minLength={8}
            maxLength={300}
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
          />
        )}
      </Field>
      {error ? <ErrorNotice error={error} title="The key was not added" /> : null}
      <Button type="submit" variant="primary" busy={connect.isPending}>
        {connect.isPending ? 'Checking the key…' : 'Add key'}
      </Button>
    </form>
  );
}

function MonthlyLimit({ data }: { data: PersonalAiDto }) {
  const update = useSetAiLimit();
  const [value, setValue] = useState(String(data.monthlyLimitUsd));
  useEffect(() => setValue(String(data.monthlyLimitUsd)), [data.monthlyLimitUsd]);
  return (
    <form
      className="flex flex-wrap items-end gap-3"
      onSubmit={(event) => {
        event.preventDefault();
        update.mutate(Number(value));
      }}
    >
      <Field label="Monthly spending limit (USD)" hint="AI stops for the month when your keys have cost about this much. Your provider bills you, not this app.">
        {(props) => (
          <input
            {...props}
            type="number"
            min={0}
            max={data.monthlyLimitMaxUsd}
            step="0.5"
            className={`${inputClass} w-32`}
            required
            value={value}
            onChange={(e) => setValue(e.target.value)}
          />
        )}
      </Field>
      <Button type="submit" busy={update.isPending}>
        Save limit
      </Button>
      {update.isError ? <ErrorNotice error={update.error} /> : null}
    </form>
  );
}

/** A member's own AI keys. Without one, AI is off for them. */
export function PersonalAiKeys() {
  const personal = usePersonalAi();
  const remove = useRemoveAiKey();
  if (personal.isPending) return <Loading label="Loading your AI keys" />;
  if (personal.isError) return <ErrorNotice error={personal.error} />;
  const data = personal.data;

  return (
    <div className="space-y-4">
      {data.keys.length > 0 ? (
        <ul className="space-y-2">
          {data.keys.map((key) => (
            <li key={key.provider} className="flex flex-wrap items-center gap-2 rounded-lg bg-ink-850 p-2.5 text-sm">
              <span className="font-medium text-ink-100">{key.label}</span>
              <span className="font-mono text-xs text-ink-300">{key.model}</span>
              <span className="text-xs text-ink-400">added {dateTime(key.connectedAt)}</span>
              <Button size="sm" variant="danger" className="ml-auto" busy={remove.isPending} onClick={() => remove.mutate(key.provider)}>
                Remove
              </Button>
            </li>
          ))}
        </ul>
      ) : (
        <Notice tone="info">AI is off until you add a key of your own from DeepSeek, Google Gemini or Z.ai.</Notice>
      )}
      {remove.isError ? <ErrorNotice error={remove.error} /> : null}
      {data.canAddKeys ? (
        <details className="text-sm text-ink-300">
          <summary className="cursor-pointer select-none font-medium text-ink-100">Where to get a key, and which model to pick</summary>
          <div className="pt-2">
            <AiKeyGuideList signedIn />
          </div>
        </details>
      ) : null}
      {data.canAddKeys ? <AddKeyForm data={data} /> : null}
      {!data.canAddKeys ? <Notice tone="warn">This server cannot store keys yet. Its owner needs to set CREDENTIAL_KEYS.</Notice> : null}
      <MonthlyLimit data={data} />
    </div>
  );
}
