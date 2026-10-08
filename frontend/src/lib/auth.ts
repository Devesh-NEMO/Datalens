/**
 * The single auth module: session storage, the auth endpoints, and the rules
 * that decide what "signed in" means.
 *
 * Storage notes
 * -------------
 * The session token is a bearer token held in `localStorage` (when the user
 * asked to be remembered) or `sessionStorage` (tab session only), which keeps
 * the app working with a stateless backend and no cookie plumbing. The tradeoff
 * is the classic one: **anything that can run JavaScript on this origin can read
 * the token**, so XSS becomes full account compromise. Mitigations today are
 * ordinary hygiene (no token in URLs, no token in the DOM, no logging of
 * secrets). The next hardening step — documented in the README — is an
 * httpOnly cookie: a Next.js route handler proxies `/v1/auth/*`, sets the token
 * in an httpOnly + SameSite cookie, and `apiFetch` sends requests cookie-first.
 * That moves theft of the token out of reach of injected scripts. It is a
 * deliberate *future* step, not implemented here.
 *
 * Every storage read/write is wrapped in try/catch: Safari private mode and
 * blocked-storage setups throw on access, and a failed read must look like
 * "signed out", never like a crash. A tiny in-memory copy covers the case
 * where writes fail but the tab stays open, so sign-in still works for the
 * session.
 */

import { apiFetch, parseError, registerAuthHooks } from './api';

/** One key, so the cross-tab `storage` event has exactly one thing to watch. */
export const SESSION_STORAGE_KEY = 'datalens.auth.session';

/** TanStack Query key for `GET /v1/auth/session`. */
export const SESSION_QUERY_KEY = ['auth', 'session'] as const;

/** Default landing page after signing in (spec: `/overview`, see README). */
export const DEFAULT_LANDING = '/overview';

export interface AuthUser {
  id: string;
  email: string;
  display_name: string | null;
  created_at: string;
}

export interface SessionResponse {
  authenticated: boolean;
  user: AuthUser | null;
  auth_required: boolean;
  message: string;
}

export interface AuthResponse {
  token: string;
  expires_at: string;
  user: AuthUser;
}

interface StoredSession {
  token: string;
  expiresAt: string;
}

/**
 * `auth_required` as last reported by `GET /v1/auth/session`.
 *
 * Module state rather than React state because the 401 handler in `apiFetch`
 * runs outside any component tree. It starts `false`: before the session
 * response arrives we do not know that auth is on, and failing open there only
 * costs a moment — the AuthGate flips to redirect as soon as the answer lands.
 */
let authRequired = false;

export function getAuthRequired(): boolean {
  return authRequired;
}

export function setAuthRequired(value: boolean): void {
  authRequired = value;
}

// --- storage -----------------------------------------------------------------

/**
 * Used only when both Web Storage objects are unusable. Survives client-side
 * navigations (same module instance), dies on reload — strictly better than
 * losing the token the user just earned.
 */
let memorySession: StoredSession | null = null;

function parseSession(raw: string | null): StoredSession | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<StoredSession>;
    if (typeof parsed.token !== 'string' || typeof parsed.expiresAt !== 'string') return null;
    return { token: parsed.token, expiresAt: parsed.expiresAt };
  } catch {
    return null;
  }
}

/** Expiry is decided locally — never by a network round trip. */
export function isExpired(expiresAt: string): boolean {
  const at = Date.parse(expiresAt);
  // An unreadable timestamp is treated as expired: fail closed.
  if (Number.isNaN(at)) return true;
  return Date.now() >= at;
}

function readStoredSession(): StoredSession | null {
  try {
    const raw = sessionStorage.getItem(SESSION_STORAGE_KEY) ?? localStorage.getItem(SESSION_STORAGE_KEY);
    const parsed = parseSession(raw);
    if (parsed) return parsed;
    // Storage answered but held nothing: an earlier write may have failed, so
    // fall back to the in-memory copy.
    return memorySession;
  } catch {
    return memorySession;
  }
}

/**
 * The current bearer token, or null when signed out.
 *
 * An expired token is cleared here, on the spot: an expired session is a signed
 * out session, decided without touching the network.
 */
export function getToken(): string | null {
  const session = readStoredSession();
  if (!session) return null;
  if (isExpired(session.expiresAt)) {
    clearSession();
    return null;
  }
  return session.token;
}

/** True when a usable (unexpired) session exists. */
export function hasSession(): boolean {
  return getToken() !== null;
}

/**
 * Persist a session. "Remember me" picks the storage; either way both stores
 * are cleared first so at most one token is ever live in this browser profile.
 */
export function setSession(session: StoredSession, remember: boolean): void {
  clearSession();
  memorySession = session;
  const raw = JSON.stringify(session);
  try {
    if (remember) {
      localStorage.setItem(SESSION_STORAGE_KEY, raw);
    } else {
      sessionStorage.setItem(SESSION_STORAGE_KEY, raw);
    }
  } catch {
    // Storage unavailable or full: the in-memory copy keeps this tab signed in.
  }
}

/** Drop the session from every store. Used by logout, 401 handling and expiry. */
export function clearSession(): void {
  memorySession = null;
  try {
    localStorage.removeItem(SESSION_STORAGE_KEY);
  } catch {
    // Ignore: nothing to clear if storage is unreachable.
  }
  try {
    sessionStorage.removeItem(SESSION_STORAGE_KEY);
  } catch {
    // Ignore.
  }
}

