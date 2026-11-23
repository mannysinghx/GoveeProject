import { createHash } from 'node:crypto';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_SETTINGS, GOVEE_KEY_HELP_URL, type SessionDto, type SignupSettingsDto } from '@glm/shared';
import { App } from '../../app/App';
import { mockApi, renderApp } from '../../test/fixtures';
import { leadingZeroBits, solveChallenge } from './proof-of-work';

afterEach(() => vi.unstubAllGlobals());

const TOKEN = 'tok_ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789abcdefg';

const signedOut = (overrides: Partial<SessionDto> = {}): SessionDto => ({
  setupRequired: false,
  setupCodeRequired: false,
  authenticated: false,
  username: null,
  csrfToken: null,
  expiresAt: null,
  signupOpen: true,
  email: null,
  role: null,
  ...overrides,
});

const challenge = { 'GET /auth/challenge': { json: { challenge: 'v1.1.4.abc.sig', difficulty: 4, expiresAt: '2030-01-01T00:00:00Z' } } };

const meetsDifficulty = (body: { challenge: string; nonce: string }, difficulty: number) =>
  leadingZeroBits(createHash('sha256').update(`${body.challenge}:${body.nonce}`).digest()) >= difficulty;

describe('proof of work in the browser', () => {
  it('finds an answer the server will accept', async () => {
    const nonce = await solveChallenge('v1.123.8.xyz.sig', 8);
    expect(meetsDifficulty({ challenge: 'v1.123.8.xyz.sig', nonce }, 8)).toBe(true);
  });
});

