"""AI service: orchestration, number-grounding check, fallback policy.

The public surface is imported from ``app.services.ai`` (``__init__.py``) so the
provider can be swapped without touching call sites.

Every public function here enforces the same rule: **the deterministic engine is
the source of truth.** A provider only ever explains figures the brief already
computed, and the grounding check discards any text quoting a number that is not
in the brief. When no provider is configured, or a configured one fails, the
same figures are composed locally instead — the answer changes source, never
correctness.
"""

from __future__ import annotations

import logging
import time
from typing import Any

from app.schemas.library import (
    AskResponse,
    GroundingResponse,
    InsightSectionResponse,
    InsightsResponse,
)
from app.services.ai.brief import (
    _brief_numbers,
    _numbers_agrees,
    brief_to_json,
    build_analysis_brief,
)
from app.services.ai.local_provider import LOCAL_DISCLAIMER
from app.services.ai.narrative import (
    INSIGHT_SECTIONS,
    SECTION_FOCUS,
    SECTION_TITLES,
    SUGGESTED_QUESTIONS,
    answer_question,
    answer_suggested_questions,
    classify_question,
    compose_insights,
)
from app.services.ai.provider import (
    PROVIDER_LOCAL,
    TASK_ASK,
    TASK_DATASET_SUMMARY,
    TASK_INSIGHT_SECTION,
    AIProvider,
    AIProviderError,
    AIRequest,
    AIResponse,
    ai_status,
    resolve_provider,
)
from app.services.findings import build_findings

logger = logging.getLogger("data_analyzer.ai.service")

#: A model call costs money and latency, and composing the same text locally is
#: free and always correct. These three sections are where a model's prose adds
#: the most; the rest stay with the deterministic composer.
_AI_WRITTEN_SECTIONS = {"executive_summary", "key_findings", "recommendations"}

_ASK_SYSTEM_PROMPT = (
    "You are Datalens, a precise data analyst. Answer ONLY from the FACT SHEET in "
    "the user message. Every number you quote must appear in the fact sheet exactly "
    "as written — never estimate, round up, or reuse a figure with a different "
    "meaning. If the sheet cannot answer the question, say what is missing rather "
    "than guessing. Be concise and professional."
)

_GROUNDING_RULE_TEXT = (
    "Every number in the text above was checked against the computed analysis and "
    "rejected if it did not appear there."
)

_GROUNDING_REJECTION = (
    "The provider's wording was discarded after the grounding check; the checked "
    "local analysis is shown instead."
)


def _prompt_with_history(
    brief_json: str, question: str, history: list[dict[str, str]] | None
) -> str:
    """The facts + conversation for a question. History is bounded and truncated."""
    parts = [f"FACT SHEET (the only source of truth):\n{brief_json}\n"]
    recent = (history or [])[-6:]
    if recent:
        lines = []
        for exchange in recent:
            role = "User" if str(exchange.get("role", "")).lower() == "user" else "Assistant"
            content = str(exchange.get("content", ""))[:400]
            lines.append(f"{role}: {content}")
        parts.append("Previous exchange (for context only):\n" + "\n".join(lines))
    parts.append(f"Question: {question}")
    return "\n\n".join(parts)


def _trim_at_sentence(text: str, limit: int = 1600) -> str:
    """Cut a model answer at the last sentence boundary that fits in ``limit``."""
    if len(text) <= limit:
        return text
    head = text[:limit]
    for marker in ("\n\n", ". ", "! ", "? "):
        idx = head.rfind(marker)
        if idx > limit // 2:
            return head[: idx + 1].rstrip() + "…"
    return head.rstrip() + "…"


def _fallback_message(exc: AIProviderError) -> str:
    """A short, non-sensitive reason the provider's wording was not used."""
    code = exc.code
    if code == "ai_timeout":
        return "The AI provider timed out; the local analysis was used instead."
    if code == "ai_rate_limited":
        return "The AI provider was rate limited; the local analysis was used instead."
    if code == "ai_upstream_error":
        return "The AI provider returned a server error; the local analysis was used instead."
    if code == "ai_unauthorized":
        return "The AI provider rejected the API key; the local analysis was used instead."
    return "The AI provider failed; the local analysis was used instead."


def _pick_provider() -> tuple[AIProvider, bool]:
    """Return ``(provider, is_local)`` using whatever is configured right now."""
    provider = resolve_provider()
    return provider, provider.name == PROVIDER_LOCAL


# ---------------------------------------------------------------------------
# Public API – re-exported by ``app.services.ai.__init__``
# ---------------------------------------------------------------------------


def suggested_questions() -> list[dict[str, str]]:
    """The starter questions with what each one returns, from the engine."""
    return answer_suggested_questions({})


