"""AI services: the provider abstraction, its adapters, and the orchestration.

Import the public surface from here rather than reaching into submodules, so the
provider can be swapped without touching call sites.
"""

from app.services.ai.brief import build_analysis_brief
from app.services.ai.local_provider import LOCAL_DISCLAIMER, LocalComposerProvider
from app.services.ai.narrative import (
    INSIGHT_SECTIONS,
    SUGGESTED_QUESTIONS,
    answer_question,
    answer_suggested_questions,
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
from app.services.ai.service import (
    ask,
    dataset_summary,
    generate_insights,
    provider_health,
    suggested_questions,
)

DESCRIPTIONS = {
    "focus": "The groups carrying the most value, with their share.",
    "underperforming": "The largest decline, and the smallest groups by value.",
    "trend": "Period-over-period movement, the sharpest rises and falls.",
    "distribution": "How the measure is spread across its bands.",
    "quality": "The quality score, each issue, and what Datalens did about it.",
    "anomalies": "Values outside their column's own spread.",
    "summary": "An overall picture of the dataset.",
    "breakdown": "Totals per category, region or channel.",
    "abc": "How many groups sit in each ABC class.",
}


def suggested_questions() -> list[dict[str, str]]:
    """The nine starter questions with a one-line description of what each returns."""
    questions: list[dict[str, str]] = []
    for question in SUGGESTED_QUESTIONS:
        intent, _confidence = classify_question(question)
        questions.append(
            {
                "question": question,
                "intent": intent,
                "covers": DESCRIPTIONS.get(intent, ""),
            }
        )
    return questions


# ---------------------------------------------------------------------------
# Public API – these are the names re-exported by ``app.services.ai.__init__\n# ---------------------------------------------------------------------------

__all__ = [
    "AIProvider",
    "AIProviderError",
    "AIRequest",
    "AIResponse",
    "AIStatus",
    "INSIGHT_SECTIONS",
    "LOCAL_DISCLAIMER",
    "LocalComposerProvider",
    "OpenAICompatibleProvider",
    "PROVIDER_LOCAL",
    "PROVIDER_OPENAI_COMPATIBLE",
    "SUGGESTED_QUESTIONS",
    "ai_status",
    "answer_question",
    "answer_suggested_questions",
    "ask",
    "build_analysis_brief",
    "classify_question",
    "compose_insights",
    "dataset_summary",
    "generate_insights",
    "provider_health",
    "redact_secrets",
    "require_ai_enabled",
    "resolve_provider",
]