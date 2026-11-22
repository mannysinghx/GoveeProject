import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { Ambient } from '../../components/Ambient';
import { BrandMark } from '../../components/Brand';
import { useInShell } from '../../components/shell-context';
import { Card, Notice } from '../../components/ui';
import { useDocumentTitle, withAppName } from '../../lib/hooks';

/*
 * The privacy page says what the code does, and nothing it does not. Keep it in step with the
 * code: docs/security.md lists the same things. Neither page has been reviewed by a lawyer
 * (docs/public-signup-plan.md, P8), which the draft notice says.
 */

const CONTACT = 'info@lightup.ink';

function LegalPage({ title, children }: { title: string; children: ReactNode }) {
  // Signed in, the page is drawn inside the app's shell, which supplies the page landmark, glow and tab title.
  const inShell = useInShell();
  useDocumentTitle(inShell ? null : withAppName(title));
  const Frame = inShell ? 'div' : 'main';
  return (
    <Frame className="relative mx-auto max-w-2xl p-4 py-8 sm:p-6 sm:py-10">
      {inShell ? null : <Ambient colors={[]} />}
      <Card className="space-y-4 rounded-[2rem] p-6 text-sm leading-relaxed text-fg-2 sm:p-9">
        <div className="flex items-center gap-3">
          <BrandMark size={36} />
          <h1 className="font-display text-2xl font-semibold tracking-tight text-fg">{title}</h1>
        </div>
        <Notice tone="warn" title="Draft">
          This page has not yet been reviewed by a lawyer. It will be replaced by a reviewed version before sign-up opens to the
          public.
        </Notice>
        {children}
        <p className="pt-2">
          <Link to="/" className="text-accent-text underline underline-offset-2">
            Back to Light Manager
          </Link>
        </p>
      </Card>
    </Frame>
  );
}

function H2({ children }: { children: ReactNode }) {
  return <h2 className="pt-3 font-display text-lg font-semibold tracking-tight text-fg">{children}</h2>;
}

export function PrivacyPage() {
  return (
    <LegalPage title="Privacy">
      <p>Light Manager controls Govee lights through Govee&apos;s official API. This is what it keeps and where it sends it.</p>

      <H2>What is stored</H2>
      <ul className="list-disc space-y-1 pl-5">
        <li>Your email address, and a secure one-way hash of your password. The password itself is never stored.</li>
        <li>Sign-in history: when you signed in and from which network address, kept to protect your account.</li>
        <li>Your Govee API key and any AI keys you add, encrypted. They are never shown again, not even to you.</li>
        <li>Your lights as Govee reports them, and the groups, presets and schedules you make.</li>
        <li>What the app did and what Govee answered, for 90 days.</li>
        <li>If you type them in, a latitude and longitude for sunrise and sunset times. Nothing is looked up.</li>
        <li>If you turn on phone alerts, the address your browser gives for them.</li>
      </ul>

      <H2>Where it goes</H2>
      <ul className="list-disc space-y-1 pl-5">
        <li>Govee, with your key, to read and control your lights.</li>
        <li>
          If you add an AI key: the provider you chose (DeepSeek, Google or Z.ai), with your key. A question sends it, and the
          records needed to answer it: names of your lights, schedules and presets, runs, commands and connection history. Never
          your Govee key, sign-in history or location. DeepSeek processes data in China; on Gemini&apos;s free tier Google may
          use it to improve its products; Z.ai processes data in Singapore.
        </li>
        <li>Sign-up, password and address emails, sent through our email provider.</li>
        <li>Phone alerts, if you turn them on, through your browser&apos;s push service.</li>
      </ul>
      <p>
        There are no ads, no analytics, and no scripts from anyone else. The only cookie is the one that keeps you signed in. Each
        account&apos;s lights and records are kept apart from every other account&apos;s.
      </p>

      <H2>What you share</H2>
      <p>
        If you share a preset, group or schedule, everyone with an account can see it and import a copy: its name, description,
        colours and timing, the model of each light it uses with the name you give it, and your display name. Your email address,
        your lights and their names, and your location are not shared. Stopping a share, or deleting your account, removes it from
        the Shared space; copies people already imported stay theirs.
      </p>

      <H2>Your choices</H2>
      <p>
        In Settings you can download everything in your account, remove your keys, and delete your account. Deleting it removes
        your sign-in, keys, lights, schedules and history. Copies in backups made before then stay with the server&apos;s owner until those backups are deleted.
      </p>

      <H2>Contact</H2>
      <p>
        <a href={`mailto:${CONTACT}`} className="text-accent-text underline underline-offset-2">
          {CONTACT}
        </a>
      </p>
    </LegalPage>
  );
}

export function TermsPage() {
  return (
    <LegalPage title="Terms">
      <p>Light Manager is a small, independent app. It is not made by or connected with Govee.</p>
      <ul className="list-disc space-y-1 pl-5">
        <li>Use it only with your own lights and your own Govee and AI keys.</li>
        <li>You are responsible for what your schedules do, and for any charges from your AI provider.</li>
        <li>Do not use it to overload Govee, the AI providers or this server. Accounts that do may be suspended.</li>
        <li>It is provided as is, without guarantees. Schedules can be missed when Govee or this server is down.</li>
        <li>Accounts, or the service, may be suspended or ended. You can download your data in Settings at any time.</li>
      </ul>
      <p>
        Questions:{' '}
        <a href={`mailto:${CONTACT}`} className="text-accent-text underline underline-offset-2">
          {CONTACT}
        </a>
      </p>
    </LegalPage>
  );
}

/** A short line of links, for the sign-in and sign-up pages. */
export function LegalLinks() {
  return (
    <p className="mt-4 text-center text-xs text-fg-4">
      <Link to="/privacy" className="underline underline-offset-2">
        Privacy
      </Link>{' '}
      ·{' '}
      <Link to="/terms" className="underline underline-offset-2">
        Terms
      </Link>
    </p>
  );
}
