"""Internal implementation module for AI service.

Contains ``AIServiceImpl`` – the concrete class held by the singleton
``_ai = AIServiceImpl()`` in ``app.services.ai.service``.

Do not import from this module outside the package.
"""

from __future__ import annotations

from app.services.ai.local_provider import LocalComposerProvider


class AIServiceImpl:
    """Concrete implementation – holds the provider + local composer."""

    def __init__(self) -> None:
        self._local = LocalComposerProvider()
        self._provider: Any = None  # resolved lazily

    def _resolve_provider(self) -> tuple[Any, bool]:
        from app.services.ai.provider import ai_status, resolve_provider

        status = ai_status()
        if not status.enabled or not status.configured:
            return None, True  # no provider configured
        return resolve_provider(), False

    def ask(self, analysis: Any, question: str, history: list[dict[str, str]] | None = None) -> Any:
        from app.services.ai.brief import _brief_numbers, _numbers_agrees

        prov, is_local = self._resolve_provider()
        brief = build_analysis_brief(analysis)
        brief_numbers = _brief_numbers(brief)

        from app.services.ai.narrative import answer_question

        answer, source, provider_name, model, fell_back, fallback_reason, disclaimer = (
            answer_question(
                question,
                brief,
                provider=prov if not is_local else None,
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
            "disclaimer": "Local analysis is the source of truth; model explanations supplement rather than replace computed figures.",
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