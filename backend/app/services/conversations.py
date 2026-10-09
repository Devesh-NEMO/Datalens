"""Conversation persistence: threads of questions and answers per dataset.

A conversation belongs to a dataset and to the user who created it. Every read
and write is scoped to that user, so enabling auth cannot leak one account's
threads to another. The AI call itself lives in :mod:`app.services.ai.service`;
this module only stores the exchange and its provenance.
"""

from __future__ import annotations

from typing import Any

from sqlalchemy import func, select
from sqlalchemy.exc import SQLAlchemyError

from app.core.errors import AppException
from app.db.models import Conversation, ConversationMessage, Dataset
from app.db.session import session_scope
from app.schemas.library import AskResponse
from app.services import ai as ai_service
from app.services import library

_TITLE_MAX = 120


def _conversation_summary(conversation: Conversation) -> dict[str, Any]:
    return {
        "id": conversation.id,
        "dataset_id": conversation.dataset_id,
        "title": conversation.title,
        "message_count": int(conversation.message_count or 0),
        "created_at": conversation.created_at.isoformat(),
        "updated_at": conversation.updated_at.isoformat(),
    }


def _message_dict(message: ConversationMessage) -> dict[str, Any]:
    return {
        "id": message.id,
        "role": message.role,
        "content": message.content,
        "meta": message.meta or {},
        "created_at": message.created_at.isoformat(),
    }


def _message_row(
    session: Any, conversation_id: str, role: str, content: str, meta: dict
) -> ConversationMessage:
    row = ConversationMessage(
        conversation_id=conversation_id,
        role=role,
        content=content,
        meta=meta,
    )
    session.add(row)
    return row


def _updated_title(existing: str, question: str) -> str:
    """Derive a title from the first question the conversation ever saw."""
    if existing and existing != "New conversation":
        return existing
    cleaned = " ".join(question.split())
    return cleaned[:_TITLE_MAX]


def create_conversation(
    dataset_id: str,
    *,
    user_id: str | None,
    title: str | None = None,
) -> dict[str, Any]:
    """Start a thread about a saved dataset."""
    library.library_status()  # raises PersistenceUnavailableError when the DB is down
    with session_scope() as session:
        dataset = session.get(Dataset, dataset_id)
        if dataset is None or (user_id and dataset.user_id != user_id):
            raise _not_found("dataset", dataset_id)
        conversation = Conversation(
            dataset_id=dataset_id,
            user_id=user_id,
            title=(title or "").strip()[:_TITLE_MAX] or "New conversation",
        )
        session.add(conversation)
        session.flush()
        return _conversation_summary(conversation)


def list_conversations(dataset_id: str, *, user_id: str | None) -> dict[str, Any]:
    """Threads for a dataset, newest first. Never raises for a missing DB."""
    status = library.library_status()
    if not status.available:
        return {"conversations": [], "total": 0, **status.to_dict()}
    try:
        with session_scope() as session:
            query = (
                select(Conversation)
                .where(Conversation.dataset_id == dataset_id)
                .order_by(Conversation.updated_at.desc(), Conversation.id.desc())
            )
            if user_id:
                query = query.where(Conversation.user_id == user_id)
            rows = list(session.scalars(query.limit(200)))
            total = session.scalar(
                select(func.count()).select_from(query.order_by(None).subquery())
            )
            return {
                "conversations": [_conversation_summary(c) for c in rows],
                "total": int(total or 0),
                "persistence_available": True,
            }
    except SQLAlchemyError as exc:  # pragma: no cover - defensive
        return {
            "conversations": [],
            "total": 0,
            "persistence_available": False,
            "reason": f"Conversations could not be read ({type(exc).__name__}).",
        }


def get_conversation(conversation_id: str, *, user_id: str | None) -> dict[str, Any] | None:
    """One thread with its messages, or None (missing / not yours)."""
    status = library.library_status()
    if not status.available:
        return None
    try:
        with session_scope() as session:
            conversation = _owned_conversation(session, conversation_id, user_id)
            if conversation is None:
                return None
            messages = list(
                session.scalars(
                    select(ConversationMessage)
                    .where(ConversationMessage.conversation_id == conversation_id)
                    .order_by(ConversationMessage.created_at, ConversationMessage.id)
                )
            )
            return {
                "conversation": _conversation_summary(conversation),
                "messages": [_message_dict(m) for m in messages],
            }
    except SQLAlchemyError as exc:  # pragma: no cover - defensive
        logger = __import__("logging").getLogger("data_analyzer.conversations")
        logger.warning("Could not read conversation %s: %s", conversation_id, type(exc).__name__)
        return None