/**
 * Called on the `storage` event: another tab changed the shared session, so the
 * in-memory fallback must not shadow it before the session query re-reads.
 */
export function forgetMemorySession(): void {
  memorySession = null;
}

// --- redirect safety ---------------------------------------------------------

/**
 * Validate a `?next=` target so a crafted link cannot bounce the user off-site.
 *
 * Accepted: same-origin relative paths (`/reports`). Everything else — no
 * value, `//host`, `/\host`, absolute URLs, or the auth pages themselves (to
 * avoid a login ↔ login loop) — falls back to the default landing page.
 */
export function sanitizeNext(raw: string | null | undefined): string {
  if (!raw) return DEFAULT_LANDING;
  // A leading backslash is normalised to `/` by browsers, which would turn
  // `/\evil.com` into a protocol-relative URL. Reject both.
  if (!raw.startsWith('/') || raw.startsWith('//') || raw.startsWith('/\\')) {
    return DEFAULT_LANDING;
  }
  if (/[\u0000-\u001f]/.test(raw)) return DEFAULT_LANDING;
  if (raw === '/login' || raw.startsWith('/login/') || raw === '/register' || raw.startsWith('/register/')) {
    return DEFAULT_LANDING;
  }
  return raw;
}

/**
 * Read `?next=` from the current URL.
 *
 * Deliberately not `useSearchParams`: this runs inside event handlers and
 * effects (never during render), which keeps the auth pages free of a Suspense
 * boundary and of hydration mismatches. See the Next.js docs for exactly this
 * pattern.
 */
export function readNextParam(): string {
  if (typeof window === 'undefined') return DEFAULT_LANDING;
  try {
    return sanitizeNext(new URLSearchParams(window.location.search).get('next'));
  } catch {
    return DEFAULT_LANDING;
  }
}

// --- endpoints ---------------------------------------------------------------

const JSON_HEADERS = { 'Content-Type': 'application/json' };

/** `GET /v1/auth/session` — safe with no token, and how we learn `auth_required`. */
export async function fetchSession(): Promise<SessionResponse> {
  // getToken() clears an expired token, so a stale session never leaves the tab.
  getToken();

  const res = await apiFetch('/v1/auth/session');
  if (!res.ok) throw await parseError(res);

  const data = (await res.json()) as SessionResponse;
  setAuthRequired(Boolean(data.auth_required));
  return data;
}

/** `POST /v1/auth/register` → 201 with a fresh token. Does not store it. */
export async function registerRequest(input: {
  email: string;
  password: string;
  display_name?: string;
}): Promise<AuthResponse> {
  const res = await apiFetch('/v1/auth/register', {
    method: 'POST',
    headers: JSON_HEADERS,
    body: JSON.stringify({
      email: input.email,
      password: input.password,
      ...(input.display_name ? { display_name: input.display_name } : {}),
    }),
  });
  if (!res.ok) throw await parseError(res);
  return (await res.json()) as AuthResponse;
}

/** `POST /v1/auth/login` → token. Does not store it; `useAuth` decides where. */
export async function loginRequest(input: { email: string; password: string }): Promise<AuthResponse> {
  const res = await apiFetch('/v1/auth/login', {
    method: 'POST',
    headers: JSON_HEADERS,
    body: JSON.stringify({ email: input.email, password: input.password }),
  });
  if (!res.ok) throw await parseError(res);
  return (await res.json()) as AuthResponse;
}

/** `POST /v1/auth/logout` — stateless, so failure means nothing to undo. */
export async function logoutRequest(): Promise<void> {
  try {
    await apiFetch('/v1/auth/logout', { method: 'POST', headers: JSON_HEADERS });
  } catch {
    // Network failure while signing out: local state is cleared regardless.
  }
}

/** Adopt a token response as the current session. */
export function persistAuthResponse(response: AuthResponse, remember: boolean): void {
  setSession({ token: response.token, expiresAt: response.expires_at }, remember);
}

// --- central 401 handling ----------------------------------------------------

/**
 * The two things a 401 handler needs that live outside this module: clearing
 * the React Query cache and moving the router. Registered by `AuthProvider`.
 */
export interface SessionEffects {
  clearCache: () => void;
  navigate: (href: string) => void;
}

let sessionEffects: SessionEffects | null = null;

export function registerSessionEffects(effects: SessionEffects | null): void {
  sessionEffects = effects;
}

/**
 * Runs when a request that carried a token comes back 401.
 *
 * The session is gone whatever happens. The bounce to `/login` only happens
 * when the server has told us auth is required — with auth optional a stale
 * token should degrade to anonymous, not hijack the page the user is on.
 */
export function handleUnauthorized(): void {
  clearSession();
  sessionEffects?.clearCache();
  if (!authRequired || !sessionEffects) return;

  const current =
    typeof window !== 'undefined' ? window.location.pathname + window.location.search : '/';
  sessionEffects.navigate(`/login?next=${encodeURIComponent(current)}`);
}

// Arming the API client is a side effect of importing this module, which the
// AuthProvider (and any test that touches sessions) does before any request.
registerAuthHooks({ getToken, onUnauthorized: handleUnauthorized });
