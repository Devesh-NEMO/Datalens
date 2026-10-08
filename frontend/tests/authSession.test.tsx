/**
 * The auth module itself: redirect safety, local expiry, storage discipline,
 * and the session state machine of the real AuthProvider against a mocked
 * backend (token attachment, login persistence, 401 → clear + bounce).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AuthProvider, useAuth } from '@/hooks/useAuth';
import {
  DEFAULT_LANDING,
  SESSION_STORAGE_KEY,
  clearSession,
  getToken,
  isExpired,
  sanitizeNext,
  setAuthRequired,
  setSession,
} from '@/lib/auth';
import { apiFetch } from '@/lib/api';

const router = vi.hoisted(() => ({ replace: vi.fn(), push: vi.fn() }));

vi.mock('next/navigation', () => ({
  useRouter: () => router,
}));

const fetchMock = vi.fn();
const seenRequests: Array<{ url: string; authorization: string | null }> = [];

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

const USER = { id: 'u1', email: 'analyst@example.com', display_name: null, created_at: '' };
const futureIso = () => new Date(Date.now() + 3600_000).toISOString();

function recordRequest(input: RequestInfo | URL, init?: RequestInit) {
  const headers = new Headers(init?.headers);
  seenRequests.push({ url: String(input), authorization: headers.get('Authorization') });
}

function Probe() {
  const { status, user, authRequired } = useAuth();
  return (
    <div data-testid="state">
      {status}|{authRequired ? 'req' : 'opt'}|{user?.email ?? 'none'}
    </div>
  );
}

function renderProvider(children: ReactNode) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <AuthProvider>{children}</AuthProvider>
    </QueryClientProvider>
  );
}

describe('redirect safety', () => {
  it('keeps same-origin relative paths and rejects everything else', () => {
    expect(sanitizeNext('/reports')).toBe('/reports');
    expect(sanitizeNext('/')).toBe('/');
    expect(sanitizeNext('/overview?tab=1')).toBe('/overview?tab=1');
  });

  it('falls back to the landing page for foreign, malformed or looping targets', () => {
    expect(sanitizeNext('')).toBe(DEFAULT_LANDING);
    expect(sanitizeNext(undefined)).toBe(DEFAULT_LANDING);
    expect(sanitizeNext('https://evil.example')).toBe(DEFAULT_LANDING);
    expect(sanitizeNext('//evil.example')).toBe(DEFAULT_LANDING);
    expect(sanitizeNext('/\\evil.example')).toBe(DEFAULT_LANDING);
    expect(sanitizeNext('/login')).toBe(DEFAULT_LANDING);
    expect(sanitizeNext('/login/something')).toBe(DEFAULT_LANDING);
    expect(sanitizeNext('/register')).toBe(DEFAULT_LANDING);
    expect(sanitizeNext('/register/x')).toBe(DEFAULT_LANDING);
    expect(sanitizeNext('/reports\u0000')).toBe(DEFAULT_LANDING);
  });
});

describe('local expiry and storage', () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
  });

  it('treats an unreadable timestamp as expired (fail closed)', () => {
    expect(isExpired('not-a-date')).toBe(true);
    expect(isExpired(new Date(Date.now() - 1000).toISOString())).toBe(true);
    expect(isExpired(new Date(Date.now() + 1000).toISOString())).toBe(false);
  });

  it('writes to localStorage when remembered, sessionStorage otherwise', () => {
    setSession({ token: 'remembered', expiresAt: futureIso() }, true);
    expect(JSON.parse(localStorage.getItem(SESSION_STORAGE_KEY) ?? '{}').token).toBe('remembered');
    expect(sessionStorage.getItem(SESSION_STORAGE_KEY)).toBeNull();

    setSession({ token: 'ephemeral', expiresAt: futureIso() }, false);
    expect(JSON.parse(sessionStorage.getItem(SESSION_STORAGE_KEY) ?? '{}').token).toBe('ephemeral');
    // The earlier live token was dropped first — at most one session exists.
    expect(localStorage.getItem(SESSION_STORAGE_KEY)).toBeNull();
  });

  it('getToken returns the live token and survives round-tripping through both stores', () => {
    setSession({ token: 'live', expiresAt: futureIso() }, true);
    expect(getToken()).toBe('live');
  });

  it('clears an expired token on read — an expired session is a signed-out session', () => {
    setSession({ token: 'stale', expiresAt: new Date(Date.now() - 1000).toISOString() }, true);
    expect(getToken()).toBeNull();
    expect(localStorage.getItem(SESSION_STORAGE_KEY)).toBeNull();
  });

  it('clearSession empties every store', () => {
    setSession({ token: 'a', expiresAt: futureIso() }, true);
    clearSession();
    expect(getToken()).toBeNull();
    expect(localStorage.getItem(SESSION_STORAGE_KEY)).toBeNull();
    expect(sessionStorage.getItem(SESSION_STORAGE_KEY)).toBeNull();
  });
});

describe('AuthProvider session flow', () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    setAuthRequired(false);
    router.replace.mockReset();
    seenRequests.length = 0;
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
    fetchMock.mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      recordRequest(input, init);
      const url = String(input);
      if (url.endsWith('/v1/auth/session')) {
        return jsonResponse({
          authenticated: false,
          auth_required: false,
          user: null,
          message: 'Anonymous',
        });
      }
      return jsonResponse({ error: { code: 'not_found', message: 'Not found' } }, 404);
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('starts anonymous and consults the server without a token', async () => {
    renderProvider(<Probe />);

    await waitFor(() =>
      expect(screen.getByTestId('state')).toHaveTextContent('anonymous|opt|none')
    );
    expect(seenRequests[0].url).toContain('/v1/auth/session');
    expect(seenRequests[0].authorization).toBeNull();
  });

  it('an expired token is cleared and never carried on the session request', async () => {
    setSession(
      { token: 'expired-token', expiresAt: new Date(Date.now() - 1000).toISOString() },
      true
    );
    renderProvider(<Probe />);

    await waitFor(() =>
      expect(screen.getByTestId('state')).toHaveTextContent('anonymous|opt|none')
    );
    expect(seenRequests[0].authorization).toBeNull();
    expect(localStorage.getItem(SESSION_STORAGE_KEY)).toBeNull();
  });

  it('carries the live token on the session request', async () => {
    setSession({ token: 'live-token', expiresAt: futureIso() }, true);
    fetchMock.mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      recordRequest(input, init);
      const url = String(input);
      if (url.endsWith('/v1/auth/session')) {
        return jsonResponse({
          authenticated: true,
          auth_required: false,
          user: USER,
          message: 'Signed in.',
        });
      }
      return jsonResponse({ error: { code: 'not_found', message: 'Not found' } }, 404);
    });
    renderProvider(<Probe />);

    await waitFor(() =>
      expect(screen.getByTestId('state')).toHaveTextContent(
        'authenticated|opt|analyst@example.com'
      )
    );
    expect(seenRequests[0].authorization).toBe('Bearer live-token');
  });

  it('login stores the session (remembered) and flips to authenticated synchronously', async () => {
    fetchMock.mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      recordRequest(input, init);
      const url = String(input);
      if (url.endsWith('/v1/auth/login')) {
        const body = JSON.parse(String(init?.body));
        expect(body.email).toBe('analyst@example.com');
        return jsonResponse({ token: 'fresh-token', expires_at: futureIso(), user: USER });
      }
      if (url.endsWith('/v1/auth/session')) {
        return jsonResponse({
          authenticated: false,
          auth_required: false,
          user: null,
          message: 'Anonymous',
        });
      }
      return jsonResponse({ error: { code: 'not_found', message: 'Not found' } }, 404);
    });

    function App() {
      const { status, login } = useAuth();
      return (
        <div>
          <button onClick={() => void login({ email: 'analyst@example.com', password: 'p1', remember: true })}>
            Sign in
          </button>
          <div data-testid="status">{status}</div>
        </div>
      );
    }
    renderProvider(<App />);

    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('authenticated'));
    expect(JSON.parse(localStorage.getItem(SESSION_STORAGE_KEY) ?? '{}').token).toBe('fresh-token');
  });

  it('a 401 on a token-carrying request clears the session and bounces when auth is required', async () => {
    setSession({ token: 'live-token', expiresAt: futureIso() }, true);
    fetchMock.mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      recordRequest(input, init);
      const url = String(input);
      if (url.endsWith('/v1/auth/session')) {
        return jsonResponse({
          authenticated: false,
          auth_required: true,
          user: null,
          message: 'Sign in required.',
        });
      }
      if (url.endsWith('/v1/analyze')) {
        return jsonResponse(
          { error: { code: 'auth_invalid_token', message: 'Your session has expired.' } },
          401
        );
      }
      return jsonResponse({ error: { code: 'not_found', message: 'Not found' } }, 404);
    });
    renderProvider(<Probe />);

    // The server says auth is required and this visitor is anonymous.
    await waitFor(() =>
      expect(screen.getByTestId('state')).toHaveTextContent('anonymous|req|none')
    );

    // A request carrying the now-rejected token comes back 401.
    await apiFetch('/v1/analyze');

    await waitFor(() =>
      expect(router.replace).toHaveBeenCalledWith('/login?next=%2F')
    );
    expect(localStorage.getItem(SESSION_STORAGE_KEY)).toBeNull();
    expect(sessionStorage.getItem(SESSION_STORAGE_KEY)).toBeNull();
  });
});