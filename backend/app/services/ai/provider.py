"""The AI provider contract and the factory that resolves it.

One protocol, any number of adapters. Nothing in the rest of the application
imports ``httpx`` or knows an API key exists; it asks
:func:`resolve_provider` for a provider and sends it text.

Two rules that the rest of the AI code depends on:

1. **The deterministic engine is the source of truth.** A provider only ever
   receives numbers that :mod:`app.services.ai.brief` already computed, and is
   asked to explain them. A provider is never asked to compute a total, rank
   products, or decide whether a number changed.
2. **A missing key is a configuration state, not an error.** It resolves to a
   local provider that composes sentences from the same figures, and reports
   ``is_ai=False`` so the UI can label the output honestly.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass
from typing import Any, Protocol, runtime_checkable

from app.config import settings
from app.core.errors import AppException

logger = logging.getLogger("data_analyzer.ai")

#: Identifies the local composer so the UI can label it correctly.
PROVIDER_LOCAL = "local"
PROVIDER_OPENAI_COMPATIBLE = "openai_compatible"

#: Task identifiers. Values are stable strings because they appear in tests.
TASK_FREEFORM = "freeform"
TASK_INSIGHT_SECTION = "insight_section"
TASK_ASK = "ask"
TASK_DATASET_SUMMARY = "dataset_summary"


class AIProviderError(AppException):
    """A provider call failed in a way the caller can explain to a user."""

    def __init__(
        self,
        message: str,
        *,
        code: str = "ai_provider_error",
        hint: str | None = None,
        status_code: int = 502,
    ) -> None:
        super().__init__(message=message, code=code, hint=hint, status_code=status_code)


@dataclass(frozen=True)
class AIRequest:
    """A single completion request.

    ``system``/``prompt`` are what a model provider sends. ``task``, ``facts``
    and ``question`` are the same request expressed as structure, which the
    local composer uses directly instead of re-parsing prose. Both paths
    therefore get identical facts, so the local answer and the model answer
    cannot drift apart.
    """

    system: str
    prompt: str
    max_tokens: int | None = None
    temperature: float | None = None
    #: One of ``TASK_INSIGHT_SECTION``, ``TASK_ASK``, ``TASK_DATASET_SUMMARY``.
    task: str = TASK_FREEFORM
    #: The fact sheet from :mod:`app.services.ai.brief`.
    facts: dict[str, Any] | None = None
    #: The user's question, for ``TASK_ASK``.
    question: str | None = None
    #: Which insight section is being written, for ``TASK_INSIGHT_SECTION``.
    section: str | None = None


@dataclass
class AIResponse:
    """A provider's answer plus enough metadata for the UI to label it."""

    text: str
    #: "openai_compatible" or "local".
    provider: str
    model: str
    #: False when the answer came from the local composer rather than a model.
    is_ai: bool
    #: True when a model was called and failed, so the local composer answered.
    fell_back: bool = False
    #: Short, non-sensitive explanation when ``fell_back`` is True.
    fallback_reason: str | None = None
    finish_reason: str | None = None
    #: Rough token usage, when the provider reports it. Never used for billing.
    prompt_tokens: int | None = None
    completion_tokens: int | None = None

    def to_dict(self) -> dict[str, Any]:
        return {
            "text": self.text,
            "provider": self.provider,
            "model": self.model,
            "is_ai": self.is_ai,
            "fell_back": self.fell_back,
            "fallback_reason": self.fallback_reason,
            "finish_reason": self.finish_reason,
            "prompt_tokens": self.prompt_tokens,
            "completion_tokens": self.completion_tokens,
        }


@runtime_checkable
class AIProvider(Protocol):
    """The only surface the application needs from an AI backend."""

    name: str
    model: str
    #: True when this provider will make a real network call.
    is_ai: bool

    def available(self) -> bool:
        """True when this provider can answer right now."""
        ...

    async def complete(self, request: AIRequest) -> AIResponse:
        """Produce an answer, or raise :class:`AIProviderError`."""
        ...


@dataclass
class AIStatus:
    """What the UI needs to explain the AI state without guessing."""

    enabled: bool
    configured: bool
    provider: str
    model: str
    base_url: str
    #: Never the key itself — only whether one is present.
    has_api_key: bool
    local_fallback_enabled: bool
    message: str

    def to_dict(self) -> dict[str, Any]:
        return {
            "enabled": self.enabled,
            "configured": self.configured,
            "provider": self.provider,
            "model": self.model,
            "base_url": self.base_url,
            "has_api_key": self.has_api_key,
            "local_fallback_enabled": self.local_fallback_enabled,
            "message": self.message,
        }


def _local_status_message() -> str:
    return (
        "No AI_API_KEY is set, so Datalens answers from the deterministic analysis "
        "itself. Every figure it quotes is computed from your file. Set AI_API_KEY to "
        "have these explanations written by a language model instead."
    )


def _disabled_status_message() -> str:
    return (
        "AI features are switched off (AI_ENABLED=false). Analysis, charts and reports "
        "all work without them."
    )


def ai_status() -> AIStatus:
    """Describe the AI configuration without leaking any secret."""
    if not settings.ai_enabled:
        return AIStatus(
            enabled=False,
            configured=False,
            provider=PROVIDER_LOCAL,
            model="local",
            base_url="",
            has_api_key=False,
            local_fallback_enabled=settings.ai_allow_local_fallback,
            message=_disabled_status_message(),
        )

    configured = settings.ai_is_configured
    return AIStatus(
        enabled=True,
        configured=configured,
        provider=PROVIDER_OPENAI_COMPATIBLE if configured else PROVIDER_LOCAL,
        model=settings.ai_model if configured else "local",
        # The base URL is safe to show and is the first thing to check when a
        # custom endpoint does not answer.
        base_url=settings.ai_base_url if configured else "",
        has_api_key=bool(settings.ai_api_key),
        local_fallback_enabled=settings.ai_allow_local_fallback,
        message="" if configured else _local_status_message(),
    )


def resolve_provider(*, force_local: bool = False) -> AIProvider:
    """Return the provider to use right now.

    A configured key yields the OpenAI-compatible adapter. Anything else yields
    the local composer, so a missing key degrades the *writing* but never the
    numbers.
    """
    # Imported here to keep module import order simple and avoid a cycle.
    from app.services.ai.local_provider import LocalComposerProvider
    from app.services.ai.openai_provider import OpenAICompatibleProvider

    if not settings.ai_enabled:
        return LocalComposerProvider()
    if settings.ai_is_configured and not force_local:
        return OpenAICompatibleProvider(
            api_key=settings.ai_api_key or "",
            base_url=settings.ai_base_url,
            model=settings.ai_model,
            timeout=settings.ai_timeout_seconds,
            max_tokens=settings.ai_max_tokens,
            temperature=settings.ai_temperature,
        )
    return LocalComposerProvider()


def require_ai_enabled() -> None:
    """Raise when AI is switched off entirely and cannot even fall back."""
    if not settings.ai_enabled:
        raise AIProviderError(
            "AI features are switched off on this server.",
            code="ai_disabled",
            hint=_disabled_status_message(),
            status_code=503,
        )


__all__ = [
    "AIProvider",
    "AIProviderError",
    "AIRequest",
    "AIResponse",
    "AIStatus",
    "PROVIDER_LOCAL",
    "PROVIDER_OPENAI_COMPATIBLE",
    "TASK_ASK",
    "TASK_DATASET_SUMMARY",
    "TASK_FREEFORM",
    "TASK_INSIGHT_SECTION",
    "ai_status",
    "require_ai_enabled",
    "resolve_provider",
]
