"""The provider used when no API key is configured, and the fallback when one is.

This is not a language model and is never presented as one. It composes the
sentences in :mod:`app.services.ai.narrative` from the figures in the fact brief,
which is why it always works offline, always agrees with the dashboard, and
never invents a number.

``AIResponse.is_ai`` is ``False`` for every answer it produces, and the UI uses
that flag to label the output "written from the analysis" rather than implying a
model was involved.
"""

from __future__ import annotations

from app.services.ai import narrative
from app.services.ai.provider import (
    PROVIDER_LOCAL,
    TASK_ASK,
    TASK_DATASET_SUMMARY,
    TASK_INSIGHT_SECTION,
    AIProviderError,
    AIRequest,
    AIResponse,
)

#: Identifies this provider in the UI and in logs.
LOCAL_MODEL_NAME = "local-analysis"

#: Wording attached to local answers so a reader is never misled about the source.
LOCAL_DISCLAIMER = (
    "Written directly from this dataset's analysis by Datalens' deterministic engine — "
    "every figure above was computed in your file, not generated."
)


class LocalComposerProvider:
    """Answers from the brief without a network call."""

    name = PROVIDER_LOCAL
    model = LOCAL_MODEL_NAME
    is_ai = False

    def available(self) -> bool:
        """Always. This provider needs no configuration at all."""
        return True

    async def complete(self, request: AIRequest) -> AIResponse:
        """Compose the answer for whatever task the request carries."""
        facts = request.facts or {}

        if not facts:
            raise AIProviderError(
                "There is no analysis to explain yet.",
                code="ai_no_context",
                hint="Upload a file and run the analysis before asking a question.",
                status_code=409,
            )

        if request.task == TASK_ASK:
            if not request.question:
                raise AIProviderError(
                    "No question was supplied.",
                    code="ai_no_question",
                    hint="Type a question before sending.",
                    status_code=400,
                )
            answer, intent = narrative.answer_question(facts, request.question)
            return self._respond(answer, finish_reason=f"intent:{intent}")

        if request.task == TASK_INSIGHT_SECTION:
            section = request.section or ""
            composed = narrative.compose_insights(facts)
            entry = composed.get(section)
            if entry is None:
                raise AIProviderError(
                    f"Unknown insight section '{section}'.",
                    code="ai_unknown_section",
                    hint=(
                        "Known sections: "
                        + ", ".join(key for key, _ in narrative.INSIGHT_SECTIONS)
                    ),
                    status_code=400,
                )
            if not entry.available:
                raise AIProviderError(
                    f"There is nothing to write for '{entry.title}' in this dataset.",
                    code="ai_section_empty",
                    hint="The dataset has no data for this section.",
                    status_code=409,
                )
            body = entry.body
            if entry.bullets:
                body += "\n\n" + "\n".join(f"- {b}" for b in entry.bullets)
            return self._respond(body, finish_reason=f"section:{section}")

        if request.task == TASK_DATASET_SUMMARY:
            composed = narrative.compose_insights(facts)
            parts = [
                composed[key].body
                for key, _title in narrative.INSIGHT_SECTIONS
                if composed[key].available
            ]
            return self._respond("\n\n".join(parts), finish_reason="summary")

        # TASK_FREEFORM: there is no prompt to interpret, so say so plainly rather
        # than producing something plausible-looking but unrelated.
        raise AIProviderError(
            "The local provider cannot answer a free-form prompt.",
            code="ai_unsupported_task",
            hint=(
                "Without an AI_API_KEY, Datalens answers only from its own analysis. "
                "Set AI_API_KEY to enable free-form questions."
            ),
            status_code=400,
        )

    def _respond(self, text: str, *, finish_reason: str) -> AIResponse:
        return AIResponse(
            text=text.strip(),
            provider=self.name,
            model=self.model,
            is_ai=False,
            finish_reason=finish_reason,
        )


def local_disclaimer() -> str:
    """The sentence the UI shows above locally-written output."""
    return LOCAL_DISCLAIMER
