import { Lightbulb } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { Button, Card, ErrorNotice, Field, inputClass } from '../../components/ui';
import { useLogin } from './useSession';

export function LoginPage() {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const login = useLogin();

  const submit = (event: FormEvent) => {
    event.preventDefault();
    login.mutate({ username, password });
  };

  return (
    <main className="flex min-h-dvh items-center justify-center p-4">
      <Card className="w-full max-w-sm p-6">
        <div className="mb-5 flex items-center gap-2">
          <Lightbulb className="size-5 text-amber-glow" aria-hidden />
          <h1 className="text-lg font-semibold">Sign in to Light Manager</h1>
        </div>
        <form onSubmit={submit} className="space-y-4">
          <Field label="Username">
            {(props) => (
              <input
                {...props}
                className={inputClass}
                autoComplete="username"
                autoFocus
                required
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
        <p className="mt-4 text-xs text-ink-400">
          Forgot your password? Reset it on the server with <code className="font-mono">npm run reset-password</code>.
          See docs/security.md.
        </p>
      </Card>
    </main>
  );
}
