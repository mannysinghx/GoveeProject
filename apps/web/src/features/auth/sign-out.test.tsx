import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, it, vi } from 'vitest';
import { DEFAULT_SETTINGS } from '@glm/shared';
import { App } from '../../app/App';
import { mockApi, renderApp } from '../../test/fixtures';

/* Signing out leaves the signed-in pages at once. Until 22 November 2026 it did not. */
afterEach(() => vi.unstubAllGlobals());
it('shows the sign-in page as soon as you sign out', async () => {
  let out = false;
  const s = (auth: boolean) => ({ setupRequired: false, setupCodeRequired: false, authenticated: auth, username: auth ? 'owner' : null, csrfToken: auth ? 'c' : null, expiresAt: null, signupOpen: false, email: null, role: auth ? 'owner' : null });
  mockApi({
    'GET /auth/session': () => ({ json: s(!out) }),
    'POST /auth/logout': () => { out = true; return { status: 204 }; },
    'GET /settings': { json: DEFAULT_SETTINGS },
    'GET /notifications': { json: { items: [], unread: 0 } },
    'GET /ai/status': { json: { enabled: false, reason: 'no_providers', providers: [], monthSpentUsd: 0, monthlyLimitUsd: 5 } },
    'GET /account/govee': { json: { connected: false, source: null, connectedAt: null, canChange: false, note: null } },
    'GET /admin/signup': { json: { enabled: false, dailyCap: 1, totalCap: 1, mailConfigured: false, createdLastDay: 0, createdTotal: 0, mailQueued: 0, mailFailedLastDay: 0 } },
    'GET /admin/accounts': { json: { accounts: [] } },
  });
  renderApp(<App />, { route: '/settings' });
  await userEvent.click((await screen.findAllByRole('button', { name: 'Sign out' }))[0]!);
  expect(await screen.findByRole('heading', { name: 'Sign in to Light Manager' })).toBeInTheDocument();
});
