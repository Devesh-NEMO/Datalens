/**
 * AuthGate tests with the *real* AuthProvider: session fetched from a mocked
 * backend, so these cover the full decision path — load skeleton, optional
 * auth passthrough, required-auth redirect with `?next=`, authenticated pass.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AuthProvider } from '@/hooks/useAuth';
import { AuthGate } from '@/components/auth/AuthGate';
import { setAuthRequired } from '@/lib/auth';

const router = vi.hoisted(() => ({ replace: vi.fn(), push: vi.fn() }));
const path = vi.hoisted(() => ({ current: '/reports' }));

vi.mock('next/navigation', () => ({
  useRouter: () => router,
  usePathname: () => path.current,
}));

const fetchMock = vi.fn();

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function sessionResponse(authenticated: boolean, authRequired: boolean) {
  return jsonResponse({
    authenticated,
    auth_required: authRequired,
    user: authenticated
      ? { id: 'u1', email: 'analyst@example.com', display_name: null, created_at: '' }
      : null,
    message: '',
  });
}

function renderGate() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <AuthGate>
          <div data-testid="page-content">Dashboard content</div>
        </AuthGate>
      </AuthProvider>
    </QueryClientProvider>
  );
}

describe('AuthGate', () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    setAuthRequired(false);
    router.replace.mockReset();
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
    fetchMock.mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith('/v1/auth/session')) return sessionResponse(false, false);
      return jsonResponse({ error: { code: 'not_found', message: 'Not found' } }, 404);
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('shows the loading skeleton until the session query answers', async () => {
    fetchMock.mockReturnValue(new Promise(() => {})); // never resolves
    renderGate();

    const status = await screen.findByRole('status');
    expect(status).toHaveAttribute('aria-label', 'Checking your session');
    expect(screen.queryByTestId('page-content')).not.toBeInTheDocument();
  });

  it('renders children for an anonymous visitor when auth is optional', async () => {
    renderGate();
    expect(await screen.findByTestId('page-content')).toBeInTheDocument();
    expect(router.replace).not.toHaveBeenCalled();
  });

  it('renders children for a signed-in visitor', async () => {
    fetchMock.mockImplementation(async (input: RequestInfo | URL) => {
      if (String(input).endsWith('/v1/auth/session')) return sessionResponse(true, false);
      return jsonResponse({ error: { code: 'not_found', message: 'Not found' } }, 404);
    });
    renderGate();
    expect(await screen.findByTestId('page-content')).toBeInTheDocument();
  });

  it('redirects a required-auth anonymous visitor to /login?next=... and hides content', async () => {
    fetchMock.mockImplementation(async (input: RequestInfo | URL) => {
      if (String(input).endsWith('/v1/auth/session')) return sessionResponse(false, true);
      return jsonResponse({ error: { code: 'not_found', message: 'Not found' } }, 404);
    });
    renderGate();

    expect(await screen.findByRole('status')).toBeInTheDocument();
    expect(screen.queryByTestId('page-content')).not.toBeInTheDocument();
    await waitFor(() => expect(router.replace).toHaveBeenCalledWith('/login?next=%2Freports'));
  });
});