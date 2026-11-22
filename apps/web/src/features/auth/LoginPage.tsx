import { useState, type FormEvent } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { Button, ErrorNotice, Field, inputClass, Notice } from '../../components/ui';
import { LegalLinks } from '../legal/LegalPages';
import { AuthCard, type LoginNotice } from './EmailPages';
import { useLogin } from './useSession';

const NOTICES: Record<LoginNotice['notice'], string> = {
  verified: 'Your account is ready. Sign in with your new password.',
  reset: 'Your password was changed. Sign in with the new one.',
};

export function LoginPage({ signupOpen }: { signupOpen: boolean }) {
  const location = useLocation();
  const arrived = (location.state ?? null) as LoginNotice | null;
  const [username, setUsername] = useState(arrived?.email ?? '');
  const [password, setPassword] = useState('');
  const login = useLogin();

  const submit = (event: FormEvent) => {
    event.preventDefault();
    login.mutate({ username, password });
  };

  return (
    <AuthCard title="Sign in to Light Manager">
      {arrived && NOTICES[arrived.notice] ? (
        <div className="mb-4">
          <Notice tone="good">{NOTICES[arrived.notice]}</Notice>
        </div>
      ) : null}
      <form onSubmit={submit} className="space-y-4">
        <Field label="Email or username">
          {(props) => (
            <input
              {...props}
              className={inputClass}
              autoComplete="username"
              autoFocus={!arrived}
              required
              maxLength={254}
              value={username}
              onChange={(e) => setUsername(e.target.value)}
            />
          )}
        </Field>
        <Field label="Password">
          {(props) => (
            <input
              {...props}
              className={inputClass}
              type="password"
              autoComplete="current-password"
              autoFocus={Boolean(arrived)}
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          )}
        </Field>
        {login.isError ? <ErrorNotice error={login.error} /> : null}
        <Button type="submit" variant="primary" className="w-full" busy={login.isPending}>
          Sign in
        </Button>
      </form>
      <div className="mt-4 space-y-2 text-center text-sm">
        <p>
          <Link to="/forgot" className="text-amber-soft underline underline-offset-2">
            Forgot your password?
          </Link>
        </p>
        {signupOpen ? (
          <p className="text-ink-400">
            New here?{' '}
            <Link to="/register" className="text-amber-soft underline underline-offset-2">
              Create an account
            </Link>
          </p>
        ) : null}
      </div>
      <p className="mt-4 text-xs text-ink-400">
        If your account has no email address yet, reset the password on the server with{' '}
        <code className="font-mono">npm run reset-password</code>. See docs/security.md.
      </p>
      <LegalLinks />
    </AuthCard>
  );
}
