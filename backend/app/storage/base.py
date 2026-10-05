"""File storage abstraction.

Upload bytes live outside the relational store. The local provider writes under a
configured root directory and is **never** mounted as static files: bytes come
back only through an endpoint that checks the caller, so an uploaded CSV is not
guessable from a URL.
"""

from __future__ import annotations

import json
import logging
import re
import secrets
from dataclasses import dataclass
from pathlib import Path
from typing import Protocol, runtime_checkable

from app.config import settings
from app.core.errors import AppException, PayloadTooLargeError

logger = logging.getLogger("data_analyzer.storage")

#: Anything outside this set is stripped from a user-supplied stem. The result is
#: only ever used for display; the on-disk key is random (see ``new_key``).
_UNSAFE_FILENAME_CHARS = re.compile(r"[^A-Za-z0-9._-]+")
_MAX_STEM_LENGTH = 80


class StorageError(AppException):
    """Raised when bytes cannot be written to or read from the store."""

    def __init__(self, message: str, hint: str = "Please try the upload again.") -> None:
        super().__init__(message=message, code="storage_error", hint=hint)


class StorageNotFoundError(AppException):
    """Raised when a storage key does not resolve to a stored object."""

    def __init__(self, message: str = "Stored file could not be found.") -> None:
        super().__init__(
            message=message,
            code="storage_not_found",
            hint="The dataset may have been deleted. Upload the file again.",
            status_code=404,
        )


@dataclass(frozen=True)
class StoredObject:
    """Metadata about one object in the store."""

    key: str
    size_bytes: int
    content_type: str
    original_filename: str


@runtime_checkable
class StorageProvider(Protocol):
    """Where uploaded bytes go. One method each way, plus deletion."""

    name: str

    def save(self, file_bytes: bytes, *, filename: str, content_type: str) -> StoredObject:
        """Persist ``file_bytes`` and return its handle."""
        ...

    def read(self, key: str) -> tuple[bytes, StoredObject]:
        """Return the bytes and metadata for ``key``."""
        ...

    def delete(self, key: str) -> bool:
        """Remove ``key``. Returns True when something was actually removed."""
        ...


def sanitize_filename(filename: str) -> str:
    """Reduce a user-supplied filename to something safe to store and display."""
    stem = Path(filename or "upload").name
    cleaned = _UNSAFE_FILENAME_CHARS.sub("_", stem).strip("._-")
    if not cleaned:
        cleaned = "upload"
    if len(cleaned) > _MAX_STEM_LENGTH:
        stem_part, dot, suffix = cleaned.rpartition(".")
        if dot and len(suffix) <= 8:
            cleaned = f"{stem_part[: _MAX_STEM_LENGTH]}.{suffix}"
        else:
            cleaned = cleaned[:_MAX_STEM_LENGTH]
    return cleaned


def new_key(original_filename: str) -> str:
    """Build an unguessable storage key.

    The random component is what makes the object unreachable by guessing. The
    stem is deliberately **not** included: a filename is attacker-controlled, so
    carrying any of it into the key leaks it back through whatever surfaces the
    key and only helps someone guessing. Operators can still recognise files on
    disk by the sidecar's ``original_filename``.
    """
    suffix = ""
    sanitized = sanitize_filename(original_filename)
    if "." in sanitized:
        stem, _, ext = sanitized.rpartition(".")
        suffix = f".{ext.lower()[:8]}" if stem else ""

    return f"{secrets.token_hex(16)}{suffix}"


