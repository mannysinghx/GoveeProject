import { ExternalLink } from 'lucide-react';
import type { ReactNode } from 'react';
import { AI_KEY_GUIDES, AI_PERSONAL_LIMIT_DEFAULT_USD, GOVEE_KEY_HELP_URL, type AiKeyGuide } from '@glm/shared';

/*
 * How to get each key, before or after signing up. The Govee steps follow Govee's own guide
 * (GOVEE_KEY_HELP_URL); the AI list, its prices and recommended models come from
 * AI_KEY_GUIDES in shared, which a server test keeps in step with what is counted.
 */

function OutLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <a href={href} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-accent-text underline underline-offset-2">
      {children}
      <ExternalLink className="size-3" aria-hidden />
    </a>
  );
}

function price(guide: AiKeyGuide): string {
  if (guide.price.input === 0 && guide.price.output === 0) return 'Free';
  const usd = (n: number) => `$${n.toFixed(2)}`;
  return `${usd(guide.price.input)} in, ${usd(guide.price.output)} out, per million tokens`;
}

export function GoveeKeySteps() {
  return (
    <div className="space-y-2">
      <ol className="list-decimal space-y-1 pl-5">
        <li>In the Govee Home app, tap the profile icon, then the gear at the top right for Settings.</li>
        <li>Choose Apply for API Key, enter your name and a reason (such as &quot;home lighting schedules&quot;), and accept Govee&apos;s terms.</li>
        <li>Govee emails the key to the address on your Govee account, usually within minutes.</li>
      </ol>
      <p>
        Each Govee account has one key at a time: applying again replaces the old one, so anything else using it stops working.{' '}
        <OutLink href={GOVEE_KEY_HELP_URL}>Govee&apos;s guide</OutLink>
      </p>
    </div>
  );
}

/** `signedIn` drops the parts that only make sense before an account exists. */
export function AiKeyGuideList({ signedIn = false }: { signedIn?: boolean }) {
  return (
    <div className="space-y-2">
      <p>
        {signedIn ? null : 'Optional. Ask and Describe use an AI provider with your own key, and are off without one. '}
        Lowest cost first, with the model to pick:
      </p>
      <ul className="space-y-2">
        {AI_KEY_GUIDES.map((guide) => (
          <li key={guide.provider} className="rounded-lg bg-inset p-2.5">
            <div className="flex flex-wrap items-baseline justify-between gap-x-2">
              <OutLink href={guide.keyUrl}>{guide.label}: create a key</OutLink>
              <span className="text-xs text-fg-4">{price(guide)}</span>
            </div>
            <p className="mt-1">
              Model: <span className="font-mono text-fg">{guide.recommendedModel}</span>. {guide.note}
            </p>
          </li>
        ))}
      </ul>
      {signedIn ? null : (
        <p>
          Add the key after signing in, in Settings under AI. Your provider bills you, not this app, and AI stops for the month
          at the limit you set there (${AI_PERSONAL_LIMIT_DEFAULT_USD} to start).
        </p>
      )}
    </div>
  );
}

/** On the sign-up page: what to have ready, folded away so the form stays short. */
export function WhatYouNeed() {
  return (
    <div className="mt-5 space-y-2 border-t border-line pt-4 text-sm text-fg-3">
      <h2 className="text-sm font-semibold text-fg">What you will need</h2>
      <details>
        <summary className="cursor-pointer select-none py-1 font-medium text-fg">A Govee API key, to control your lights</summary>
        <div className="pb-2 pt-1">
          <GoveeKeySteps />
        </div>
      </details>
      <details>
        <summary className="cursor-pointer select-none py-1 font-medium text-fg">An AI key, if you want AI (low-cost models)</summary>
        <div className="pb-2 pt-1">
          <AiKeyGuideList />
        </div>
      </details>
    </div>
  );
}
