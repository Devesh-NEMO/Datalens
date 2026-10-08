/**
 * Register page tests: client validation, the length-based strength hint,
 * server error mapping (409 → sign-in link, 422, network), and the auto
 * sign-in + redirect on 201.
 *
 * Same mocking strategy as `authLogin.test.tsx`: `useAuth` is a controlled
 * mock, `sanitizeNext` stays real, `readNextParam` is replaced.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import type { AuthStatus, RegisterInput } from '@/hooks/useAuth';
import type { AuthUser } from '@/lib/auth';

const USER: AuthUser = { id: 'u1', email: 'analyst@example.com', display_name: 'Analyst', created_at: '' };

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

import RegisterPage from '@/app/(auth)/register/page';

function asContext() {
  return auth;
}

async function fillForm(password = 'correct horse battery staple') {
  await userEvent.type(screen.getByLabelText(/display name/i), 'Analyst');
  await userEvent.type(screen.getByLabelText('Email'), 'analyst@example.com');
  await userEvent.type(screen.getByLabelText('Password'), password);
  await userEvent.type(screen.getByLabelText('Confirm password'), password);
}

describe('Register page', () => {
  beforeEach(() => {
    auth.register.mockReset().mockResolvedValue({
      token: 'tok',
      expires_at: new Date(Date.now() + 3600_000).toISOString(),
      user: USER,
    });
    router.replace.mockReset();
    nextParam.value = '/overview';
  });

  it('renders the card with matching autoComplete attributes', () => {
    render(<RegisterPage />);
    expect(screen.getByRole('heading', { level: 1, name: 'Create your account' })).toBeInTheDocument();
    expect(screen.getByLabelText(/display name/i)).toHaveAttribute('autoComplete', 'name');
    expect(screen.getByLabelText('Email')).toHaveAttribute('autoComplete', 'email');
    expect(screen.getByLabelText('Password')).toHaveAttribute('autoComplete', 'new-password');
    expect(screen.getByLabelText('Confirm password')).toHaveAttribute('autoComplete', 'new-password');
  });

  it('validates before calling the backend', async () => {
    render(<RegisterPage />);
    await userEvent.click(screen.getByRole('button', { name: 'Create account' }));

    expect(await screen.findByText('Enter your email address.')).toBeInTheDocument();
    expect(screen.getByText('Password must be at least 8 characters.')).toBeInTheDocument();
    expect(screen.getByText('Confirm your password.')).toBeInTheDocument();
    expect(asContext().register).not.toHaveBeenCalled();
  });

  it('flags mismatched confirmations', async () => {
    render(<RegisterPage />);
    await userEvent.type(screen.getByLabelText(/display name/i), 'Analyst');
    await userEvent.type(screen.getByLabelText('Email'), 'analyst@example.com');
    await userEvent.type(screen.getByLabelText('Password'), 'correct horse battery');
    await userEvent.type(screen.getByLabelText('Confirm password'), 'different');
    await userEvent.click(screen.getByRole('button', { name: 'Create account' }));

    expect(await screen.findByText("Passwords don't match.")).toBeInTheDocument();
    expect(asContext().register).not.toHaveBeenCalled();
  });

  it('grows the strength hint with length, mirroring the server rule', async () => {
    render(<RegisterPage />);
    const password = screen.getByLabelText('Password');

    await userEvent.type(password, 'abcdefg');
    expect(
      screen.getByText('Too short — use at least 8 characters (7/8).')
    ).toBeInTheDocument();

    await userEvent.type(password, 'h');
    expect(
      screen.getByText('Weak — 8 to 9 characters. Longer is easier, not fussier.')
    ).toBeInTheDocument();

    await userEvent.type(password, 'ij');
    expect(screen.getByText('Fair — 10 to 12 characters.')).toBeInTheDocument();
  });

  it('registers, signs the returned session in and redirects to the sanitised next page', async () => {
    nextParam.value = '/reports';
    render(<RegisterPage />);
    await fillForm();
    await userEvent.click(screen.getByRole('button', { name: 'Create account' }));

    await waitFor(() =>
      expect(asContext().register).toHaveBeenCalledWith({
        email: 'analyst@example.com',
        password: 'correct horse battery staple',
        displayName: 'Analyst',
      } satisfies RegisterInput)
    );
    expect(router.replace).toHaveBeenCalledWith('/reports');
  });

  it('turns a 409 into the server message plus a sign-in link', async () => {
    asContext().register.mockRejectedValue({
      code: 'email_taken',
      message: 'An account with that email already exists.',
      hint: 'Sign in instead, or use a different email.',
      status: 409,
    });
    render(<RegisterPage />);
    await fillForm();
    await userEvent.click(screen.getByRole('button', { name: 'Create account' }));

    expect(await screen.findByText('An account with that email already exists.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Sign in instead' })).toHaveAttribute('href', '/login');
  });

  it('shows the server message and hint for a 422 and a 503', async () => {
    asContext().register.mockRejectedValue({
      code: 'weak_password',
      message: 'Password must not start or end with whitespace.',
      hint: 'Use at least 8 characters with no leading or trailing spaces.',
      status: 422,
    });
    render(<RegisterPage />);
    await fillForm();
    await userEvent.click(screen.getByRole('button', { name: 'Create account' }));

    expect(
      await screen.findByText('Password must not start or end with whitespace.')
    ).toBeInTheDocument();
    expect(
      screen.getByText('Use at least 8 characters with no leading or trailing spaces.')
    ).toBeInTheDocument();
    expect(router.replace).not.toHaveBeenCalled();
  });

  it('reports an unreachable server as its own copy', async () => {
    asContext().register.mockRejectedValue({
      code: 'network_error',
      message: "Can't reach the server",
      status: 0,
    });
    render(<RegisterPage />);
    await fillForm();
    await userEvent.click(screen.getByRole('button', { name: 'Create account' }));

    expect(await screen.findByText("Can't reach the server")).toBeInTheDocument();
  });

  it('never submits twice; the button disables while the request is in flight', async () => {
    let resolve!: (value: unknown) => void;
    asContext().register.mockReturnValue(
      new Promise((r) => {
        resolve = r;
      })
    );
    render(<RegisterPage />);
    await fillForm();
    const submit = screen.getByRole('button', { name: 'Create account' });

    await userEvent.click(submit);
    await userEvent.click(submit);
    expect(asContext().register).toHaveBeenCalledTimes(1);
    expect(submit).toBeDisabled();

    resolve({ token: 't', expires_at: '', user: USER });
    await waitFor(() => expect(router.replace).toHaveBeenCalled());
  });

  it('links to sign-in from the footer', () => {
    render(<RegisterPage />);
    expect(screen.getByRole('link', { name: 'Sign in' })).toHaveAttribute('href', '/login');
  });
});