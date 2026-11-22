import { Lightbulb, MailCheck } from 'lucide-react';
import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { PASSWORD_MIN_LENGTH } from '@glm/shared';
import { Button, Card, ErrorNotice, Field, inputClass, Loading, Notice } from '../../components/ui';
import {
  useCompleteSignup,
  useConfirmEmail,
  useForgotPassword,
  useLinkCheck,
  useRegister,
  useResetPassword,
} from './useSession';

/** Shown on the sign-in page after a step that ends with "now sign in". */
export interface LoginNotice {
  notice: 'verified' | 'reset';
  email: string;
}

export function AuthCard({ title, children }: { title: string; children: ReactNode }) {
  return (
    <main className="flex min-h-dvh items-center justify-center p-4">
      <Card className="w-full max-w-sm p-6">
        <div className="mb-5 flex items-center gap-2">
          <Lightbulb className="size-5 text-amber-glow" aria-hidden />
          <h1 className="text-lg font-semibold">{title}</h1>
        </div>
        {children}
      </Card>
    </main>
  );
}

/** Off screen and out of the tab order. People never see it; form-filling bots do. */
function Honeypot({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  return (
    <div aria-hidden="true" style={{ position: 'absolute', left: '-10000px', width: 1, height: 1, overflow: 'hidden' }}>
      <label>
        Website
        <input type="text" name="website" tabIndex={-1} autoComplete="off" value={value} onChange={(e) => onChange(e.target.value)} />
      </label>
    </div>
  );
}

function EmailField({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  return (
    <Field label="Email">
      {(props) => (
        <input
          {...props}
          className={inputClass}
          type="email"
          autoComplete="email"
          autoFocus
          required
          maxLength={254}
          value={value}
          onChange={(e) => onChange(e.target.value)}
        />
      )}
    </Field>
  );
}

/** "Send again" waits a minute, matching the server's one-email-a-minute limit. */
function useCountdown(seconds: number, running: boolean): number {
  const [left, setLeft] = useState(seconds);
  useEffect(() => {
    if (!running) return;
    setLeft(seconds);
    const timer = setInterval(() => setLeft((n) => (n <= 1 ? 0 : n - 1)), 1000);
    return () => clearInterval(timer);
  }, [running, seconds]);
  return left;
}

function BackToSignIn() {
  return (
    <p className="mt-4 text-center text-sm text-ink-400">
      <Link to="/" className="text-amber-soft underline underline-offset-2">
        Back to sign in
      </Link>
    </p>
  );
}

/** Asks for an email, and always ends with the same "check your inbox", whatever the address. */
function EmailRequestPage({
  title,
  intro,
  submitLabel,
  sentTitle,
  sentBody,
  mutation,
}: {
  title: string;
  intro: string;
  submitLabel: string;
  sentTitle: string;
  sentBody: (email: string) => string;
  mutation: ReturnType<typeof useRegister>;
}) {
  const [email, setEmail] = useState('');
  const [website, setWebsite] = useState('');
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [round, setRound] = useState(0);
  const wait = useCountdown(60, sentTo !== null && round > 0);

  const send = (event?: FormEvent) => {
    event?.preventDefault();
    mutation.mutate(
      { email, website },
      {
        onSuccess: () => {
          setSentTo(email.trim());
          setRound((n) => n + 1);
        },
      },
    );
  };

  if (sentTo) {
    return (
      <AuthCard title={sentTitle}>
        <div className="flex gap-3">
          <MailCheck className="mt-0.5 size-5 shrink-0 text-amber-glow" aria-hidden />
          <p className="text-sm text-ink-300">{sentBody(sentTo)}</p>
        </div>
        <p className="mt-4 text-sm text-ink-400">The link works for 30 minutes. Check your spam folder if it does not arrive.</p>
        {mutation.isError ? <ErrorNotice error={mutation.error} /> : null}
        <Button className="mt-4 w-full" onClick={() => send()} busy={mutation.isPending} disabled={wait > 0}>
          {wait > 0 ? `Send again in ${wait}s` : 'Send again'}
        </Button>
        <BackToSignIn />
      </AuthCard>
    );
  }

  return (
    <AuthCard title={title}>
      <p className="mb-4 text-sm text-ink-300">{intro}</p>
      <form onSubmit={send} className="space-y-4">
        <EmailField value={email} onChange={setEmail} />
        <Honeypot value={website} onChange={setWebsite} />
        {mutation.isError ? <ErrorNotice error={mutation.error} /> : null}
        <Button type="submit" variant="primary" className="w-full" busy={mutation.isPending}>
          {mutation.isPending ? 'Checking this browser…' : submitLabel}
        </Button>
      </form>
      <BackToSignIn />
    </AuthCard>
  );
}

export function RegisterPage() {
  return (
    <EmailRequestPage
      title="Create an account"
      intro="Enter your email address. We will send a link to it, and you choose a password from there."
      submitLabel="Send the link"
      sentTitle="Check your inbox"
      sentBody={(email) => `If ${email} can be used for a new account, a link to finish signing up is on its way.`}
      mutation={useRegister()}
    />
  );
}

export function ForgotPasswordPage() {
  return (
    <EmailRequestPage
      title="Reset your password"
      intro="Enter the email address you sign in with. We will send a link to choose a new password."
      submitLabel="Send the link"
      sentTitle="Check your inbox"
      sentBody={(email) => `If ${email} has an account, a link to reset its password is on its way.`}
      mutation={useForgotPassword()}
    />
  );
}

/**
 * The token from the link's fragment (#t=...), which browsers never send to the server. It is
 * kept in memory and taken out of the address bar, so it is not left in history.
 */
function useLinkToken(): string | null {
  const location = useLocation();
  const navigate = useNavigate();
  const [token] = useState(() => new URLSearchParams(location.hash.slice(1)).get('t'));
  useEffect(() => {
    if (location.hash) navigate(location.pathname, { replace: true });
  }, [location.hash, location.pathname, navigate]);
  return token;
}

function LinkProblem({ error }: { error?: unknown }) {
  return (
    <AuthCard title="This link cannot be used">
      {error ? <ErrorNotice error={error} /> : <Notice tone="warn">This link is not complete. Open it from the email again.</Notice>}
      <p className="mt-4 text-sm text-ink-300">
        Links work once, for 30 minutes. You can ask for a new one from the{' '}
        <Link to="/register" className="text-amber-soft underline underline-offset-2">
          sign-up
        </Link>{' '}
        or{' '}
        <Link to="/forgot" className="text-amber-soft underline underline-offset-2">
          reset
        </Link>{' '}
        page.
      </p>
      <BackToSignIn />
    </AuthCard>
  );
}

function NewPasswordForm({
  token,
  email,
  submitLabel,
  mutation,
  onDone,
}: {
  token: string;
  email: string;
  submitLabel: string;
  mutation: ReturnType<typeof useCompleteSignup>;
  onDone: (email: string) => void;
}) {
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [localError, setLocalError] = useState<string | null>(null);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    setLocalError(null);
    if (password.length < PASSWORD_MIN_LENGTH) return setLocalError(`Use at least ${PASSWORD_MIN_LENGTH} characters.`);
    if (password !== confirm) return setLocalError('The two passwords do not match.');
    mutation.mutate({ token, password }, { onSuccess: (result) => onDone(result.email) });
  };

  return (
    <form onSubmit={submit} className="space-y-4">
      {/* Lets password managers save the new password under the right address. */}
      <input type="email" autoComplete="username" value={email} readOnly hidden />
      <p className="text-sm text-ink-300">
        For <span className="font-medium text-ink-100">{email}</span>
      </p>
      <Field label="Password" hint={`At least ${PASSWORD_MIN_LENGTH} characters.`}>
        {(field) => (
          <input
            {...field}
            className={inputClass}
            type="password"
            autoComplete="new-password"
            autoFocus
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        )}
      </Field>
      <Field label="Confirm password">
        {(field) => (
          <input
            {...field}
            className={inputClass}
            type="password"
            autoComplete="new-password"
            required
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
          />
        )}
      </Field>
      {localError ? (
        <p role="alert" className="text-sm text-bad">
          {localError}
        </p>
      ) : null}
      {mutation.isError ? <ErrorNotice error={mutation.error} /> : null}
      <Button type="submit" variant="primary" className="w-full" busy={mutation.isPending}>
        {submitLabel}
      </Button>
    </form>
  );
}

function LinkPage({
  purpose,
  title,
  children,
}: {
  purpose: 'signup' | 'reset' | 'email_change';
  title: string;
  children: (email: string, token: string) => ReactNode;
}) {
  const token = useLinkToken();
  const check = useLinkCheck(token);
  if (!token) return <LinkProblem />;
  if (check.isPending) return <Loading label="Checking the link" />;
  if (check.isError) return <LinkProblem error={check.error} />;
  if (check.data.purpose !== purpose) return <LinkProblem />;
  return <AuthCard title={title}>{children(check.data.email, token)}</AuthCard>;
}

export function VerifyEmailPage() {
  const complete = useCompleteSignup();
  const navigate = useNavigate();
  return (
    <LinkPage purpose="signup" title="Choose a password">
      {(email, token) => (
        <NewPasswordForm
          token={token}
          email={email}
          submitLabel="Create account"
          mutation={complete}
          onDone={(done) => navigate('/', { replace: true, state: { notice: 'verified', email: done } satisfies LoginNotice })}
        />
      )}
    </LinkPage>
  );
}

export function ResetPasswordPage() {
  const reset = useResetPassword();
  const navigate = useNavigate();
  return (
    <LinkPage purpose="reset" title="Choose a new password">
      {(email, token) => (
        <NewPasswordForm
          token={token}
          email={email}
          submitLabel="Save new password"
          mutation={reset}
          onDone={(done) => navigate('/', { replace: true, state: { notice: 'reset', email: done } satisfies LoginNotice })}
        />
      )}
    </LinkPage>
  );
}

export function ConfirmEmailPage() {
  const confirm = useConfirmEmail();
  return (
    <LinkPage purpose="email_change" title="Confirm your sign-in address">
      {(email, token) =>
        confirm.isSuccess ? (
          <>
            <Notice tone="good">You now sign in with {confirm.data.email}.</Notice>
            <BackToSignIn />
          </>
        ) : (
          <>
            <p className="text-sm text-ink-300">
              Sign in with <span className="font-medium text-ink-100">{email}</span> from now on?
            </p>
            {confirm.isError ? <ErrorNotice error={confirm.error} /> : null}
            <Button variant="primary" className="mt-4 w-full" busy={confirm.isPending} onClick={() => confirm.mutate({ token })}>
              Confirm this address
            </Button>
          </>
        )
      }
    </LinkPage>
  );
}
