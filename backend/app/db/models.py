"""Relational models for users, datasets, dataset columns, analyses and results.

Design note — what is *not* here: the individual cells of an uploaded file. A
200k-row CSV is millions of values, and writing them to PostgreSQL row by row
would turn a fast analysis into a slow one for no benefit. What is stored is the
metadata plus the structured analysis payload, and the original file goes to the
storage provider.
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime
from typing import Any

from sqlalchemy import (
    JSON,
    DateTime,
    Float,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, relationship


def _utcnow() -> datetime:
    return datetime.now(UTC)


def _new_uuid() -> str:
    return str(uuid.uuid4())


class Base(DeclarativeBase):
    """Declarative base for every Datalens table."""

    type_annotation_map = {dict[str, Any]: JSON, list[Any]: JSON}


class User(Base):
    """A person who can own datasets. One local user is auto-provisioned."""

    __tablename__ = "users"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_new_uuid)
    email: Mapped[str] = mapped_column(String(320), unique=True, index=True)
    display_name: Mapped[str] = mapped_column(String(120), default="")
    #: PBKDF2-SHA256 digest, never the password itself.
    password_hash: Mapped[str] = mapped_column(String(255))
    is_active: Mapped[bool] = mapped_column(default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_utcnow)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=_utcnow, onupdate=_utcnow
    )

    datasets: Mapped[list[Dataset]] = relationship(
        back_populates="user", cascade="all, delete-orphan"
    )

    def __repr__(self) -> str:  # pragma: no cover - debug aid
        return f"<User {self.email}>"


class Dataset(Base):
    """One uploaded file plus the metadata needed to list and re-open it."""

    __tablename__ = "datasets"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_new_uuid)
    user_id: Mapped[str | None] = mapped_column(
        String(36), ForeignKey("users.id", ondelete="CASCADE"), index=True
    )
    #: User-visible name; editable without touching the original filename.
    name: Mapped[str] = mapped_column(String(255))
    original_filename: Mapped[str] = mapped_column(String(255))
    content_type: Mapped[str] = mapped_column(String(120), default="application/octet-stream")
    size_bytes: Mapped[int] = mapped_column(Integer, default=0)
    #: Opaque key handed to the storage provider. Never a path built from the
    #: user-supplied filename, so a hostile filename cannot escape the store.
    storage_key: Mapped[str | None] = mapped_column(String(255), nullable=True)

    row_count: Mapped[int] = mapped_column(Integer, default=0)
    column_count: Mapped[int] = mapped_column(Integer, default=0)
    quality_score: Mapped[float] = mapped_column(Float, default=0.0)

    product_column: Mapped[str | None] = mapped_column(String(255), nullable=True)
    value_column: Mapped[str | None] = mapped_column(String(255), nullable=True)
    date_column: Mapped[str | None] = mapped_column(String(255), nullable=True)

    #: "ready" | "processing" | "failed"
    status: Mapped[str] = mapped_column(String(32), default="ready", index=True)
    status_detail: Mapped[str | None] = mapped_column(Text, nullable=True)

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=_utcnow, index=True
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=_utcnow, onupdate=_utcnow
    )

    user: Mapped[User | None] = relationship(back_populates="datasets")
    columns: Mapped[list[DatasetColumn]] = relationship(
        back_populates="dataset",
        cascade="all, delete-orphan",
        order_by="DatasetColumn.position",
    )
    analyses: Mapped[list[Analysis]] = relationship(
        back_populates="dataset", cascade="all, delete-orphan", order_by="Analysis.created_at"
    )

    def __repr__(self) -> str:  # pragma: no cover - debug aid
        return f"<Dataset {self.name} ({self.status})>"


class DatasetColumn(Base):
    """Per-column profile for a saved dataset.

    Kept as real columns rather than a JSON blob so the library can filter and
    sort on quality without loading every analysis payload.
    """

    __tablename__ = "dataset_columns"
    __table_args__ = (UniqueConstraint("dataset_id", "name", name="uq_dataset_column_name"),)

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_new_uuid)
    dataset_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("datasets.id", ondelete="CASCADE"), index=True
    )
    name: Mapped[str] = mapped_column(String(255))
    position: Mapped[int] = mapped_column(Integer, default=0)
    detected_type: Mapped[str] = mapped_column(String(32), default="text")
    missing_count: Mapped[int] = mapped_column(Integer, default=0)
    missing_percent: Mapped[float] = mapped_column(Float, default=0.0)
    unique_count: Mapped[int] = mapped_column(Integer, default=0)
    sample_values: Mapped[list[Any]] = mapped_column(JSON, default=list)
    min_value: Mapped[float | None] = mapped_column(Float, nullable=True)
    max_value: Mapped[float | None] = mapped_column(Float, nullable=True)
    mean_value: Mapped[float | None] = mapped_column(Float, nullable=True)
    median_value: Mapped[float | None] = mapped_column(Float, nullable=True)
    std_value: Mapped[float | None] = mapped_column(Float, nullable=True)
    top_values: Mapped[list[Any] | None] = mapped_column(JSON, nullable=True)

    dataset: Mapped[Dataset] = relationship(back_populates="columns")


class Analysis(Base):
    """One run of the deterministic engine over a dataset."""

    __tablename__ = "analyses"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_new_uuid)
    dataset_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("datasets.id", ondelete="CASCADE"), index=True
    )
    user_id: Mapped[str | None] = mapped_column(
        String(36), ForeignKey("users.id", ondelete="SET NULL"), nullable=True, index=True
    )

    product_column: Mapped[str] = mapped_column(String(255))
    value_column: Mapped[str] = mapped_column(String(255))
    date_column: Mapped[str | None] = mapped_column(String(255), nullable=True)
    top_n: Mapped[int] = mapped_column(Integer, default=10)

    processing_ms: Mapped[float] = mapped_column(Float, default=0.0)
    #: "ready" | "failed"
    status: Mapped[str] = mapped_column(String(32), default="ready")

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=_utcnow, index=True
    )

    dataset: Mapped[Dataset] = relationship(back_populates="analyses")
    result: Mapped[AnalysisResult | None] = relationship(
        back_populates="analysis",
        cascade="all, delete-orphan",
        uselist=False,
    )

    def __repr__(self) -> str:  # pragma: no cover - debug aid
        return f"<Analysis {self.id} for dataset {self.dataset_id}>"


class AnalysisResult(Base):
    """The full structured analysis payload, stored as JSON.

    The payload is the same object ``POST /analyze`` returns, so a saved dataset
    can be re-opened without re-uploading or re-processing the file.
    """

    __tablename__ = "analysis_results"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_new_uuid)
    analysis_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("analyses.id", ondelete="CASCADE"), unique=True, index=True
    )
    payload: Mapped[dict[str, Any]] = mapped_column(JSON)
    #: Row preview captured at analysis time so the explorer works on a re-opened
    #: dataset without re-reading the file.
    preview_rows: Mapped[list[Any] | None] = mapped_column(JSON, nullable=True)
    preview_total_rows: Mapped[int] = mapped_column(Integer, default=0)
    preview_truncated: Mapped[bool] = mapped_column(default=False)

    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_utcnow)

    analysis: Mapped[Analysis] = relationship(back_populates="result")


class Conversation(Base):
    """One thread of questions and answers about a saved dataset.

    Messages live in :class:`ConversationMessage`. The raw analysis payload is
    never duplicated here: the conversation references the dataset it belongs to,
    so opening a thread always shows the dataset's current analysis context.
    """

    __tablename__ = "conversations"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_new_uuid)
    dataset_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("datasets.id", ondelete="CASCADE"), index=True
    )
    user_id: Mapped[str | None] = mapped_column(
        String(36), ForeignKey("users.id", ondelete="CASCADE"), nullable=True, index=True
    )
    title: Mapped[str] = mapped_column(String(255), default="New conversation")
    message_count: Mapped[int] = mapped_column(Integer, default=0)

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=_utcnow, index=True
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=_utcnow, onupdate=_utcnow
    )

    messages: Mapped[list[ConversationMessage]] = relationship(
        back_populates="conversation",
        cascade="all, delete-orphan",
        order_by="ConversationMessage.created_at",
    )
    dataset: Mapped[Dataset] = relationship()

    def __repr__(self) -> str:  # pragma: no cover - debug aid
        return f"<Conversation {self.id} for dataset {self.dataset_id}>"


class ConversationMessage(Base):
    """One user question or assistant answer inside a conversation.

    ``meta`` carries the provenance of the answer (intent, source, model,
    ``fell_back``) so the UI can render evidence without re-asking. It never
    stores raw row data or the analysis payload.
    """

    __tablename__ = "conversation_messages"
    __table_args__ = (Index("ix_conversation_message_created", "conversation_id", "created_at"),)

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_new_uuid)
    conversation_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("conversations.id", ondelete="CASCADE"), index=True
    )
    role: Mapped[str] = mapped_column(String(16))  # "user" | "assistant"
    content: Mapped[str] = mapped_column(Text)
    meta: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict)

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=_utcnow, index=True
    )

    conversation: Mapped[Conversation] = relationship(back_populates="messages")

    def __repr__(self) -> str:  # pragma: no cover - debug aid
        return f"<ConversationMessage {self.role} in {self.conversation_id}>"


Index("ix_datasets_user_created", Dataset.user_id, Dataset.created_at)
