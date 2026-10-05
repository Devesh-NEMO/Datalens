"""Authentication dependencies.

Auth is **optional by default**. ``AUTH_ENABLED=false`` means the API works with
no accounts at all, and every write still works — datasets are filed under an
auto-provisioned local user so the library has an owner. Turning auth on makes a
valid bearer token mandatory on the write endpoints; the read endpoints stay open
so a sign-in page can call ``/auth/session`` before it has a token.

The dependency resolves to three states rather than two, which is what the UI
actually needs to render:

* ``authenticated`` — a valid token identified a user.
* ``unauthenticated`` — no token was presented, which is fine while auth is off.
* ``forbidden`` — a token was presented but was wrong, expired or unverifiable.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Annotated

from fastapi import Depends, Request

from app.config import settings
from app.core.errors import AppException
from app.core.security import AuthConfigurationError, TokenPayload, decode_session_token


@dataclass(frozen=True)
class AuthContext:
    """Who the caller is, and whether that had to be established."""

    authenticated: bool
    user_id: str | None = None
    email: str | None = None
    #: True when a token was presented and rejected. Distinct from "no token",
    #: because a client holding a stale token should sign in again rather than
    #: quietly continue as anonymous.
    rejected: bool = False

    @property
    def owner_id(self) -> str | None:
        """The id datasets should be filed under, or None for the local user."""
        return self.user_id


def bearer_token(request: Request) -> str | None:
    """Extract the bearer token from the Authorization header.

    Returns None rather than raising on a malformed header: the caller decides
    whether that is fatal, based on whether auth is enabled.
    """
    header = request.headers.get("Authorization") or request.headers.get("authorization")
    if not header:
        return None
    scheme, _, raw = header.partition(" ")
    if scheme.lower() != "bearer" or not raw.strip():
        return None
    return raw.strip()


def resolve_auth(request: Request) -> AuthContext:
    """Work out the caller's identity without failing the request."""
    token = bearer_token(request)
    if token is None:
        return AuthContext(authenticated=False)

    try:
        payload: TokenPayload | None = decode_session_token(token)
    except AuthConfigurationError:
        # Auth is switched on but no signing secret exists. Refusing to guess is
        # correct; the detail matters for the operator, not the client.
        raise AppException(
            message="Authentication is not configured on this server.",
            code="auth_not_configured",
            hint=(
                "AUTH_SECRET is missing. Set it to a long random string, or set "
                "AUTH_ENABLED=false to run without accounts."
            ),
            status_code=503,
        ) from None

    if payload is None or payload.is_expired:
        return AuthContext(authenticated=False, rejected=True)

    return AuthContext(authenticated=True, user_id=payload.user_id, email=payload.email)


async def current_auth(auth: Annotated[AuthContext, Depends(resolve_auth)]) -> AuthContext:
    """The caller's identity. Never rejects on its own."""
    return auth


async def require_auth(auth: Annotated[AuthContext, Depends(resolve_auth)]) -> AuthContext:
    """Enforce authentication when ``AUTH_ENABLED`` is true.

    With auth off, an anonymous caller is passed straight through. That is what
    makes a fresh clone usable with no setup, and it is why the dependency does
    not read the token from a cookie: a browser session and an API client are
    both just bearer tokens here.
    """
    if auth.authenticated:
        return auth
    if not settings.auth_enabled:
        return auth

    if auth.rejected:
        raise AppException(
            message="Your session has expired.",
            code="auth_invalid_token",
            hint="Sign in again to continue.",
            status_code=401,
        )
    raise AppException(
        message="Sign in to continue.",
        code="auth_required",
        hint="Send 'Authorization: Bearer <token>' with your request.",
        status_code=401,
    )


__all__ = ["AuthContext", "bearer_token", "current_auth", "require_auth", "resolve_auth"]
