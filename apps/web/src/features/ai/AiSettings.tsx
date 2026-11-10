import { Badge, ErrorNotice, Loading, Notice, SectionCard } from '../../components/ui';
import { useAiStatus } from '../../lib/queries';

/** What is set up, what it has cost this month, and where questions go. Keys are never shown. */
export function AiSettings() {
  const status = useAiStatus();
  const data = status.data;
  return (
    <SectionCard
      title="AI"
      description="Used by Ask, on the Connections and Activity pages. Providers take turns, one question each, and the next one is tried if one fails."
    >
      {status.isPending ? <Loading label="Loading AI status" /> : null}
      {status.isError ? <ErrorNotice error={status.error} /> : null}
      {data ? (
        <div className="space-y-4">
          {data.reason === 'disabled' ? <Notice tone="info">AI is turned off on this server (AI_ENABLED=false).</Notice> : null}
          {data.reason === 'no_providers' ? (
            <Notice tone="info">
              No provider is set up. Add one or more of DEEPSEEK_API_KEY, GEMINI_API_KEY and GLM_API_KEY to the server&apos;s
              settings and restart the app.
            </Notice>
          ) : null}
          {data.providers.length > 0 ? (
            <ul className="space-y-2">
              {data.providers.map((p) => (
                <li key={p.id} className="flex flex-wrap items-center gap-2 rounded-lg bg-ink-850 p-2.5 text-sm">
                  <span className="font-medium text-ink-100">{p.label}</span>
                  <span className="font-mono text-xs text-ink-300">{p.model}</span>
                  {p.available ? <Badge tone="good">Ready</Badge> : <Badge tone="warn">Resting after an error</Badge>}
                  {p.note ? <span className="w-full text-xs text-ink-400">{p.note}</span> : null}
                </li>
              ))}
            </ul>
          ) : null}
          <p className="text-sm text-ink-200">
            This month: about ${data.monthSpentUsd.toFixed(4)} of the ${data.monthlyLimitUsd.toFixed(2)} limit. Free models count at
            their paid price, so the limit never depends on a free allowance.
          </p>
          <Notice tone="info" title="What is sent">
            Your question, and the records needed to answer it: light, schedule and preset names, runs, commands and connection
            history. Never your Govee key, sign-in history, location or Govee device ids. DeepSeek processes data in China. On
            Gemini&apos;s free tier, Google may use it to improve its products. Z.ai processes data in Singapore.
          </Notice>
        </div>
      ) : null}
    </SectionCard>
  );
}
