"""Auth endpoint coverage: session, register, login, logout, me.

These tests cover the contract the frontend depends on:

* **Generic 401.** Login must return the identical sentence for an unknown email
  and a wrong password, and the endpoint renders the same message the UI shows.
* **Inactive accounts are a 403, not a 401** — they are a *state*, not an
  identity failure, and the UI says so explicitly.
* **503s are honest.** No database or no `AUTH_SECRET` refuse loudly instead of
  pretending auth exists.
* **`AUTH_ENABLED` gates writes, not reads.** The session endpoint stays
  readable with no token so a sign-in page can exist; dataset saves do not.

The database is a private SQLite file per test (`tmp_database`), and every
settings mutation runs inside `settings_override` so nothing leaks between
tests. All tokens are minted by the real `create_session_token` path — signing
with the same secret the endpoints verify with.
"""

from __future__ import annotations

from collections.abc import Iterator
from contextlib import contextmanager

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select

from app.core.security import create_session_token
from app.db.models import User
from app.db.session import session_scope
from app.main import app
from tests.conftest import fresh_database, settings_override

SECRET = "test-signing-secret-that-is-long-enough"

PASSWORD = "correct horse battery staple"
EMAIL = "analyst@example.com"


@pytest.fixture
def client() -> TestClient:
    return TestClient(app)


def _register(client: TestClient, *, email: str = EMAIL, password: str = PASSWORD) -> dict:
    response = client.post(
        "/v1/auth/register",
        json={"email": email, "password": password, "display_name": "Analyst"},
    )
    assert response.status_code == 201, response.text
    return response.json()


@contextmanager
def _sqlite(tmp_path: object) -> Iterator[None]:
    """A private SQLite database plus a signing secret for one test.

    Mirrors conftest's ``tmp_database`` (fresh SQLite file + reset module cache)
    and adds ``AUTH_SECRET``, because register/login refuse loudly without one —
    which is the point of the dedicated ``auth_not_configured`` tests below.
    """
    from app.db.session import reset_state

    url = f"sqlite:///{tmp_path / 'test.db'}"
    with fresh_database(url), settings_override(auth_secret=SECRET):
        yield
    reset_state()


# --- session ------------------------------------------------------------------


def test_session_is_anonymous_when_auth_off(client, tmp_path) -> None:
    with _sqlite(tmp_path):
        response = client.get("/v1/auth/session")
        assert response.status_code == 200
        body = response.json()
        assert body["authenticated"] is False
        assert body["auth_required"] is False
        assert body["user"] is None
        assert "browser session only" in body["message"]


def test_session_reports_authenticated_user(client, tmp_path) -> None:
    with _sqlite(tmp_path):
        signed = _register(client)
        response = client.get(
            "/v1/auth/session", headers={"Authorization": f"Bearer {signed['token']}"}
        )
        assert response.status_code == 200
        body = response.json()
        assert body["authenticated"] is True
        assert body["user"]["email"] == EMAIL
        assert body["user"]["display_name"] == "Analyst"
        assert body["auth_required"] is False


def test_session_flags_auth_required_when_enabled(client, tmp_path) -> None:
    with _sqlite(tmp_path), settings_override(auth_enabled=True, auth_secret=SECRET):
        response = client.get("/v1/auth/session")
        assert response.status_code == 200
        assert response.json()["auth_required"] is True


def test_session_treats_deactivated_account_as_anonymous(client, tmp_path) -> None:
    with _sqlite(tmp_path):
        signed = _register(client)
        with session_scope() as db:
            user = db.scalar(select(User).where(User.email == EMAIL))
            assert user is not None
            user.is_active = False
        response = client.get(
            "/v1/auth/session", headers={"Authorization": f"Bearer {signed['token']}"}
        )
        assert response.status_code == 200
        body = response.json()
        assert body["authenticated"] is False
        assert "no longer active" in body["message"]


# --- register -----------------------------------------------------------------


def test_register_creates_account_and_returns_token(client, tmp_path) -> None:
    with _sqlite(tmp_path):
        body = _register(client)
        assert body["token"]
        assert body["expires_at"]
        assert body["user"]["email"] == EMAIL
        assert body["user"]["display_name"] == "Analyst"


def test_register_duplicate_email_is_409(client, tmp_path) -> None:
    with _sqlite(tmp_path):
        _register(client)
        response = client.post(
            "/v1/auth/register", json={"email": EMAIL, "password": PASSWORD}
        )
        assert response.status_code == 409
        error = response.json()["error"]
        assert error["code"] == "email_taken"
        assert error["message"] == "An account with that email already exists."


def test_register_weak_password_is_422(client, tmp_path) -> None:
    """A padded password passes the schema but fails the strength rule."""

    with _sqlite(tmp_path):
        response = client.post(
            "/v1/auth/register",
            json={"email": EMAIL, "password": "  eight  "},
        )
        assert response.status_code == 422
        assert response.json()["error"]["code"] == "weak_password"


def test_register_short_password_is_422_validation(client, tmp_path) -> None:
    """Below the schema minimum the request is a validation error, not a 201."""

    with _sqlite(tmp_path):
        response = client.post(
            "/v1/auth/register", json={"email": EMAIL, "password": "short"}
        )
        assert response.status_code == 422


def test_register_without_database_is_503(client, no_database: None) -> None:
    response = client.post(
        "/v1/auth/register", json={"email": EMAIL, "password": PASSWORD}
    )
    assert response.status_code == 503
    error = response.json()["error"]
    assert error["code"] == "persistence_unavailable"
    assert error["hint"]


