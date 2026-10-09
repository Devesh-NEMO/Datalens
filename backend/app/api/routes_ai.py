"""AI endpoints: insights, ask, suggestions, dataset summary, provider health.

The rule this module enforces at the HTTP boundary: **the deterministic engine
is the source of truth and the model only explains it.** Every endpoint here takes
an analysis payload, hands it to :mod:`app.services.ai.service`, and returns the
result. Nothing in this file composes prose, and nothing accepts row data.

Three states the UI must be able to tell apart, which is why each response
carries them explicitly rather than folding them into one flag:

* ``is_ai: false`` — no provider configured, so Datalens' own computed text was
  used. Correct, not degraded, and the UI labels it "Local analysis".
* ``fell_back: true`` — a provider was configured and failed. The answer is still
  correct because it came from the analysis, but the reason is reported.
* ``status.configured: false`` — nothing is set up. The page shows a
  "not configured" panel instead of a half-empty answer area.
"""

from __future__ import annotations

import logging
from typing import Annotated, Any

from fastapi import APIRouter, Body, Depends, File, Form, UploadFile

from app.api.deps import AuthContext, require_auth
from app.core.errors import AppException
from app.schemas.library import (
    AskPayloadRequest,
    AskRequest,
    AskResponse,
    InsightsPayloadRequest,
    InsightsResponse,
    SuggestionResponse,
)
from app.services import ai as ai_service
from app.services import library
from app.services.pipeline import analyze_bytes

logger = logging.getLogger("data_analyzer.api.ai")

router = APIRouter(tags=["AI"])


# --- configuration --------------------------------------------------------------


@router.get(
    "/ai/status",
    summary="AI Provider Status",
    description=(
        "Whether a model provider is configured and reachable, with no secret material. "
        "The insights and ask pages use this to decide between an answer area and a "
        "'not configured' panel."
    ),
)
async def ai_status_endpoint() -> dict[str, Any]:
    return ai_service.ai_status().to_dict()


@router.get(
    "/ai/test-connection",
    summary="Test the AI Provider",
    description=(
        "Sends a one-word probe to the configured provider and reports latency. Never "
        "sends any dataset content, so it is safe to offer as a 'Test connection' "
        "button on the settings page."
    ),
)
async def ai_test_connection() -> dict[str, Any]:
    return await ai_service.provider_health()


@router.get(
    "/ai/suggestions",
    response_model=list[SuggestionResponse],
    summary="Suggested Questions",
    description=(
        "The questions the local analysis engine actually answers, with the intent each "
        "one matches. Generated from the engine rather than hardcoded in the frontend, "
        "so the suggestions cannot drift away from what can be answered."
    ),
)
async def ai_suggestions() -> list[dict[str, Any]]:
    return ai_service.suggested_questions()


# --- insights -------------------------------------------------------------------


@router.post(
    "/ai/insights",
    response_model=InsightsResponse,
    summary="Generate Insights for an Upload",
    description=(
        "Seven written sections over an uploaded file. With a provider configured each "
        "section is explained by the model; without one, Datalens' own computed text is "
        "returned and labelled as such. Sections the data cannot support come back with "
        "`available: false` rather than an empty panel."
    ),
)
async def insights_inline(
    file: Annotated[UploadFile, File(description="CSV (.csv) or Excel (.xlsx, .xls) file")],
    product_column: Annotated[str | None, Form(description="Grouping column override")] = None,
    value_column: Annotated[str | None, Form(description="Measure column override")] = None,
    date_column: Annotated[str | None, Form(description="Date column override")] = None,
    sheet_name: Annotated[str | None, Form(description="Excel sheet to read")] = None,
    table: Annotated[str | None, Form(description="SQLite table to read")] = None,
    auth: AuthContext = Depends(require_auth),
) -> InsightsResponse:
    content = await file.read()
    result = analyze_bytes(
        content,
        filename=file.filename or "uploaded_data.csv",
        product_column=product_column,
        value_column=value_column,
        date_column=date_column,
        sheet_name=sheet_name,
        table=table,
    )
    return await ai_service.generate_insights(result.response)


@router.post(
    "/ai/insights/upload",
    response_model=InsightsResponse,
    summary="Generate Insights from a JSON Request",
    description=(
        "The same as `/ai/insights`, but takes the analysis payload as JSON instead of "
        "the file. The frontend already has the payload from `/analyze`, so this avoids "
        "sending the file twice."
    ),
)
async def insights_from_payload(
    body: InsightsPayloadRequest | None = Body(default=None),
    auth: AuthContext = Depends(require_auth),
) -> InsightsResponse:
    payload = body.analysis if body is not None else None
    if not payload:
        raise AppException(
            message="No analysis was supplied.",
            code="ai_no_context",
            hint="Analyse a file first, then pass its analysis payload back here.",
            status_code=400,
        )
    return await ai_service.generate_insights(payload)