def delete_conversation(conversation_id: str, *, user_id: str | None) -> dict[str, Any]:
    """Delete a thread and its messages. 404 if it is missing or not yours."""
    library.library_status()
    with session_scope() as session:
        conversation = _owned_conversation(session, conversation_id, user_id)
        if conversation is None:
            raise _not_found("conversation", conversation_id)
        session.delete(conversation)
        return {"id": conversation_id, "deleted": True}


async def add_message(
    conversation_id: str,
    *,
    user_id: str | None,
    question: str,
) -> dict[str, Any]:
    """Answer a question inside a conversation and persist both sides.

    Returns the saved messages plus the full ask response for the UI to render
    provenance (intent, source, ``fell_back``) without re-asking.
    """
    question = " ".join(str(question or "").split())
    if not question:
        raise AppException(
            message="A question is required.",
            code="ai_no_question",
            hint="Type a question before sending.",
            status_code=400,
        )

    library.library_status()
    with session_scope() as session:
        conversation = _owned_conversation(session, conversation_id, user_id)
        if conversation is None:
            raise _not_found("conversation", conversation_id)

        dataset = session.get(Dataset, conversation.dataset_id)
        if dataset is None:
            raise _not_found("dataset", conversation.dataset_id)

        # History for coherent follow-ups: the last few exchanges only.
        history_rows = list(
            session.scalars(
                select(ConversationMessage)
                .where(ConversationMessage.conversation_id == conversation_id)
                .order_by(ConversationMessage.created_at.desc())
                .limit(6)
            )
        )[::-1]
        history = [
            {"role": m.role, "content": m.content[:400]}
            for m in history_rows
            if m.role in ("user", "assistant")
        ]

        detail = library.get_dataset(dataset.id, user_id=user_id)
        payload = (detail or {}).get("analysis")
        if not payload:
            raise AppException(
                message="This dataset has no analysis to answer questions about yet.",
                code="analysis_unavailable",
                hint="Re-analyse the dataset, then ask again.",
                status_code=409,
            )

        conversation.title = _updated_title(conversation.title, question)

        user_message = _message_row(session, conversation_id, "user", question, {})
        session.flush()

    # The AI call happens outside the transaction so a slow provider never holds
    # a database connection open.
    answer: AskResponse = await ai_service.ask(payload, question, history=history)

    with session_scope() as session:
        conversation = _owned_conversation(session, conversation_id, user_id)
        if conversation is None:  # pragma: no cover - deleted mid-request
            raise _not_found("conversation", conversation_id)
        assistant_message = _message_row(
            session,
            conversation_id,
            "assistant",
            answer.answer,
            {
                "intent": answer.intent,
                "intent_matched": answer.intent_matched,
                "source": answer.source,
                "provider": answer.provider,
                "model": answer.model,
                "is_ai": answer.is_ai,
                "fell_back": answer.fell_back,
                "fallback_reason": answer.fallback_reason,
            },
        )
        conversation.message_count = int(conversation.message_count or 0) + 2
        conversation.title = _updated_title(conversation.title, question)
        session.flush()
        summary = _conversation_summary(conversation)
        user_row = _message_dict(user_message)
        assistant_row = _message_dict(assistant_message)

    return {
        "conversation": summary,
        "user_message": user_row,
        "assistant_message": assistant_row,
        "ask": answer.model_dump(),
    }


def _owned_conversation(
    session: Any, conversation_id: str, user_id: str | None
) -> Conversation | None:
    query = select(Conversation).where(Conversation.id == conversation_id)
    if user_id:
        query = query.where(Conversation.user_id == user_id)
    return session.scalar(query)


def _not_found(kind: str, record_id: str) -> AppException:
    return AppException(
        message=f"That {kind} does not exist.",
        code=f"{kind}_not_found",
        hint="It may have been deleted, or it belongs to another account.",
        status_code=404,
    )