describe('sign-in page', () => {
  it('offers sign-up only while it is open, and always offers a reset', async () => {
    mockApi({ 'GET /auth/session': { json: signedOut({ signupOpen: false }) } });
    renderApp(<App />);
    expect(await screen.findByLabelText('Email or username')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Forgot your password?' })).toHaveAttribute('href', '/forgot');
    expect(screen.queryByRole('link', { name: 'Create an account' })).not.toBeInTheDocument();
  });

  it('sends a closed sign-up page back to sign in', async () => {
    mockApi({ 'GET /auth/session': { json: signedOut({ signupOpen: false }) } });
    renderApp(<App />, { route: '/register' });
    expect(await screen.findByRole('heading', { name: 'Sign in to Light Manager' })).toBeInTheDocument();
  });
});

describe('creating an account', () => {
  it('solves the browser check, sends the address, and says the same thing whatever happens next', async () => {
    const { calls } = mockApi({
      'GET /auth/session': { json: signedOut() },
      ...challenge,
      'POST /auth/register': { status: 202, json: { ok: true } },
    });
    renderApp(<App />);
    await userEvent.click(await screen.findByRole('link', { name: 'Create an account' }));
    await userEvent.type(screen.getByLabelText('Email'), 'new@example.com');
    await userEvent.click(screen.getByRole('button', { name: 'Send the link' }));

    expect(await screen.findByRole('heading', { name: 'Check your inbox' })).toBeInTheDocument();
    expect(screen.getByText(/If new@example.com can be used for a new account/)).toBeInTheDocument();
    const sent = calls.find((c) => c.path === '/auth/register')!.body as { email: string; challenge: string; nonce: string; website?: string };
    expect(sent.email).toBe('new@example.com');
    expect(sent.website).toBeUndefined();
    expect(meetsDifficulty(sent, 4)).toBe(true);
    // One email a minute: sending again waits.
    expect(screen.getByRole('button', { name: /Send again in \d+s/ })).toBeDisabled();
  });

  it('says how to get a Govee key and an AI key, with the low-cost models to pick', async () => {
    mockApi({ 'GET /auth/session': { json: signedOut() } });
    renderApp(<App />, { route: '/register' });
    expect(await screen.findByRole('heading', { name: 'What you will need' })).toBeInTheDocument();
    await userEvent.click(screen.getByText('A Govee API key, to control your lights'));
    expect(screen.getByText(/Choose Apply for API Key/)).toBeVisible();
    expect(screen.getByRole('link', { name: /Govee's guide/ })).toHaveAttribute('href', GOVEE_KEY_HELP_URL);
    await userEvent.click(screen.getByText(/An AI key, if you want AI/));
    const providers = screen.getAllByRole('link', { name: /: create a key/ });
    // Lowest cost first, each to its own provider's site, in a new tab.
    expect(providers.map((link) => link.textContent)).toEqual([
      'OpenAI: create a key',
      'Meta Muse: create a key',
      'Anthropic Claude: create a key',
      'Z.ai GLM: create a key',
      'DeepSeek: create a key',
      'Google Gemini: create a key',
    ]);
    expect(providers.map((link) => new URL(link.getAttribute('href')!).host)).toEqual([
      'platform.openai.com',
      'dev.meta.ai',
      'platform.claude.com',
      'z.ai',
      'platform.deepseek.com',
      'aistudio.google.com',
    ]);
    for (const link of providers) expect(link).toHaveAttribute('target', '_blank');
    for (const model of ['gpt-6-luna', 'muse-ember-1.0', 'claude-haiku-5-5', 'glm-5.3-flash', 'deepseek-flash', 'gemini-3.5-flash-lite']) {
      expect(screen.getByText(model)).toBeInTheDocument();
    }
    expect(screen.getAllByText('$0.10 in, $0.50 out, per million tokens')).toHaveLength(3);
    expect(screen.getByText('$0.30 in, $2.50 out, per million tokens')).toBeInTheDocument();
    expect(screen.getByText(/Add the key after signing in, in Settings under AI/)).toBeInTheDocument();
  });

  it('does not show the key guide when asking for a password reset', async () => {
    mockApi({ 'GET /auth/session': { json: signedOut() } });
    renderApp(<App />, { route: '/forgot' });
    await screen.findByLabelText('Email');
    expect(screen.queryByText('What you will need')).not.toBeInTheDocument();
  });

  it('keeps the bot trap out of sight and out of the tab order', async () => {
    mockApi({ 'GET /auth/session': { json: signedOut() } });
    renderApp(<App />, { route: '/register' });
    await screen.findByLabelText('Email');
    const trap = document.querySelector('input[name="website"]') as HTMLInputElement;
    expect(trap.tabIndex).toBe(-1);
    expect(trap.closest('[aria-hidden="true"]')).not.toBeNull();
  });

  it('shows the server\'s reason when sign-up is full', async () => {
    mockApi({
      'GET /auth/session': { json: signedOut() },
      ...challenge,
      'POST /auth/register': { status: 403, json: { error: { code: 'signup_full', message: 'Enough accounts have been made today.' } } },
    });
    renderApp(<App />, { route: '/register' });
    await userEvent.type(await screen.findByLabelText('Email'), 'late@example.com');
    await userEvent.click(screen.getByRole('button', { name: 'Send the link' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Enough accounts have been made today');
  });
});

describe('links from emails', () => {
  it('reads the token from the link, asks for a password twice, then sends the person to sign in', async () => {
    const { calls } = mockApi({
      'GET /auth/session': { json: signedOut() },
      'POST /auth/link/check': { json: { purpose: 'signup', email: 'new@example.com' } },
      'POST /auth/register/complete': { status: 201, json: { email: 'new@example.com' } },
    });
    renderApp(<App />, { route: `/verify#t=${TOKEN}` });
    expect(await screen.findByText('new@example.com')).toBeInTheDocument();
    expect(calls.find((c) => c.path === '/auth/link/check')!.body).toEqual({ token: TOKEN });

    await userEvent.type(screen.getByLabelText('Password'), 'a-long-password-1');
    await userEvent.type(screen.getByLabelText('Confirm password'), 'a-long-password-2');
    await userEvent.click(screen.getByRole('button', { name: 'Create account' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('do not match');
    expect(calls.some((c) => c.path === '/auth/register/complete')).toBe(false);

    await userEvent.clear(screen.getByLabelText('Confirm password'));
    await userEvent.type(screen.getByLabelText('Confirm password'), 'a-long-password-1');
    await userEvent.click(screen.getByRole('button', { name: 'Create account' }));

    expect(await screen.findByText('Your account is ready. Sign in with your new password.')).toBeInTheDocument();
    expect(screen.getByLabelText('Email or username')).toHaveValue('new@example.com');
    expect(calls.find((c) => c.path === '/auth/register/complete')!.body).toEqual({ token: TOKEN, password: 'a-long-password-1' });
    // No sign-in happened: the person signs in themselves.
    expect(calls.some((c) => c.path === '/auth/login')).toBe(false);
  });

  it('explains an expired or used link, and one opened on the wrong page', async () => {
    mockApi({
      'GET /auth/session': { json: signedOut() },
      'POST /auth/link/check': { status: 400, json: { error: { code: 'link_invalid', message: 'This link has expired or has already been used.' } } },
    });
    renderApp(<App />, { route: `/verify#t=${TOKEN}` });
    expect(await screen.findByRole('heading', { name: 'This link cannot be used' })).toBeInTheDocument();
    expect(screen.getByText(/expired or has already been used/)).toBeInTheDocument();
  });

  it('will not use a reset link to make an account', async () => {
    mockApi({
      'GET /auth/session': { json: signedOut() },
      'POST /auth/link/check': { json: { purpose: 'reset', email: 'new@example.com' } },
    });
    renderApp(<App />, { route: `/verify#t=${TOKEN}` });
    expect(await screen.findByRole('heading', { name: 'This link cannot be used' })).toBeInTheDocument();
  });

  it('says so when the link has no token', async () => {
    mockApi({ 'GET /auth/session': { json: signedOut() } });
    renderApp(<App />, { route: '/reset' });
    expect(await screen.findByText(/This link is not complete/)).toBeInTheDocument();
  });

  it('resets a password, then asks to sign in with it', async () => {
    mockApi({
      'GET /auth/session': { json: signedOut() },
      'POST /auth/link/check': { json: { purpose: 'reset', email: 'new@example.com' } },
      'POST /auth/password/reset': { json: { email: 'new@example.com' } },
    });
    renderApp(<App />, { route: `/reset#t=${TOKEN}` });
    await userEvent.type(await screen.findByLabelText('Password'), 'another-long-pass');
    await userEvent.type(screen.getByLabelText('Confirm password'), 'another-long-pass');
    await userEvent.click(screen.getByRole('button', { name: 'Save new password' }));
    expect(await screen.findByText('Your password was changed. Sign in with the new one.')).toBeInTheDocument();
  });

  it('confirms a new sign-in address only when the button is pressed', async () => {
    const { calls } = mockApi({
      'GET /auth/session': { json: signedOut() },
      'POST /auth/link/check': { json: { purpose: 'email_change', email: 'me@lightup.ink' } },
      'POST /auth/email/confirm': { json: { email: 'me@lightup.ink' } },
    });
    renderApp(<App />, { route: `/confirm-email#t=${TOKEN}` });
    expect(await screen.findByText('me@lightup.ink')).toBeInTheDocument();
    expect(calls.some((c) => c.path === '/auth/email/confirm')).toBe(false);
    await userEvent.click(screen.getByRole('button', { name: 'Confirm this address' }));
    expect(await screen.findByText('You now sign in with me@lightup.ink.')).toBeInTheDocument();
  });

  it('asks for a reset link, with the same answer for any address', async () => {
    const { calls } = mockApi({
      'GET /auth/session': { json: signedOut() },
      ...challenge,
      'POST /auth/password/forgot': { status: 202, json: { ok: true } },
    });
    renderApp(<App />, { route: '/forgot' });
    await userEvent.type(await screen.findByLabelText('Email'), 'who@example.com');
    await userEvent.click(screen.getByRole('button', { name: 'Send the link' }));
    expect(await screen.findByText(/If who@example.com has an account/)).toBeInTheDocument();
    expect(calls.find((c) => c.path === '/auth/password/forgot')!.body).toMatchObject({ email: 'who@example.com' });
  });
});

describe('account settings', () => {
  const signedIn = (overrides: Partial<SessionDto> = {}): SessionDto =>
    signedOut({ authenticated: true, username: 'owner', csrfToken: 'csrf-abc', expiresAt: '2030-01-01T00:00:00Z', role: 'owner', ...overrides });
  const signup: SignupSettingsDto = {
    enabled: false,
    dailyCap: 50,
    totalCap: 500,
    mailConfigured: true,
    createdLastDay: 0,
    createdTotal: 0,
    mailQueued: 0,
    mailFailedLastDay: 0,
  };
  const base = {
    'GET /settings': { json: DEFAULT_SETTINGS },
    'GET /system/status': { status: 500, json: {} },
    'GET /ai/status': { json: { enabled: false, reason: 'no_providers', providers: [], monthSpentUsd: 0, monthlyLimitUsd: 5 } },
  };

  it('lets the owner add an address, confirmed from its inbox', async () => {
    const { calls } = mockApi({
      'GET /auth/session': { json: signedIn() },
      ...base,
      'GET /admin/signup': { json: signup },
      'POST /auth/email/change': { status: 202, json: { ok: true } },
    });
    renderApp(<App />, { route: '/settings' });
    expect(await screen.findByText(/Add an address to sign in with it/)).toBeInTheDocument();
    await userEvent.type(screen.getByLabelText('Email'), 'me@lightup.ink');
    const passwords = screen.getAllByLabelText('Current password');
    await userEvent.type(passwords[0]!, 'correct-horse-battery');
    await userEvent.click(screen.getByRole('button', { name: 'Add email' }));
    expect(await screen.findByText(/a link to confirm it is on its way/)).toBeInTheDocument();
    expect(calls.find((c) => c.path === '/auth/email/change')!.body).toEqual({ newEmail: 'me@lightup.ink', currentPassword: 'correct-horse-battery' });
  });

  it('shows the owner the sign-up switch, off by default, and turns it on', async () => {
    const { calls } = mockApi({
      'GET /auth/session': { json: signedIn() },
      ...base,
      'GET /admin/signup': { json: signup },
      'PATCH /admin/signup': { json: { ...signup, enabled: true } },
    });
    renderApp(<App />, { route: '/settings' });
    expect(await screen.findByText(/Sign-up is off\./)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Turn sign-up on' }));
    await waitFor(() => expect(calls.find((c) => c.path === '/admin/signup' && c.method === 'PATCH')?.body).toEqual({ enabled: true }));
    expect(await screen.findByText(/Sign-up is on\./)).toBeInTheDocument();
  });

  it('cannot turn sign-up on without email set up', async () => {
    mockApi({
      'GET /auth/session': { json: signedIn() },
      ...base,
      'GET /admin/signup': { json: { ...signup, mailConfigured: false } },
    });
    renderApp(<App />, { route: '/settings' });
    expect(await screen.findByText(/Email is not set up yet/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Turn sign-up on' })).toBeDisabled();
  });

  it('shows a member their address, and no sign-up switch', async () => {
    const { calls } = mockApi({
      'GET /auth/session': { json: signedIn({ role: 'member', email: 'new@example.com', username: 'new@example.com' }) },
      ...base,
    });
    renderApp(<App />, { route: '/settings' });
    expect(await screen.findByText(/You sign in with new@example.com/)).toBeInTheDocument();
    expect(screen.queryByText(/Sign-up is/)).not.toBeInTheDocument();
    expect(calls.some((c) => c.path === '/admin/signup')).toBe(false);
  });
});
