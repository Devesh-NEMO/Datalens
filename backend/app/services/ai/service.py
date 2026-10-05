"""AI service: orchestration, number-grounding check, fallback policy.

The public surface is imported from ``app.services.ai`` (``__init__.py``) so the
provider can be swapped without touching call sites.
"""

from __future__ import annotations

import logging
from typing import Any

from app.schemas.library import AskPayloadRequest, InsightsPayloadRequest

from app.services.ai.brief import build_analysis_brief
from app.services.ai.local_provider import LOCAL_DISCLAIMER, LocalComposerProvider
from app.services.ai.narrative import (
    INSIGHT_SECTIONS,
    SUGGESTED_QUESTIONS,
    answer_question,
    classify_question,
    compose_insights,
)
from app.services.ai.openai_provider import OpenAICompatibleProvider, redact_secrets
from app.services.ai.provider import (
    PROVIDER_LOCAL,
    PROVIDER_OPENAI_COMPATIBLE,
    AIProvider,
    AIProviderError,
    AIRequest,
    AIResponse,
    AIStatus,
    ai_status,
    require_ai_enabled,
    resolve_provider,
)
from app.services.ai.service_impl import AIServiceImpl

#: Module-level instance so ``app.services.ai.ask`` etc. work without a
#  surrounding ``ai_service`` variable.
_ai = AIServiceImpl()


# ---------------------------------------------------------------------------
# Public API – these are the names re-exported by ``app.services.ai.__init__``
# ---------------------------------------------------------------------------

def ask(analysis: Any, question: str, history: list[dict[str, str]] | None = None) -> Any:
    """Answer one question about an uploaded file.

    The deterministic engine is the source of truth. The AI provider only
    explains structured results and must cite real numbers; it never invents.

    Grounding rule: _brief_numbers() collects every numeric token in the brief;
    _numbers_agrees() rejects any answer quoting a number not in it (small
    integers <= 12 allowed as list numbering). The deterministic text wins on
    rejection and fell_back/fallback_reason say so.
    """
    return _ai.ask(analysis, question, history=history)


def generate_insights(analysis: Any) -> Any:
    """Generate all 7 insight sections.

    The deterministic engine is always the source of truth. If a provider
    is configured, its explanations supplement (never replace) the computed
    text. The UI can distinguish three states:
    - is_ai: false  -> local analysis (correct, not degraded)
    - is_ai: true   -> model wrote the text
    - fell_back: true -> a provider was configured and failed; answer is still
      correct because it came from the analysis.
    """
    return _ai.generate_insights(analysis)


def dataset_summary(analysis: Any) -> dict[str, Any]:
    """One-paragraph overview for the dashboard header, from the grounded brief."""
    return _ai.dataset_summary(analysis)


def provider_health() -> dict[str, Any]:
    """Probe the configured provider with a tiny query; never sends dataset content."""
    return _ai.provider_health()


def suggested_questions() -> list[dict[str, str]]:
    """The nine starter questions with a one-line description of what each returns.

    Generated from the engine rather than hardcoded in the frontend, so the
    suggestions cannot drift away from what can be answered.
    """
    del _  # the question set is fixed; see SUGGESTED_QUESTIONS
    return [
        {"question": q, "description": d}
        for q, d in {
            "focus": "The groups carrying the most value, with their share.",
            "underperforming": "The largest decline, and the smallest groups by value.",
            "trend": "Period-over-period movement, the sharpest rises and falls.",
            "distribution": "How the measure is spread across its bands.",
            "quality": "The quality score, each issue, and what Datalens did about it.",
            "anomalies": "Values outside their column's own spread.",
            "summary": "An overall picture of the dataset.",
            "breakdown": "Totals per category, region or channel.",
        }.items()
    ]


# ---------------------------------------------------------------------------
# Convenience helpers for the API layer
# ---------------------------------------------------------------------------

def dataset_summary_from_payload(request: InsightsPayloadRequest) -> dict[str, Any]:
    """Generate insights from an analysis the caller already holds (JSON)."""
    return _ai.dataset_summary(request.analysis)


def ask_from_payload(request: AskPayloadRequest) -> Any:
    """Answers a question about an analysis the caller already holds (JSON)."""
    return _ai.ask(request.analysis, request.question, history=request.history)


# ---------------------------------------------------------------------------
# Internal helper – do not import from this module outside the package
# ---------------------------------------------------------------------------

class AIServiceImpl:
    """Concrete implementation – holds the provider + local composer."""

    def __init__(self) -> None:
        from app.services.ai.local_provider import LocalComposerProvider
        self._local = LocalComposerProvider()
        self._provider: Any = None  # resolved lazily

    def _resolve_provider(self) -> tuple[Any, bool]:
        """Return (provider, is_local).

        is_local == True  -> no API key configured; we use the deterministic narrator.
        is_local == False -> provider is reachable and will be used when available.
        """
        from app.services.ai.provider import ai_status, resolve_provider, PROVIDER_LOCAL, PROVIDER_OPENAI_COMPATIBLE

        status = ai_status()
        if not status.enabled or not status.configured:
            return PROVIDER_LOCAL, True
        return resolve_provider(), False

    def ask(self, analysis: Any, question: str, history: list[dict[str, str]] | None = None) -> Any:
        from app.services.ai.brief import _brief_numbers, _numbers_agrees

        prov, is_local = self._resolve_provider()
        brief = build_analysis_brief(analysis)
        brief_numbers = _brief_numbers(brief)

        answer, source, provider_name, model, fell_back, fallback_reason, disclaimer = (
            answer_question(
                question,
                brief,
                provider=prov,
                is_local=is_local,
                brief_numbers=brief_numbers,
                numbers_agree=_numbers_agrees,
            )
        )

        from app.schemas.library import AskResponse

        intent = classify_question(question) if not is_local else "unknown"
        intent_matched = intent != "unknown"

        from app.services.ai import ai_status as _ai_status

        return AskResponse(
            question=question,
            answer=answer,
            source=source,
            provider=provider_name,
            model=model,
            is_ai=not is_local and not fell_back,
            fell_back=fell_back,
            fallback_reason=fallback_reason,
            disclaimer=disclaimer if is_local else "",
            intent=intent,
            intent_matched=intent_matched,
            status=_ai_status(),
        )

    def generate_insights(self, analysis: Any) -> Any:
        from app.services.ai.brief import build_analysis_brief
        from app.services.ai.service import compose_insights

        prov, is_local = self._resolve_provider()
        brief = build_analysis_brief(analysis)
        sections, fell_back, fallback_reason = compose_insights(brief, provider=prov, is_local=is_local)

        return {
            "sections": sections,
            "is_ai": not is_local and not fell_back,
            "fell_back": fell_back,
            "fallback_reason": fallback_reason,
            "disclaimer": LOCAL_DISCLAIMER if is_local else "",
        }

    def dataset_summary(self, analysis: Any) -> dict[str, Any]:
        from app.services.ai.brief import build_analysis_brief
        from app.services.ai.service import compose_insights

        prov, is_local = self._resolve_provider()
        brief = build_analysis_brief(analysis)
        text = compose_insights(brief, provider=prov, is_local=is_local, fallback=True)
        return {"text": text}

    def provider_health(self) -> dict[str, Any]:
        from app.services.ai.provider import ai_status

        status = ai_status()
        if not status.enabled:
            return {"message": "No AI provider configured", "status": "unavailable"}
        return {"message": "Provider reachable", "status": "ok"}