def test_register_without_secret_is_503(client, tmp_path) -> None:
    with _sqlite(tmp_path), settings_override(auth_secret=None):
        response = client.post(
            "/v1/auth/register", json={"email": EMAIL, "password": PASSWORD}
        )
        assert response.status_code == 503
        error = response.json()["error"]
        assert error["code"] == "auth_not_configured"
        assert "AUTH_SECRET" in error["hint"]


# --- login --------------------------------------------------------------------


def test_login_works_after_register(client, tmp_path) -> None:
    with _sqlite(tmp_path):
        _register(client)
        response = client.post(
            "/v1/auth/login", json={"email": EMAIL, "password": PASSWORD}
        )
        assert response.status_code == 200
        body = response.json()
        assert body["token"]
        assert body["user"]["email"] == EMAIL


def test_login_generic_message_for_unknown_email_and_wrong_password(
    client, tmp_path
) -> None:
    """The two failures are indistinguishable, message and code."""

    with _sqlite(tmp_path):
        _register(client)

        unknown = client.post(
            "/v1/auth/login",
            json={"email": "nobody@example.com", "password": PASSWORD},
        )
        wrong = client.post(
            "/v1/auth/login",
            json={"email": EMAIL, "password": "wrong password here"},
        )
        assert unknown.status_code == 401
        assert wrong.status_code == 401
        assert unknown.json()["error"]["message"] == wrong.json()["error"]["message"]
        assert unknown.json()["error"]["code"] == wrong.json()["error"]["code"]
        assert unknown.json()["error"]["message"] == "That email and password do not match."


def test_login_inactive_account_is_403(client, tmp_path) -> None:
    with _sqlite(tmp_path):
        _register(client)
        with session_scope() as db:
            user = db.scalar(select(User).where(User.email == EMAIL))
            assert user is not None
            user.is_active = False
        response = client.post(
            "/v1/auth/login", json={"email": EMAIL, "password": PASSWORD}
        )
        assert response.status_code == 403
        error = response.json()["error"]
        assert error["code"] == "account_inactive"
        assert error["message"] == "This account is not active."


def test_login_does_not_reveal_email_case(client, tmp_path) -> None:
    """Emails are normalised to lowercase at registration and on sign-in."""

    with _sqlite(tmp_path):
        _register(client)
        mixed = client.post(
            "/v1/auth/login", json={"email": "Analyst@Example.COM", "password": PASSWORD}
        )
        assert mixed.status_code == 200
        assert mixed.json()["user"]["email"] == EMAIL


# --- logout and me ------------------------------------------------------------


def test_logout_is_stateless(client) -> None:
    response = client.post("/v1/auth/logout")
    assert response.status_code == 200
    assert response.json() == {"logged_out": True}


def test_me_requires_a_token(client, tmp_path) -> None:
    with _sqlite(tmp_path):
        response = client.get("/v1/auth/me")
        assert response.status_code == 401
        assert response.json()["error"]["code"] == "auth_required"


def test_me_returns_the_signed_in_user(client, tmp_path) -> None:
    with _sqlite(tmp_path):
        signed = _register(client)
        response = client.get(
            "/v1/auth/me", headers={"Authorization": f"Bearer {signed['token']}"}
        )
        assert response.status_code == 200
        assert response.json()["email"] == EMAIL


def test_me_rejects_fake_token_as_401(client, tmp_path) -> None:
    with _sqlite(tmp_path):
        response = client.get(
            "/v1/auth/me", headers={"Authorization": "Bearer not-a-real-token"}
        )
        assert response.status_code == 401


# --- auth enforcement ----------------------------------------------------------


def test_auth_enabled_blocks_writes_without_token(client, clean_csv, tmp_path) -> None:
    with _sqlite(tmp_path), settings_override(auth_enabled=True, auth_secret=SECRET):
        response = client.post(
            "/v1/datasets",
            files={"file": ("sales_clean.csv", clean_csv, "text/csv")},
            data={"name": "Blocked upload"},
        )
        assert response.status_code == 401
        assert response.json()["error"]["code"] == "auth_required"


def test_auth_enabled_allows_write_with_valid_token(client, clean_csv, tmp_path) -> None:
    with _sqlite(tmp_path), settings_override(auth_enabled=True, auth_secret=SECRET):
        signed = _register(client)
        response = client.post(
            "/v1/datasets",
            files={"file": ("sales_clean.csv", clean_csv, "text/csv")},
            data={"name": "Allowed upload"},
            headers={"Authorization": f"Bearer {signed['token']}"},
        )
        assert response.status_code == 201, response.text


def test_auth_off_does_not_need_token_for_writes(client, clean_csv, tmp_path) -> None:
    with _sqlite(tmp_path):
        response = client.post(
            "/v1/datasets",
            files={"file": ("sales_clean.csv", clean_csv, "text/csv")},
            data={"name": "Anonymous upload"},
        )
        assert response.status_code == 201, response.text


def test_malformed_token_is_rejected_when_auth_required(client, tmp_path) -> None:
    """A token that fails signature verification reads as invalid — 401, and the
    client's stale-session copy is 'auth_invalid_token', not a fallthrough."""

    with _sqlite(tmp_path), settings_override(auth_enabled=True):
        token = create_session_token("u_anyone", "anyone@example.com")
        body, _, signature = token.partition(".")
        # Flip two characters in the signature: still base64url-shaped, but the
        # HMAC no longer verifies, so decode_session_token must refuse it.
        tampered = f"{body}.{signature[:-3]}zzz"
        response = client.post(
            "/v1/datasets",
            files={"file": ("ghost.csv", b"a,b\n1,2\n", "text/csv")},
            data={"name": "Ghost upload"},
            headers={"Authorization": f"Bearer {tampered}"},
        )
        assert response.status_code == 401
        assert response.json()["error"]["code"] == "auth_invalid_token"