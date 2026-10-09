"""Conversation endpoints: create, list, open, send and delete threads.

A conversation is always about one saved dataset and belongs to one user, so
every route resolves ownership through the auth context. When auth is optional
(the default), everything lands on the local user and works exactly the same.
"""

from __future__ import annotations

from typing import Annotated, Any

from fastapi import APIRouter, Body, Depends

from app.api.deps import AuthContext, require_auth
from app.schemas.library import (
    CreateConversationRequest,
    PostMessageRequest,
)
from app.services import conversations

router = APIRouter(tags=["Conversations"])


@router.post(
    "/datasets/{dataset_id}/conversations",
    summary="Start a Conversation About a Dataset",
    description=(
        "Creates an empty thread on a saved dataset. The title defaults to 'New "
        "conversation' and is refined from the first question when one is asked."
    ),
)
async def create_conversation(
    dataset_id: str,
    body: CreateConversationRequest | None = Body(default=None),
    auth: Annotated[AuthContext, Depends(require_auth)] = ...,
) -> dict[str, Any]:
    payload = body or CreateConversationRequest()
    return conversations.create_conversation(
        dataset_id, user_id=auth.owner_id, title=payload.title
    )


@router.get(
    "/datasets/{dataset_id}/conversations",
    summary="List Conversations for a Dataset",
    description="Threads for a dataset, newest first. Empty when none exist yet.",
)
async def list_conversations(
    dataset_id: str,
    auth: Annotated[AuthContext, Depends(require_auth)] = ...,
) -> dict[str, Any]:
    return conversations.list_conversations(dataset_id, user_id=auth.owner_id)


@router.get(
    "/conversations/{conversation_id}",
    summary="Open a Conversation",
    description="One thread with its messages, in chronological order.",
)
async def open_conversation(
    conversation_id: str,
    auth: Annotated[AuthContext, Depends(require_auth)] = ...,
) -> dict[str, Any]:
    detail = conversations.get_conversation(conversation_id, user_id=auth.owner_id)
    if detail is None:
        from app.core.errors import AppException

        raise AppException(
            message="That conversation does not exist.",
            code="conversation_not_found",
            hint="It may have been deleted, or it belongs to another account.",
            status_code=404,
        )
    return detail


@router.post(
    "/conversations/{conversation_id}/messages",
    summary="Ask a Question in a Conversation",
    description=(
        "Answers a question in the context of a conversation. The question and "
        "answer are saved with full provenance (intent, source, whether a model "
        "wrote the answer or it fell back to the checked local analysis)."
    ),
)
async def post_message(
    conversation_id: str,
    body: PostMessageRequest,
    auth: Annotated[AuthContext, Depends(require_auth)] = ...,
) -> dict[str, Any]:
    return await conversations.add_message(
        conversation_id,
        user_id=auth.owner_id,
        question=body.question,
    )


@router.delete(
    "/conversations/{conversation_id}",
    summary="Delete a Conversation",
    description="Removes the thread and all of its messages.",
)
async def delete_conversation(
    conversation_id: str,
    auth: Annotated[AuthContext, Depends(require_auth)] = ...,
) -> dict[str, Any]:
    return conversations.delete_conversation(conversation_id, user_id=auth.owner_id)


__all__ = ["router"]