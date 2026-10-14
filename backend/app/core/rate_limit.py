"""In-process rate limiter for the AI-compute endpoints.

Deliberately small and per-instance, held in memory: it exists to stop one
client from hammering a metered provider from a single process, not to be a
production quota system. A reverse proxy is the stronger option when the app is
deployed behind one. When ``AI_RATE_LIMIT_PER_MINUTE`` is 0 the limiter is off.

Only the paths that actually invoke the model are counted. ``/ai/status`` and
``/ai/suggestions`` read cached state and never call a provider, so polling them
from the UI does not consume the budget.
"""

from __future__ import annotations

import time
from collections import deque
from typing import Awaitable, Callable, Deque, Tuple

from fastapi import Request
from starlette.responses import JSONResponse, Response

from app.config import settings
from app.core.errors import format_error_response


class RateLimiter:
    """A fixed one-minute sliding window, per process."""

    def __init__(self, limit_per_minute: int) -> None:
        self.limit = max(0, limit_per_minute)
        self._hits: Deque[float] = deque()

    @property
    def enabled(self) -> bool:
        return self.limit > 0

    def allow(self) -> Tuple[bool, int]:
        """Return ``(allowed, retry_after_seconds)`` and record the hit."""
        if not self.enabled:
            return True, 0

        now = time.time()
        cutoff = now - 60.0
        while self._hits and self._hits[0] < cutoff:
            self._hits.popleft()

        if len(self._hits) >= self.limit:
            retry_after = int(max(1, 60 - (now - self._hits[0])))
            return False, retry_after

        self._hits.append(now)
        return True, 0


ai_rate_limiter = RateLimiter(settings.ai_rate_limit_per_minute)


def is_ai_compute_path(path: str) -> bool:
    """True when this request will call a model or the AI service."""
    if path.startswith("/ai/") or path.startswith("/v1/ai/"):
        # Status and suggestions are cheap reads with no provider call.
        return path.rsplit("/", 1)[-1] not in {"status", "suggestions"}
    if "/conversations/" in path and path.endswith("/messages"):
        return True
    if path.startswith("/datasets/") and (path.endswith("/ask") or path.endswith("/insights")):
        return True
    return False


async def ai_rate_limit_middleware(
    request: Request, call_next: Callable[[Request], Awaitable[Response]]
) -> Response:
    """Return a structured 429 with ``Retry-After`` when the budget is spent."""
    if is_ai_compute_path(request.url.path):
        allowed, retry_after = ai_rate_limiter.allow()
        if not allowed:
            response: JSONResponse = format_error_response(
                code="rate_limited",
                message="Too many AI requests. Please slow down.",
                hint=f"Try again in about {retry_after} seconds.",
                status_code=429,
            )
            response.headers["Retry-After"] = str(retry_after)
            return response
    return await call_next(request)


__all__ = ["RateLimiter", "ai_rate_limiter", "ai_rate_limit_middleware", "is_ai_compute_path"]