class LocalStorageProvider:
    """Files on the local filesystem, outside any static mount.

    Writes are atomic (temp file then rename) so a crashed request cannot leave a
    half-written object that later reads as corrupt.
    """

    name = "local"

    def __init__(self, root: Path | None = None) -> None:
        self._root = Path(root) if root is not None else Path(settings.storage_root)

    @property
    def root(self) -> Path:
        return self._root

    def _resolve(self, key: str) -> Path:
        """Map a key to a path, refusing anything that escapes the root."""
        candidate = (self._root / key).resolve()
        root = self._root.resolve()
        if not candidate.is_relative_to(root):
            raise StorageNotFoundError("Stored file could not be found.")
        return candidate

    def _sidecar(self, key: str) -> Path:
        """Where the metadata for ``key`` lives.

        A sibling file rather than a database column, because the storage
        provider must be able to answer a read on its own: an S3 adapter has no
        table to consult, and the caller should not have to know whether one
        exists.
        """
        return self._root / f"{key}.meta.json"

    def save(self, file_bytes: bytes, *, filename: str, content_type: str) -> StoredObject:
        if len(file_bytes) > settings.max_upload_bytes:
            raise PayloadTooLargeError()
        stored = StoredObject(
            key=new_key(filename),
            size_bytes=len(file_bytes),
            # An empty content_type is normalised here rather than passed
            # through, so every stored object has a usable one.
            content_type=content_type or "application/octet-stream",
            original_filename=sanitize_filename(filename),
        )
        try:
            self._root.mkdir(parents=True, exist_ok=True)
            target = self._resolve(stored.key)
            temp = target.with_suffix(target.suffix + ".part")
            temp.write_bytes(file_bytes)
            temp.replace(target)
            # Written after the object itself, so a sidecar can never claim a
            # file exists when it does not.
            self._sidecar(stored.key).write_text(
                json.dumps(
                    {
                        "content_type": stored.content_type,
                        "original_filename": stored.original_filename,
                    }
                ),
                encoding="utf-8",
            )
        except OSError as exc:
            logger.exception("Failed to store upload")
            raise StorageError(
                "Could not save the uploaded file to local storage.",
                hint="Check that the storage directory is writable.",
            ) from exc

        return stored

    def read(self, key: str) -> tuple[bytes, StoredObject]:
        path = self._resolve(key)
        if not path.is_file():
            raise StorageNotFoundError()
        try:
            data = path.read_bytes()
        except OSError as exc:
            raise StorageError("Could not read the stored file.") from exc

        content_type = "application/octet-stream"
        original_filename = path.name
        sidecar = self._sidecar(key)
        if sidecar.is_file():
            # A missing or corrupt sidecar costs the metadata, not the file —
            # the bytes are the data, the sidecar is a convenience.
            try:
                meta = json.loads(sidecar.read_text(encoding="utf-8"))
                content_type = str(meta.get("content_type") or content_type)
                original_filename = str(meta.get("original_filename") or original_filename)
            except (OSError, ValueError):
                logger.warning("Unreadable metadata sidecar for %s", key)

        return data, StoredObject(
            key=key,
            size_bytes=len(data),
            content_type=content_type,
            original_filename=original_filename,
        )

    def delete(self, key: str) -> bool:
        try:
            path = self._resolve(key)
        except StorageNotFoundError:
            return False
        if not path.is_file():
            return False
        try:
            path.unlink()
        except OSError:
            logger.warning("Could not delete stored object %s", key)
            return False
        self._sidecar(key).unlink(missing_ok=True)
        return True


def get_storage_provider() -> StorageProvider:
    """Return the configured provider.

    Only ``local`` is implemented. ``s3`` is recognised so a misconfigured
    deployment fails loudly at startup rather than silently writing to disk
    somewhere unexpected.
    """
    backend = (settings.storage_backend or "local").strip().lower()
    if backend == "local":
        return LocalStorageProvider()
    if backend == "s3":
        raise StorageError(
            "Storage backend 's3' is not implemented in this build.",
            hint=(
                "Set STORAGE_BACKEND=local, or implement an S3-compatible "
                "StorageProvider in app/storage."
            ),
        )
    raise StorageError(
        f"Unknown STORAGE_BACKEND '{backend}'.",
        hint="Supported backends: local.",
    )