async def ask(
    analysis: Any,
    question: str,
    history: list[dict[str, str]] | None = None,
) -> AskResponse:
    """Answer one question about an analysis.

    The deterministic answer is always computed first. When a model provider is
    configured, its answer is used only if it survives the grounding check
    (every quoted number appears in the brief); otherwise the local text is
    returned with ``fell_back=True`` so the UI can explain why.
    """
    status = ai_status()
    brief = build_analysis_brief(analysis)
    brief_figures = _brief_numbers(brief)

    intent, confidence = classify_question(question)
    intent_matched = confidence > 0.0
    local_answer, _local_intent = answer_question(brief, question)

    provider, is_local = _pick_provider()
    answer = local_answer
    source = "local"
    provider_name = PROVIDER_LOCAL
    model = "local-analysis"
    fell_back = False
    fallback_reason: str | None = None
    used_local_text = True

    if provider.is_ai:
        request = AIRequest(
            system=_ASK_SYSTEM_PROMPT,
            prompt=_prompt_with_history(brief_to_json(brief), question, history),
            max_tokens=700,
            temperature=0.2,
            task=TASK_ASK,
            facts=brief,
            question=question,
        )
        response, rejection_reason = await _complete_grounded(provider, request, brief_figures)
        if response is not None:
            answer = response.text
            source = "ai"
            provider_name = response.provider
            model = response.model
            used_local_text = False
        else:
            fell_back = True
            fallback_reason = rejection_reason

    return AskResponse(
        question=question,
        answer=answer,
        source=source,
        provider=provider_name,
        model=model,
        is_ai=not used_local_text,
        fell_back=fell_back,
        fallback_reason=fallback_reason,
        disclaimer=LOCAL_DISCLAIMER if used_local_text else "",
        intent=intent,
        intent_matched=intent_matched,
        status=status.to_dict(),
        suggestions=list(SUGGESTED_QUESTIONS),
    )


async def generate_insights(analysis: Any) -> InsightsResponse:
    """All insight sections plus structured findings for an analysis.

    The deterministic composer writes every section first. The model writes the
    headline sections (executive summary, key findings, recommendations) when
    configured and passes the grounding check; every other section stays with
    the computed text, and per-section provenance says which is which.
    """
    brief = build_analysis_brief(analysis)
    brief_figures = _brief_numbers(brief)
    local_sections = compose_insights(brief)
    provider, is_local = _pick_provider()

    sections: list[InsightSectionResponse] = []
    any_fell_back = False
    fallback_reasons: list[str] = []

    for key, title in INSIGHT_SECTIONS:
        local = local_sections.get(key)
        if local is None or not local.available:
            sections.append(
                InsightSectionResponse(
                    key=key,
                    title=title,
                    body="",
                    available=False,
                    source="none",
                )
            )
            continue

        body = local.body
        bullets = list(local.bullets or [])
        source = "local"
        fell_back = False
        fallback_reason: str | None = None

        if provider.is_ai and key in _AI_WRITTEN_SECTIONS:
            focus = SECTION_FOCUS.get(key, SECTION_TITLES.get(key, "Explain the facts."))
            request = AIRequest(
                system=(
                    "You are Datalens, a precise data analyst. Write the requested "
                    "section from the FACT SHEET only.\nSection brief: " + focus
                ),
                prompt=(
                    f"FACT SHEET (the only source of truth):\n{brief_to_json(brief)}\n\n"
                    f"Write the '{title}' section now, using only figures from the fact sheet."
                ),
                max_tokens=600,
                temperature=0.2,
                task=TASK_INSIGHT_SECTION,
                facts=brief,
                section=key,
            )
            response, rejection_reason = await _complete_grounded(provider, request, brief_figures)
            if response is not None:
                body = response.text
                bullets = []
                source = "ai"
            else:
                fell_back = True
                fallback_reason = rejection_reason
                any_fell_back = True
                fallback_reasons.append(f"{title}: {fallback_reason}")

        sections.append(
            InsightSectionResponse(
                key=key,
                title=title,
                body=body,
                available=True,
                source=source,
                bullets=bullets,
                fell_back=fell_back,
                fallback_reason=fallback_reason,
            )
        )

    findings = build_findings(analysis)

    return InsightsResponse(
        provider=provider.name,
        model=provider.model,
        is_ai=any(section.source == "ai" for section in sections),
        fell_back=any_fell_back,
        fallback_reason="; ".join(fallback_reasons) if fallback_reasons else None,
        disclaimer=LOCAL_DISCLAIMER if is_local or any_fell_back else "",
        status=ai_status().to_dict(),
        sections=sections,
        grounding=GroundingResponse(figure_count=len(brief_figures), rule=_GROUNDING_RULE_TEXT),
        findings=findings,
    )


