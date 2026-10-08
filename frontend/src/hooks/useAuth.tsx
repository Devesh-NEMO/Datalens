'use client';

/**
 * `AuthProvider` — the only place token logic meets React.
 *
 * Hierarchy (see `src/components/Providers.tsx`):
 * RootLayout → ThemeProvider → QueryClientProvider → AuthProvider → app.
 * No second theme, no second query client.
 *
 * Session state machine:
 * - `loading`   — the one boot-time `GET /v1/auth/session` has not answered.
 * - `authenticated` — the session response (or the last local sign-in) says so.
 * - `anonymous` — otherwise, including when the session call fails: auth being
 *   optional is the default, so failing open matches the backend's stance.
 *
 * Local sign-ins/sign-outs are mirrored through `override` so the status flips
 * synchronously with the action instead of waiting on a cache round trip —
 * otherwise the login page can briefly see a stale "authenticated" right after
 * logging out and bounce the user back.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import type { AnalyzeError } from '@/lib/api';
import {
  clearSession,
  fetchSession,
  forgetMemorySession,
  getAuthRequired,
  loginRequest,
  logoutRequest,
  persistAuthResponse,
  registerRequest,
  registerSessionEffects,
  SESSION_QUERY_KEY,
  SESSION_STORAGE_KEY,
  type AuthResponse,
  type AuthUser,
  type SessionResponse,
} from '@/lib/auth';

export type AuthStatus = 'loading' | 'authenticated' | 'anonymous';

export interface LoginInput {
  email: string;
  password: string;
  remember: boolean;
}

export interface RegisterInput {
  email: string;
  password: string;
  displayName: string;
}

export interface AuthContextValue {
  user: AuthUser | null;
  status: AuthStatus;
  /** True when the server rejects requests without a token (`AUTH_ENABLED=true`). */
  authRequired: boolean;
  login(input: LoginInput): Promise<AuthResponse>;
  register(input: RegisterInput): Promise<AuthResponse>;
  /** Logout never rejects: a failed network call still signs the tab out. */
  logout(): Promise<void>;
}

const ANONYMOUS: SessionResponse = {
  authenticated: false,
  user: null,
  auth_required: false,
  message: '',
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const router = useRouter();

  // Bumped whenever the server must be re-consulted (cross-tab change, logout,
  // 401). A new key means the observer builds a fresh query and fetches it,
  // which is deterministic even after `queryClient.clear()` destroyed the old
  // query instance the observer was holding.
  const [revision, setRevision] = useState(0);
  // Local knowledge that outranks the cache until the next server consult.
  const [override, setOverride] = useState<SessionResponse | null>(null);

  const sessionQuery = useQuery({
    queryKey: [...SESSION_QUERY_KEY, revision],
    queryFn: fetchSession,
    retry: false,
    staleTime: Infinity,
    refetchOnWindowFocus: false,
  });

  const data = override ?? sessionQuery.data;
  const status: AuthStatus =
    data === undefined
      ? 'loading'
      : data.authenticated && data.user
        ? 'authenticated'
        : 'anonymous';
  const user = data?.authenticated ? (data.user ?? null) : null;

  const reconsultServer = useCallback(() => {
    setOverride(null);
    setRevision((value) => value + 1);
  }, []);

  // Arm the central 401 handler (clear cache, maybe bounce to /login).
  useEffect(() => {
    registerSessionEffects({
      clearCache: () => {
        queryClient.clear();
        setOverride(ANONYMOUS);
        setRevision((value) => value + 1);
      },
      navigate: (href) => router.replace(href),
    });
    return () => registerSessionEffects(null);
  }, [queryClient, router]);

  // Cross-tab sync: sign out (or in) in one tab, every tab follows. Only
  // `localStorage` sessions can sync — `sessionStorage` is per-tab by design.
  useEffect(() => {
    const onStorage = (event: StorageEvent) => {
      if (event.key !== null && event.key !== SESSION_STORAGE_KEY) return;
      forgetMemorySession();
      reconsultServer();
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, [reconsultServer]);

  const login = useCallback(
    async (input: LoginInput): Promise<AuthResponse> => {
      const response = await loginRequest({ email: input.email, password: input.password });
      persistAuthResponse(response, input.remember);
      setOverride({
        authenticated: true,
        user: response.user,
        auth_required: getAuthRequired(),
        message: `Signed in as ${response.user.email}.`,
      });
      return response;
    },
    []
  );

  const register = useCallback(
    async (input: RegisterInput): Promise<AuthResponse> => {
      const response = await registerRequest({
        email: input.email,
        password: input.password,
        ...(input.displayName.trim() ? { display_name: input.displayName.trim() } : {}),
      });
      // The register form has no "remember me", so the safer default applies:
      // the session lives in sessionStorage (this tab) until the next sign-in.
      persistAuthResponse(response, false);
      setOverride({
        authenticated: true,
        user: response.user,
        auth_required: getAuthRequired(),
        message: `Signed in as ${response.user.email}.`,
      });
      return response;
    },
    []
  );

  const logout = useCallback(async (): Promise<void> => {
    await logoutRequest(); // stateless; failures are ignored by design
    clearSession();
    queryClient.clear();
    setOverride(ANONYMOUS);
    setRevision((value) => value + 1);
    router.replace('/login');
  }, [queryClient, router]);

  // No useMemo on purpose: `authRequired` is module state updated by
  // `fetchSession`, and every path that changes it lands in a render right
  // after (the query resolving, an override landing), so reading it here is
  // always current.
  const value: AuthContextValue = { user, status, authRequired: getAuthRequired(), login, register, logout };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

/**
 * Safe to call outside a provider so components can be rendered in isolation by
 * tests: the fallback is "anonymous, auth optional, actions unavailable".
 */
export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (context) return context;
  return {
    user: null,
    status: 'anonymous',
    authRequired: false,
    login: () => Promise.reject({ code: 'no_provider', message: 'AuthProvider missing.' } as AnalyzeError),
    register: () => Promise.reject({ code: 'no_provider', message: 'AuthProvider missing.' } as AnalyzeError),
    logout: () => Promise.resolve(),
  };
}