@router.post(
    "/datasets/{dataset_id}/insights",
    response_model=InsightsResponse,
    summary="Generate Insights for a Saved Dataset",
    description=(
        "Insights for a stored dataset, computed from its saved analysis. No file is "
        "re-read and nothing is sent anywhere except the configured AI provider."
    ),
)
async def insights_for_dataset(
    dataset_id: str,
    auth: AuthContext = Depends(require_auth),
) -> InsightsResponse:
    payload = _saved_payload(dataset_id, auth, action="generate insights for")
    return await ai_service.generate_insights(payload)


# --- summary --------------------------------------------------------------------


@router.post(
    "/ai/summary",
    summary="One-Paragraph Dataset Summary",
    description="A short overview for the dashboard header, from the same grounded brief.",
)
async def summary_inline(
    file: Annotated[UploadFile, File(description="CSV (.csv) or Excel (.xlsx, .xls) file")],
    product_column: Annotated[str | None, Form(description="Grouping column override")] = None,
    value_column: Annotated[str | None, Form(description="Measure column override")] = None,
    date_column: Annotated[str | None, Form(description="Date column override")] = None,
    sheet_name: Annotated[str | None, Form(description="Excel sheet to read")] = None,
    table: Annotated[str | None, Form(description="SQLite table to read")] = None,
    auth: AuthContext = Depends(require_auth),
) -> dict[str, Any]:
    content = await file.read()
    result = analyze_bytes(
        content,
        filename=file.filename or "uploaded_data.csv",
        product_column=product_column,
        value_column=value_column,
        date_column=date_column,
        sheet_name=sheet_name,
        table=table,
    )
    return await ai_service.dataset_summary(result.response)


# --- ask ------------------------------------------------------------------------


@router.post(
    "/ai/ask",
    summary="Ask a Question About an Upload",
    description=(
        "Answers one question about an uploaded file. The provider sees aggregate facts "
        "only — never individual rows. Without a provider configured the deterministic "
        "engine answers, and `intent_matched` says whether it understood the question."
    ),
)
async def ask_inline(
    file: Annotated[UploadFile, File(description="CSV (.csv) or Excel (.xlsx, .xls) file")],
    question: Annotated[str, Form(min_length=1, max_length=1000, description="The question")],
    product_column: Annotated[str | None, Form(description="Grouping column override")] = None,
    value_column: Annotated[str | None, Form(description="Measure column override")] = None,
    date_column: Annotated[str | None, Form(description="Date column override")] = None,
    sheet_name: Annotated[str | None, Form(description="Excel sheet to read")] = None,
    table: Annotated[str | None, Form(description="SQLite table to read")] = None,
    auth: AuthContext = Depends(require_auth),
) -> AskResponse:
    content = await file.read()
    result = analyze_bytes(
        content,
        filename=file.filename or "uploaded_data.csv",
        product_column=product_column,
        value_column=value_column,
        date_column=date_column,
        sheet_name=sheet_name,
        table=table,
    )
    return await ai_service.ask(result.response, question)


@router.post(
    "/ai/ask/payload",
    response_model=AskResponse,
    summary="Ask a Question About a Supplied Analysis",
    description=(
        "Answers a question about an analysis the caller already holds, as JSON. Used by "
        "the frontend so the file is sent once, to `/analyze`, and never again."
    ),
)
async def ask_payload(
    body: AskPayloadRequest,
    auth: AuthContext = Depends(require_auth),
) -> AskResponse:
    if not body.analysis:
        raise AppException(
            message="No analysis was supplied.",
            code="ai_no_context",
            hint="Analyse a file first, then pass its analysis payload back here.",
            status_code=400,
        )
    return await ai_service.ask(body.analysis, body.question, history=body.history)


@router.post(
    "/datasets/{dataset_id}/ask",
    response_model=AskResponse,
    summary="Ask a Question About a Saved Dataset",
    description=(
        "Answers a question about a stored dataset from its saved analysis. This is the "
        "route the 'Ask Datalens' page uses once a dataset is saved."
    ),
)
async def ask_dataset(
    dataset_id: str,
    body: AskRequest,
    auth: AuthContext = Depends(require_auth),
) -> AskResponse:
    payload = _saved_payload(dataset_id, auth, action="ask questions about")
    return await ai_service.ask(payload, body.question, history=body.history)


# --- helpers --------------------------------------------------------------------


def _saved_payload(dataset_id: str, auth: AuthContext, *, action: str) -> dict[str, Any]:
    """The cached analysis for a dataset, or a clear error."""
    detail = library.get_dataset(dataset_id, user_id=auth.owner_id)
    if detail is None:
        info = library.library_status()
        if not info.available:
            raise library.PersistenceUnavailableError(info.reason)
        raise AppException(
            message=f"Cannot {action} that dataset.",
            code="dataset_not_found",
            hint="It may have been deleted, or it belongs to another account.",
            status_code=404,
        )
    payload = detail.get("analysis")
    if not payload:
        raise AppException(
            message=f"The analysis for '{detail.get('name', 'this dataset')}' is not available.",
            code="analysis_unavailable",
            hint="Re-analyse the dataset, then try again.",
            status_code=409,
        )
    return payload


__all__ = ["router"]