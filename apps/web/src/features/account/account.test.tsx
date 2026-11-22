import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_SETTINGS, type GoveeKeyStatusDto, type PersonalAiDto, type SessionDto } from '@glm/shared';
import { App } from '../../app/App';
import { mockApi, renderApp } from '../../test/fixtures';
import { ConnectPage } from '../dashboard/ConnectPage';
import { AiSettings } from '../ai/AiSettings';
import { AccountData, AdminAccounts } from './AccountData';
import { GoveeKeySettings } from './GoveeKey';

afterEach(() => vi.unstubAllGlobals());

const GOVEE_KEY = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
const AI_KEY = 'sk-test-personal-key-123456';

const session = (role: 'owner' | 'member'): { 'GET /auth/session': { json: SessionDto } } => ({
  'GET /auth/session': {
    json: {
      setupRequired: false,
      setupCodeRequired: false,
      authenticated: true,
      username: role === 'owner' ? 'owner' : 'me@example.com',
      csrfToken: 'csrf',
      expiresAt: '2030-01-01T00:00:00Z',
      signupOpen: false,
      email: role === 'owner' ? null : 'me@example.com',
      role,
    },
  },
});

const keyStatus = (overrides: Partial<GoveeKeyStatusDto> = {}): GoveeKeyStatusDto => ({
  connected: false,
  source: null,
  connectedAt: null,
  canChange: true,
  note: null,
  ...overrides,
});

const personalAi = (overrides: Partial<PersonalAiDto> = {}): PersonalAiDto => ({
  canAddKeys: true,
  keys: [],
  models: { deepseek: ['deepseek-flash', 'deepseek-v4-flash'], gemini: ['gemini-2.5-flash-lite'], glm: ['glm-4.7-flash'] },
  monthlyLimitUsd: 5,
  monthlyLimitMaxUsd: 100,
  ...overrides,
});

const aiStatus = (reason: 'no_key' | null = 'no_key') => ({
  'GET /ai/status': { json: { enabled: reason === null, reason, providers: [], monthSpentUsd: 0, monthlyLimitUsd: 5 } },
});

