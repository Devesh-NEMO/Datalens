/**
 * Login page tests: validation, server error mapping (401/403/503/network),
 * success redirect, double-submit guard, and the optional-auth affordances.
 *
 * The page's state comes from `useAuth`, so that is mocked (a real provider is
 * exercised in `authSession.test.tsx`); `next/navigation` and `next/link` are
 * mocked the same way. `readNextParam` is replaced but `sanitizeNext` stays
 * real, so the redirect path is still validated.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import type { AuthStatus, LoginInput } from '@/hooks/useAuth';
import type { AuthUser } from '@/lib/auth';

const USER: AuthUser = { id: 'u1', email: 'analyst@example.com', display_name: null, created_at: '' };

const auth = vi.hoisted(() => ({
  user: null as AuthUser | null,
  status: 'anonymous' as AuthStatus,
  authRequired: false,
  login: vi.fn(),
  register: vi.fn(),
  logout: vi.fn(),
}));

const router = vi.hoisted(() => ({ replace: vi.fn(), push: vi.fn() }));

const nextParam = vi.hoisted(() => ({ value: '/overview' }));

vi.mock('next/navigation', () => ({
  useRouter: () => router,
}));

vi.mock('next/link', () => ({
  default: (props: { href: string; children: ReactNode; className?: string }) => (
    <a href={props.href} className={props.className}>
      {props.children}
    </a>
  ),
}));

vi.mock('@/hooks/useAuth', () => ({
  useAuth: () => auth,
}));

vi.mock('@/lib/auth', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/auth')>();
  return { ...actual, readNextParam: () => nextParam.value };
});

import LoginPage from '@/app/(auth)/login/page';

function asContext() {
  return auth;
}

async function fillCredentials(email = 'analyst@example.com', password = 's3cret!pw') {
  await userEvent.type(screen.getByLabelText('Email'), email);
  await userEvent.type(screen.getByLabelText('Password'), password);
}

describe('Login page', () => {
  beforeEach(() => {
    auth.user = null;
    auth.status = 'anonymous';
    auth.authRequired = false;
    auth.login.mockReset().mockResolvedValue({
      token: 'tok',
      expires_at: new Date(Date.now() + 3600_000).toISOString(),
      user: USER,
    });
    router.replace.mockReset();
    nextParam.value = '/overview';
  });

  it('renders the sign-in card with accessible fields', () => {
    render(<LoginPage />);
    expect(screen.getByRole('heading', { level: 1, name: 'Sign in' })).toBeInTheDocument();
    expect(screen.getByLabelText('Email')).toHaveAttribute('autocomplete', 'email');
    expect(screen.getByLabelText('Password')).toHaveAttribute('autocomplete', 'current-password');
    expect(screen.getByLabelText('Password')).toHaveAttribute('type', 'password');
  });

  it('reveals and hides the password via the toggle', async () => {
    render(<LoginPage />);
    const toggle = screen.getByRole('button', { name: 'Show password' });
    await userEvent.type(screen.getByLabelText('Password'), 's3cret');
    await userEvent.click(toggle);
    expect(screen.getByLabelText('Password')).toHaveAttribute('type', 'text');
    await userEvent.click(screen.getByRole('button', { name: 'Hide password' }));
    expect(screen.getByLabelText('Password')).toHaveAttribute('type', 'password');
  });

  it('blocks an empty submit with inline errors and never calls the backend', async () => {
    render(<LoginPage />);
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }));

    expect(await screen.findByText('Enter your email address.')).toBeInTheDocument();
    expect(screen.getByText('Enter your password.')).toBeInTheDocument();
    expect(asContext().login).not.toHaveBeenCalled();
  });

  it('rejects an email that is not shaped like one', async () => {
    render(<LoginPage />);
    await fillCredentials('nope', 'whatever');
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }));

    expect(await screen.findByText('Enter a valid email address.')).toBeInTheDocument();
    expect(asContext().login).not.toHaveBeenCalled();
  });

  it('signs in, stores the session choice and redirects to the sanitised next page', async () => {
    nextParam.value = '/reports';
    render(<LoginPage />);
    await fillCredentials();
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }));

    await waitFor(() =>
      expect(asContext().login).toHaveBeenCalledWith({
        email: 'analyst@example.com',
        password: 's3cret!pw',
        remember: false,
      } satisfies LoginInput)
    );
    expect(router.replace).toHaveBeenCalledWith('/reports');
  });

  it('passes remember-me through to the provider', async () => {
    render(<LoginPage />);
    await userEvent.click(screen.getByLabelText('Remember me'));
    await fillCredentials();
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }));

    await waitFor(() =>
      expect(asContext().login).toHaveBeenCalledWith(
        expect.objectContaining({ remember: true })
      )
    );
  });

  it('shows the server sentence verbatim on 401 and keeps the password for a retry', async () => {
    asContext().login.mockRejectedValue({
      code: 'invalid_credentials',
      message: 'That email and password do not match.',
      status: 401,
    });
    render(<LoginPage />);
    await fillCredentials();
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }));

    expect(
      await screen.findByText('That email and password do not match.')
    ).toBeInTheDocument();
    // The password survives the failure so "Try again" works without retyping.
    expect(screen.getByLabelText('Password')).toHaveValue('s3cret!pw');
    expect(router.replace).not.toHaveBeenCalled();
  });

  it('maps a 403 inactive account to its own copy', async () => {
    asContext().login.mockRejectedValue({
      code: 'account_inactive',
      message: 'This account is not active.',
      status: 403,
    });
    render(<LoginPage />);
    await fillCredentials();
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }));

    expect(await screen.findByText('This account is no longer active.')).toBeInTheDocument();
  });

  it('shows a hint alongside a 503 and a retry for a network failure', async () => {
    asContext().login.mockRejectedValue({
      code: 'service_unavailable',
      message: 'Accounts are temporarily unavailable.',
      hint: 'Check the server logs.',
      status: 503,
    });
    render(<LoginPage />);
    await fillCredentials();
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }));

    expect(await screen.findByText('Accounts are temporarily unavailable.')).toBeInTheDocument();
    expect(screen.getByText('Check the server logs.')).toBeInTheDocument();

    // Network failure → "can't reach the server" + a retry action that replays
    // the same credentials.
    asContext().login.mockRejectedValue({
      code: 'network_error',
      message: "Can't reach the server",
      status: 0,
    });
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(await screen.findByText("Can't reach the server")).toBeInTheDocument();

    asContext().login.mockReset().mockResolvedValue({
      token: 'tok2',
      expires_at: new Date(Date.now() + 3600_000).toISOString(),
      user: USER,
    });
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
    await waitFor(() =>
      expect(asContext().login).toHaveBeenCalledWith({
        email: 'analyst@example.com',
        password: 's3cret!pw',
        remember: false,
      })
    );
    expect(router.replace).toHaveBeenCalledWith('/overview');
  });

  it('never submits twice while a request is in flight', async () => {
    let resolve!: (value: unknown) => void;
    asContext().login.mockReturnValue(
      new Promise((r) => {
        resolve = r;
      })
    );
    render(<LoginPage />);
    await fillCredentials();
    const submit = screen.getByRole('button', { name: 'Sign in' });

    await userEvent.click(submit);
    await userEvent.click(submit);
    await userEvent.click(submit);
    expect(asContext().login).toHaveBeenCalledTimes(1);
    expect(submit).toBeDisabled();

    resolve({ token: 't', expires_at: '', user: USER });
    await waitFor(() => expect(router.replace).toHaveBeenCalled());
  });

  it('offers "continue without signing in" when auth is optional', () => {
    render(<LoginPage />);
    const link = screen.getByRole('link', { name: 'Continue without signing in' });
    expect(link).toHaveAttribute('href', '/overview');
    expect(screen.getByText(/kept for this browser session only/)).toBeInTheDocument();
  });

  it('hides "continue without signing in" when auth is required', () => {
    auth.authRequired = true;
    render(<LoginPage />);
    expect(
      screen.queryByRole('link', { name: 'Continue without signing in' })
    ).not.toBeInTheDocument();
  });

  it('bounces an already-signed-in visitor straight to the landing page', async () => {
    auth.user = USER;
    auth.status = 'authenticated';
    render(<LoginPage />);
    await waitFor(() => expect(router.replace).toHaveBeenCalledWith('/overview'));
  });

  it('links to registration from the footer', () => {
    render(<LoginPage />);
    expect(screen.getByRole('link', { name: 'Create an account' })).toHaveAttribute(
      'href',
      '/register'
    );
  });

  it('keeps the error region mounted with aria-live so screen readers register it', () => {
    const { container } = render(<LoginPage />);
    const live = container.querySelector('[aria-live="polite"]');
    expect(live).not.toBeNull();
    expect(live).toHaveAttribute('aria-live', 'polite');
  });
});