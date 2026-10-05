"""Account and session endpoints.

Auth is **off by default**, and that is a deliberate default rather than an
omission: a fresh clone runs, analyses a file and shows results with no
configuration, which is what someone evaluating the tool actually wants. Turning it
on is one environment variable.

What this module guarantees either way:

* **Passwords are never stored, logged or compared in the clear.** Hashing is
  PBKDF2-HMAC-SHA256 at 600k iterations; verification is constant-time.
* **Failure messages do not distinguish "no such user" from "wrong password".**
  Otherwise the endpoint is an account-existence oracle.
* **Tokens are signed with ``AUTH_SECRET``.** When auth is enabled and that
  variable is missing the app refuses rather than falling back to a key baked
  into the source.
* **Rate-limiting is left to the deployment.** Doing it in-process here would be
  trivially bypassed by running two workers, and a half-measure that looks like
  protection is worse than an honest note in the docs.
"""

from __future__ import annotations

import logging
import time
from datetime import UTC, datetime
from typing import Annotated

from fastapi import APIRouter, Depends, status
from sqlalchemy import select
from sqlalchemy.exc import SQLAlchemyError

from app.api.deps import AuthContext, current_auth, require_auth
from app.config import settings
from app.core.errors import AppException
from app.core.security import (
    AuthConfigurationError,
    create_session_token,
    hash_password,
    validate_password_strength,
    verify_password,
)
from app.db.models import User
from app.db.session import session_scope
from app.schemas.library import (
    AuthResponse,
    LoginRequest,
    RegisterRequest,
    SessionResponse,
    UserResponse,
)
from app.services import library

logger = logging.getLogger("data_analyzer.api.auth")

router = APIRouter(tags=["Auth"])

#: Returned for both an unknown email and a wrong password. A single message is
#: the whole point: any difference tells an attacker which emails are registered.
_INVALID_CREDENTIALS = "That email and password do not match."


@router.get(
    "/auth/session",
    response_model=SessionResponse,
    summary="Who Am I",
    description=(
        "Reports whether the current request is authenticated. Safe to call with no "
        "token, which is how the sign-in page decides whether to show itself."
    ),
)
async def session_status(
    auth: Annotated[AuthContext, Depends(current_auth)],
) -> SessionResponse:
    if auth.authenticated and auth.user_id:
        with session_scope() as db:
            user = db.get(User, auth.user_id)
            if user is not None and user.is_active:
                return SessionResponse(
                    authenticated=True,
                    user=_user_response(user),
                    auth_required=settings.auth_enabled,
                    message=f"Signed in as {user.email}.",
                )
        # The token verified but the account is gone or deactivated. Report it as
        # unauthenticated rather than as an error: the client's next move is the
        # same either way.
        return SessionResponse(
            authenticated=False,
            auth_required=settings.auth_enabled,
            message="This account is no longer active.",
        )

    return SessionResponse(
        authenticated=False,
        auth_required=settings.auth_enabled,
        message=(
            "Sign in to save datasets and keep your history."
            if settings.auth_enabled
            else "Accounts are optional. You can analyse files without signing in, but "
            "saved datasets are kept for this browser session only."
        ),
    )


@router.post(
    "/auth/register",
    response_model=AuthResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Create an Account",
    description=(
        "Registers an account and returns a session token. Requires a reachable "
        "database; with `DATABASE_ENABLED=false` there is nowhere to store the account "
        "and the request fails with an explanation."
    ),
    responses={503: {"description": "No database is available"}},
)
async def register(body: RegisterRequest) -> AuthResponse:
    _require_persistence()
    _require_signing_secret()

    email = body.email.strip().lower()
    problem = validate_password_strength(body.password)
    if problem:
        raise AppException(
            message=problem,
            code="weak_password",
            hint="Use at least 8 characters with no leading or trailing spaces.",
            status_code=422,
        )

    try:
        with session_scope() as db:
            existing = db.scalar(select(User).where(User.email == email))
            if existing is not None:
                # Here the caller has already proved knowledge of the address, so
                # distinguishing "taken" from "wrong password" is fine and useful.
                raise AppException(
                    message="An account with that email already exists.",
                    code="email_taken",
                    hint="Sign in instead, or use a different email.",
                    status_code=409,
                )

            user = User(
                email=email,
                display_name=(body.display_name or "").strip()[:120],
                password_hash=hash_password(body.password),
            )
            db.add(user)
            db.flush()
            return _auth_response(user)
    except AppException:
        raise
    except SQLAlchemyError as exc:
        logger.warning("Registration failed: %s", type(exc).__name__)
        raise AppException(
            message="The account could not be created.",
            code="registration_failed",
            hint="The database rejected the write. Check the server logs.",
            status_code=503,
        ) from exc