describe('Govee API key in Settings', () => {
  it('sends the key once, empties the field, and never shows it again', async () => {
    let connected = false;
    const { calls } = mockApi({
      'GET /account/govee': () => ({ json: keyStatus(connected ? { connected: true, source: 'account', connectedAt: '2026-11-22T10:00:00Z' } : {}) }),
      'PUT /account/govee': () => {
        connected = true;
        return { json: keyStatus({ connected: true, source: 'account', connectedAt: '2026-11-22T10:00:00Z' }) };
      },
    });
    renderApp(<GoveeKeySettings />);
    const field = await screen.findByLabelText('Govee API key');
    expect(field).toHaveAttribute('type', 'password');
    await userEvent.type(field, GOVEE_KEY);
    await userEvent.click(screen.getByRole('button', { name: 'Connect' }));

    expect(await screen.findByText(/^Connected on/)).toBeInTheDocument();
    expect(calls.find((c) => c.method === 'PUT')?.body).toEqual({ apiKey: GOVEE_KEY });
    expect(document.body.innerHTML).not.toContain(GOVEE_KEY);
    expect(screen.getByRole('button', { name: 'Replace key' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Remove key' })).toBeInTheDocument();
  });

  it('shows why a key was refused, and empties the field anyway', async () => {
    mockApi({
      'GET /account/govee': { json: keyStatus() },
      'PUT /account/govee': { status: 422, json: { error: { code: 'govee_key_rejected', message: 'Govee did not accept that key.' } } },
    });
    renderApp(<GoveeKeySettings />);
    const field = await screen.findByLabelText('Govee API key');
    await userEvent.type(field, GOVEE_KEY);
    await userEvent.click(screen.getByRole('button', { name: 'Connect' }));
    expect(await screen.findByText('Govee did not accept that key.')).toBeInTheDocument();
    expect(field).toHaveValue('');
    expect(document.body.innerHTML).not.toContain(GOVEE_KEY);
  });

  it("explains the owner's server key, with no form to change it", async () => {
    mockApi({
      'GET /account/govee': { json: keyStatus({ connected: true, source: 'server', canChange: false, note: 'Set on the server.' }) },
    });
    renderApp(<GoveeKeySettings />);
    expect(await screen.findByText(/is set in the app's hosting settings/)).toBeInTheDocument();
    expect(screen.queryByLabelText('Govee API key')).not.toBeInTheDocument();
  });
});

describe('own AI keys in Settings', () => {
  it('lets a member add a key for a provider and model, then forgets the key', async () => {
    let added = false;
    const withKey = personalAi({ keys: [{ provider: 'gemini', label: 'Google Gemini', model: 'gemini-2.5-flash-lite', connectedAt: '2026-11-22T10:00:00Z' }] });
    const { calls } = mockApi({
      ...session('member'),
      ...aiStatus(),
      'GET /account/ai': () => ({ json: added ? withKey : personalAi() }),
      'PUT /account/ai/keys/gemini': () => {
        added = true;
        return { json: withKey };
      },
    });
    renderApp(<AiSettings />);
    expect(await screen.findByText(/AI is off until you add a key of your own/)).toBeInTheDocument();
    await userEvent.click(screen.getByText('Where to get a key, and which model to pick'));
    expect(screen.getByRole('link', { name: 'Google Gemini: create a key' })).toHaveAttribute('href', 'https://aistudio.google.com/apikey');
    expect(screen.queryByText(/Add the key after signing in/)).not.toBeInTheDocument();
    await userEvent.selectOptions(screen.getByLabelText('Provider'), 'gemini');
    expect(screen.getByLabelText('Model')).toHaveValue('gemini-2.5-flash-lite');
    await userEvent.type(screen.getByLabelText('Google Gemini API key'), AI_KEY);
    await userEvent.click(screen.getByRole('button', { name: 'Add key' }));

    expect((await screen.findByRole('button', { name: 'Remove' })).closest('li')).toHaveTextContent('Google Geminigemini-2.5-flash-lite');
    expect(screen.getByLabelText('Google Gemini API key')).toHaveValue('');
    expect(calls.find((c) => c.method === 'PUT')).toMatchObject({
      path: '/account/ai/keys/gemini',
      body: { model: 'gemini-2.5-flash-lite', apiKey: AI_KEY },
    });
    expect(document.body.innerHTML).not.toContain(AI_KEY);
  });

  it("shows the owner the server's providers, with no personal key form", async () => {
    mockApi({ ...session('owner'), ...aiStatus(null) });
    renderApp(<AiSettings />);
    expect(await screen.findByText(/This month: about/)).toBeInTheDocument();
    expect(screen.queryByLabelText('Provider')).not.toBeInTheDocument();
  });
});

describe('your data', () => {
  it('only deletes after the password and the word DELETE', async () => {
    const { calls } = mockApi({ 'POST /account/delete': { status: 204 }, ...session('member') });
    renderApp(<AccountData canDelete />);
    const button = screen.getByRole('button', { name: 'Delete my account' });
    expect(button).toBeDisabled();
    const passwords = screen.getAllByLabelText('Current password');
    await userEvent.type(passwords[1]!, 'my-password-123');
    await userEvent.type(screen.getByLabelText('Type DELETE to confirm'), 'delete');
    expect(button).toBeDisabled();
    await userEvent.clear(screen.getByLabelText('Type DELETE to confirm'));
    await userEvent.type(screen.getByLabelText('Type DELETE to confirm'), 'DELETE');
    await userEvent.click(button);
    await waitFor(() => expect(calls.find((c) => c.path === '/account/delete')?.body).toEqual({ currentPassword: 'my-password-123', confirm: 'DELETE' }));
  });

  it('shows the sign-in page as soon as the account is deleted', async () => {
    let deleted = false;
    mockApi({
      'GET /auth/session': () =>
        deleted
          ? { json: { setupRequired: false, setupCodeRequired: false, authenticated: false, username: null, csrfToken: null, expiresAt: null, signupOpen: false, email: null, role: null } }
          : session('member')['GET /auth/session'],
      'POST /account/delete': () => {
        deleted = true;
        return { status: 204 };
      },
      'GET /settings': { json: DEFAULT_SETTINGS },
      'GET /account/govee': { json: keyStatus() },
      'GET /account/ai': { json: personalAi() },
      ...aiStatus(),
      'GET /notifications': { json: { items: [], unread: 0 } },
    });
    renderApp(<App />, { route: '/settings' });
    await userEvent.type((await screen.findAllByLabelText('Current password'))[3]!, 'my-password-123');
    await userEvent.type(screen.getByLabelText('Type DELETE to confirm'), 'DELETE');
    await userEvent.click(screen.getByRole('button', { name: 'Delete my account' }));
    expect(await screen.findByRole('heading', { name: 'Sign in to Light Manager' })).toBeInTheDocument();
  });

  it('offers the owner a download but no delete', () => {
    mockApi({});
    renderApp(<AccountData canDelete={false} />);
    expect(screen.getByRole('button', { name: 'Download my data' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Delete my account' })).not.toBeInTheDocument();
  });

  it('downloads the export as a file', async () => {
    const created: string[] = [];
    vi.stubGlobal('URL', Object.assign(URL, { createObjectURL: () => 'blob:export', revokeObjectURL: () => undefined }));
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
      created.push(this.download);
    });
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('{"tables":{}}', { status: 200, headers: { 'content-disposition': 'attachment; filename="light-manager-export-2026-11-22.json"' } })),
    );
    renderApp(<AccountData canDelete={false} />);
    await userEvent.type(screen.getByLabelText('Current password'), 'my-password-123');
    await userEvent.click(screen.getByRole('button', { name: 'Download my data' }));
    expect(await screen.findByText('Saved light-manager-export-2026-11-22.json.')).toBeInTheDocument();
    expect(created).toEqual(['light-manager-export-2026-11-22.json']);
    expect(screen.getByLabelText('Current password')).toHaveValue('');
    click.mockRestore();
  });
});

describe("the owner's accounts list", () => {
  it('suspends a member', async () => {
    const member = {
      id: 2,
      email: 'me@example.com',
      role: 'member',
      status: 'active',
      createdAt: '2026-11-20T10:00:00Z',
      lastSignInAt: null,
      goveeConnected: true,
      aiKeys: 0,
      devices: 3,
    };
    const owner = { ...member, id: 1, email: 'owner', role: 'owner', devices: 4 };
    const { calls } = mockApi({
      'GET /admin/accounts': { json: { accounts: [owner, member] } },
      'PATCH /admin/accounts/2': { json: { accounts: [owner, { ...member, status: 'suspended', devices: null }] } },
    });
    renderApp(<AdminAccounts />);
    expect(await screen.findByText('me@example.com')).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: 'Suspend' })).toHaveLength(1);
    await userEvent.click(screen.getByRole('button', { name: 'Suspend' }));
    expect(await screen.findByText('Suspended')).toBeInTheDocument();
    expect(calls.find((c) => c.method === 'PATCH')?.body).toEqual({ status: 'suspended' });
  });
});

describe('getting started', () => {
  it('asks a new member for their Govee key, then tells them about holiday shows and AI', async () => {
    mockApi({
      ...session('member'),
      'GET /account/govee': { json: keyStatus() },
      'GET /settings': { json: { ...DEFAULT_SETTINGS, defaultTimeZone: 'Europe/London' } },
      'GET /system/status': {
        json: {
          version: '1',
          nodeVersion: 'v26',
          uptimeSeconds: 1,
          backend: 'ok',
          database: { status: 'ok', schemaVersion: '006', path: null },
          govee: {
            keyConfigured: false,
            usingLocalTestEndpoint: false,
            baseUrl: 'https://openapi.api.govee.com',
            lastSuccessfulConnectionAt: null,
            lastErrorCategory: null,
            lastErrorAt: null,
            lastRateLimitAt: null,
            requestsToday: 0,
            dailyBudget: 9000,
          },
          devices: { discovered: 0, noLongerDiscovered: 0, lastDiscoveryAt: null },
          scheduler: { status: 'running', lastTickAt: null, enabledSchedules: 0 },
          queue: { pending: 0, pausedUntil: null },
        },
      },
    });
    renderApp(<ConnectPage />);
    expect(await screen.findByLabelText('Govee API key')).toBeInTheDocument();
    expect(screen.getByText(/Choose Apply for API Key/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Test connection and find devices' })).toBeDisabled();
    expect(await screen.findByText('Europe/London')).toBeInTheDocument();
    // jsdom's own zone differs from Europe/London, so the page offers to use it.
    const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (zone !== 'Europe/London') expect(screen.getByRole('button', { name: `Use ${zone}, this browser's time zone` })).toBeInTheDocument();
    expect(screen.getByText(/set up for your lights, switched off/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Settings, under AI' })).toHaveAttribute('href', '/settings');
    expect(screen.queryByText(/GOVEE_API_KEY/)).not.toBeInTheDocument();
  });
});

describe('privacy and terms', () => {
  it('are open to anyone, from the sign-in page', async () => {
    mockApi({
      'GET /auth/session': {
        json: { setupRequired: false, setupCodeRequired: false, authenticated: false, username: null, csrfToken: null, expiresAt: null, signupOpen: true, email: null, role: null },
      },
    });
    renderApp(<App />);
    await userEvent.click(await screen.findByRole('link', { name: 'Privacy' }));
    expect(await screen.findByRole('heading', { name: 'Privacy' })).toBeInTheDocument();
    expect(screen.getByText(/There are no ads, no analytics/)).toBeInTheDocument();
    expect(screen.getByText(/has not yet been reviewed by a lawyer/)).toBeInTheDocument();
  });
});