async def dataset_summary(analysis: Any) -> dict[str, Any]:
    """One-paragraph overview of an analysis, grounded like everything else."""
    brief = build_analysis_brief(analysis)
    brief_figures = _brief_numbers(brief)
    provider, is_local = _pick_provider()

    composed = compose_insights(brief)
    executive = composed.get("executive_summary")
    local_text = executive.body if executive is not None and executive.available else ""
    rejection_reason: str | None = None

    if provider.is_ai:
        request = AIRequest(
            system=(
                "You are Datalens, a precise data analyst. Write a one-paragraph "
                "executive summary from the FACT SHEET only, 3-5 sentences, no bullets."
            ),
            prompt=(
                f"FACT SHEET (the only source of truth):\n{brief_to_json(brief)}\n\n"
                "Write the executive summary."
            ),
            max_tokens=300,
            temperature=0.2,
            task=TASK_DATASET_SUMMARY,
            facts=brief,
        )
        response, rejection_reason = await _complete_grounded(provider, request, brief_figures)
        if response is not None:
            return {
                "text": response.text,
                "source": "ai",
                "provider": response.provider,
                "model": response.model,
                "is_ai": True,
                "fell_back": False,
                "fallback_reason": None,
                "disclaimer": "",
                "figure_count": len(brief_figures),
            }

    return {
        "text": local_text,
        "source": "local",
        "provider": PROVIDER_LOCAL,
        "model": "local-analysis",
        "is_ai": False,
        "fell_back": not is_local,
        "fallback_reason": (
            None if is_local else rejection_reason
        ),
        "disclaimer": LOCAL_DISCLAIMER,
        "figure_count": len(brief_figures),
    }


async def provider_health() -> dict[str, Any]:
    """Probe the configured provider with a tiny query; never sends dataset content.

    Returns a status the settings page can render without guessing: ``disabled``,
    ``not_configured``, ``ok`` or ``error`` with a safe reason and latency.
    """
    status = ai_status()
    base = {
        "enabled": status.enabled,
        "configured": status.configured,
        "provider": status.provider,
        "model": status.model,
        "base_url": status.base_url,
        "has_api_key": status.has_api_key,
    }
    if not status.enabled:
        return {**base, "status": "disabled", "message": status.message, "latency_ms": None}
    if not status.configured:
        return {**base, "status": "not_configured", "message": status.message, "latency_ms": None}

    provider = resolve_provider()
    started = time.perf_counter()
    try:
        response = await provider.complete(
            AIRequest(
                system="Reply with exactly one word: ok.",
                prompt="Say ok.",
                max_tokens=4,
                temperature=0.0,
            )
        )
        latency_ms = int((time.perf_counter() - started) * 1000)
        return {
            **base,
            "status": "ok",
            "message": f"Connected. Model reports: {response.model or provider.model}.",
            "latency_ms": latency_ms,
        }
    except AIProviderError as exc:
        latency_ms = int((time.perf_counter() - started) * 1000)
        hint = getattr(exc, "hint", None)
        return {
            **base,
            "status": "error",
            "message": exc.message,
            "hint": hint,
            "code": exc.code,
            "latency_ms": latency_ms,
        }


# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------


async def _complete_grounded(
    provider: AIProvider,
    request: AIRequest,
    brief_figures: list[float],
) -> tuple[AIResponse | None, str | None]:
    """Call the provider and return the response only if it survives grounding.

    Returns ``(response, None)`` on success, or ``(None, reason)`` — the caller
    decides how to present ``reason`` when the local text is used instead.
    A truncated-but-grounded answer is kept, trimmed at a sentence boundary.
    """
    try:
        response = await provider.complete(request)
    except AIProviderError as exc:
        logger.info("AI provider call failed (%s); using local analysis.", exc.code)
        return None, _fallback_message(exc)

    if not response.text or not response.text.strip():
        return (
            None,
            "The AI provider returned an empty answer; the local analysis was used instead.",
        )

    agrees, offending = _numbers_agrees(brief_figures, response.text)
    if not agrees:
        logger.info(
            "Discarding AI text: %d number(s) not in the brief (%s).",
            len(offending),
            ", ".join(offending[:4]),
        )
        return None, _GROUNDING_REJECTION

    if response.finish_reason == "length":
        response.text = _trim_at_sentence(response.text)
    return response, None


__all__ = [
    "ask",
    "dataset_summary",
    "generate_insights",
    "provider_health",
    "suggested_questions",
]