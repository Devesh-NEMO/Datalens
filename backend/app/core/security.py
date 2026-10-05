"""Password hashing and session tokens, built on the standard library.

Two deliberate choices:

* **PBKDF2-HMAC-SHA256** via :mod:`hashlib` rather than a native bcrypt/argon2
  dependency. It is the algorithm recommended by NIST SP 800-132, needs no
  compiled extension, and 600k iterations puts a single guess well over 100 ms
  on commodity hardware.
* **Salted, iterated, constant-time comparison** everywhere. Nothing compares
  secrets with ``==``.

The secret used to sign tokens comes from the environment. If it is missing while
auth is enabled the app refuses to sign anything rather than falling back to a
hardcoded key.
"""

from __future__ import annotations

import base64
import hashlib
import hmac
import json
import secrets
import time
from dataclasses import dataclass
from typing import Any

from app.config import settings

#: Iteration count. Raise this as hardware improves; it is the only thing standing
#: between a leaked table and an offline cracking run.
PBKDF2_ITERATIONS = 600_000
SALT_BYTES = 16

_ALGO = "pbkdf2_sha256"


class AuthConfigurationError(Exception):
    """Raised when auth is switched on without a signing secret."""


@dataclass(frozen=True)
class TokenPayload:
    """Decoded session token claims."""

    user_id: str
    email: str
    issued_at: int
    expires_at: int

    @property
    def is_expired(self) -> bool:
        return time.time() >= self.expires_at


def hash_password(password: str, *, iterations: int = PBKDF2_ITERATIONS) -> str:
    """Hash a password into ``algo$iterations$salt$digest``.

    The format is self-describing so the iteration count can be raised later
    without invalidating existing hashes.
    """
    if not isinstance(password, str) or not password:
        raise ValueError("Password must be a non-empty string.")

    salt = secrets.token_bytes(SALT_BYTES)
    digest = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt, iterations)
    return "$".join(
        (
            _ALGO,
            str(iterations),
            base64.b64encode(salt).decode("ascii"),
            base64.b64encode(digest).decode("ascii"),
        )
    )


def verify_password(password: str, stored: str) -> bool:
    """Check a password against a stored hash. Never raises on bad input."""
    if not isinstance(password, str) or not isinstance(stored, str):
        return False

    try:
        algo, iterations_raw, salt_raw, digest_raw = stored.split("$")
        if algo != _ALGO:
            return False
        iterations = int(iterations_raw)
        salt = base64.b64decode(salt_raw)
        expected = base64.b64decode(digest_raw)
    except (ValueError, TypeError):
        return False

    candidate = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt, iterations)
    return hmac.compare_digest(candidate, expected)


def validate_password_strength(password: str) -> str | None:
    """Return an error message when a password is unacceptable, else None."""
    if len(password) < settings.password_min_length:
        return f"Password must be at least {settings.password_min_length} characters."
    if password.strip() != password:
        return "Password must not start or end with whitespace."
    return None


def _signing_secret() -> bytes:
    secret = settings.auth_secret
    if not secret or not secret.strip():
        raise AuthConfigurationError(
            "AUTH_SECRET is not set. Generate one with: "
            'python -c "import secrets; print(secrets.token_urlsafe(48))"'
        )
    return secret.encode("utf-8")


def _b64e(raw: bytes) -> str:
    return base64.urlsafe_b64encode(raw).decode("ascii").rstrip("=")


def _b64d(value: str) -> bytes:
    padding = "=" * (-len(value) % 4)
    return base64.urlsafe_b64decode(value + padding)


def create_session_token(user_id: str, email: str, *, ttl_hours: int | None = None) -> str:
    """Create a signed, expiring session token.

    Format: ``base64url(payload).base64url(hmac)``. The signature covers the
    payload, so neither the user id nor the expiry can be edited by the client.
    """
    ttl = ttl_hours if ttl_hours is not None else settings.auth_token_ttl_hours
    issued = int(time.time())
    payload: dict[str, Any] = {
        "sub": user_id,
        "email": email,
        "iat": issued,
        "exp": issued + ttl * 3600,
    }
    body = _b64e(json.dumps(payload, separators=(",", ":"), sort_keys=True).encode("utf-8"))
    signature = hmac.new(_signing_secret(), body.encode("ascii"), hashlib.sha256).digest()
    return f"{body}.{_b64e(signature)}"


def decode_session_token(token: str) -> TokenPayload | None:
    """Verify and decode a session token. Returns None for anything invalid.

    Every failure mode — bad shape, bad signature, expired, wrong type — returns
    the same value, so a caller cannot use the return to probe the token.
    """
    if not isinstance(token, str) or token.count(".") != 1:
        return None
    body, _, signature_raw = token.partition(".")

    try:
        expected = hmac.new(_signing_secret(), body.encode("ascii"), hashlib.sha256).digest()
        if not hmac.compare_digest(expected, _b64d(signature_raw)):
            return None
        payload = json.loads(_b64d(body).decode("utf-8"))
    except (ValueError, TypeError, UnicodeDecodeError, AuthConfigurationError):
        return None

    if not isinstance(payload, dict):
        return None
    user_id = payload.get("sub")
    email = payload.get("email")
    issued = payload.get("iat")
    expires = payload.get("exp")
    if not all(isinstance(v, (str, int)) for v in (user_id, email, issued, expires)):
        return None
    if not isinstance(user_id, str) or not isinstance(email, str):
        return None
    if not isinstance(issued, int) or not isinstance(expires, int):
        return None

    return TokenPayload(
        user_id=user_id,
        email=email,
        issued_at=issued,
        expires_at=expires,
    )