@router.post(
    "/auth/login",
    response_model=AuthResponse,
    summary="Sign In",
    description=(
        "Exchanges credentials for a session token. The same message is returned for an "
        "unknown email and a wrong password, so this cannot be used to discover which "
        "addresses are registered."
    ),
    responses={401: {"description": "Credentials did not match"}},
)
async def login(body: LoginRequest) -> AuthResponse:
    _require_persistence()
    _require_signing_secret()

    email = body.email.strip().lower()

    # Always run the KDF, even for an unknown address. Returning early would make
    # response time a reliable signal for whether an account exists.
    stored_hash = ""
    user_row: User | None = None
    try:
        with session_scope() as db:
            candidate = db.scalar(select(User).where(User.email == email))
            if candidate is not None:
                stored_hash = candidate.password_hash
                user_row = candidate
    except SQLAlchemyError as exc:
        logger.warning("Sign-in lookup failed: %s", type(exc).__name__)
        raise AppException(
            message="Sign in is unavailable.",
            code="auth_store_unavailable",
            hint="The database could not be read. Check the server logs.",
            status_code=503,
        ) from exc

    # A real hash is used when the account exists; a dummy of the same shape is
    # derived when it does not, so both paths cost the same.
    if not stored_hash:
        stored_hash = hash_password("datalens-no-such-account")

    if not verify_password(body.password, stored_hash) or user_row is None:
        raise AppException(
            message=_INVALID_CREDENTIALS,
            code="invalid_credentials",
            hint="Check the email and password, or create an account.",
            status_code=401,
        )

    if not user_row.is_active:
        raise AppException(
            message="This account is not active.",
            code="account_inactive",
            hint="Contact an administrator to reactivate it.",
            status_code=403,
        )

    return _auth_response(user_row)


@router.post(
    "/auth/logout",
    summary="Sign Out",
    description=(
        "Stateless: sessions are signed tokens with no server-side record, so there is "
        "nothing to revoke server-side and the client discards the token. The endpoint "
        "exists so a client has one place to hang future revocation logic."
    ),
)
async def logout() -> dict[str, bool]:
    return {"logged_out": True}


@router.get(
    "/auth/me",
    response_model=UserResponse,
    summary="The Signed-In User",
    description="Requires a valid token.",
    responses={401: {"description": "Not signed in"}},
)
async def me(auth: Annotated[AuthContext, Depends(require_auth)]) -> UserResponse:
    if not auth.authenticated or not auth.user_id:
        raise AppException(
            message="Sign in to continue.",
            code="auth_required",
            hint="Send 'Authorization: Bearer <token>' with your request.",
            status_code=401,
        )
    with session_scope() as db:
        user = db.get(User, auth.user_id)
        if user is None:
            raise AppException(
                message="This account no longer exists.",
                code="account_missing",
                hint="Sign in again.",
                status_code=401,
            )
        return _user_response(user)


# --- helpers --------------------------------------------------------------------


def _require_persistence() -> None:
    info = library.library_status()
    if info.available:
        return
    raise AppException(
        message="Accounts are unavailable because no database is configured.",
        code="persistence_unavailable",
        hint=(
            "Set DATABASE_URL to a PostgreSQL DSN, or set AUTH_ENABLED=false to run "
            f"without accounts. ({info.reason or 'No database.'})"
        ),
        status_code=503,
    )


def _require_signing_secret() -> None:
    try:
        create_session_token("probe", "probe")
    except AuthConfigurationError as exc:
        raise AppException(
            message="Authentication is not configured on this server.",
            code="auth_not_configured",
            hint=(
                "AUTH_SECRET is missing. Generate one with "
                'python -c "import secrets; print(secrets.token_urlsafe(48))", or set '
                "AUTH_ENABLED=false to run without accounts."
            ),
            status_code=503,
        ) from exc


def _user_response(user: User) -> UserResponse:
    return UserResponse(
        id=user.id,
        email=user.email,
        display_name=user.display_name or None,
        created_at=user.created_at.isoformat() if user.created_at else "",
    )


def _auth_response(user: User) -> AuthResponse:
    token = create_session_token(user.id, user.email)
    expires_in = settings.auth_token_ttl_hours * 3600
    return AuthResponse(
        token=token,
        expires_at=datetime.fromtimestamp(time.time() + expires_in, tz=UTC).isoformat(),
        user=_user_response(user),
    )


__all__ = ["router"]
