"""Safe, confirmed data-quality transformations for saved datasets.

The whole point of this module is that **nothing touches stored data until the
user confirms**. :func:`preview_transform` reads the stored file, applies the
operations to an in-memory copy, and reports exactly what would change (rows,
cells, before/after samples) without writing anything. :func:`apply_transform`
does the same work on the real copy and only then re-runs the analysis engine
and saves a new analysis entry — source bytes are never modified in place.

Only three operations exist, each genuinely absent from the automatic cleaning
pipeline so a apply produces a visible, honest change:

* ``standardize_text`` — trim and collapse internal whitespace in one column.
* ``standardize_casing`` — casefold one column's text values.
* ``drop_duplicates`` — remove exact duplicate rows across all columns.
"""

from __future__ import annotations

import io
from typing import Any

import pandas as pd

from app.core.errors import AppException
from app.loaders import load_file
from app.schemas.library import TransformApplyRequest, TransformPreviewRequest
from app.services import library
from app.services.pipeline import analyze_bytes
from app.services.profiler import profile_dataset

_SAMPLE_SIZE = 3

_NAME_FOR_OP = {
    "standardize_text": "Standardize text",
    "standardize_casing": "Standardize casing",
    "drop_duplicates": "Drop duplicate rows",
}


def preview_transform(
    dataset_id: str,
    request: TransformPreviewRequest,
    *,
    user_id: str | None,
) -> dict[str, Any]:
    """Report what the operations would change, writing nothing."""
    operations = [_op_dict(op) for op in request.operations]
    content, filename, df = _stored_frame(dataset_id, user_id=user_id)

    before_score = _quality_estimate(df)
    applied, after_df = _apply_operations(df, operations)
    after_score = _quality_estimate(after_df)

    return {
        "dataset_id": dataset_id,
        "rows_before": int(len(df)),
        "rows_after": int(len(after_df)),
        "rows_changed": int(len(df) - len(after_df)),
        "operations": applied,
        "quality_score_before": before_score,
        #: Computed with the same profiler formula the engine uses, on the
        #: transformed file, before the pipeline's automatic cleaning pass. The
        #: confirmed apply re-runs the full engine, whose score is authoritative.
        "quality_score_after_estimate": after_score,
        "note": (
            "This is a preview. Nothing has been changed on disk; "
            "the stored file is untouched until you confirm."
        ),
    }


def apply_transform(
    dataset_id: str,
    request: TransformApplyRequest,
    *,
    user_id: str | None,
) -> dict[str, Any]:
    """Apply confirmed operations, re-run the engine, and save a new analysis."""
    if not request.confirm:
        raise AppException(
            message="Transformation was not confirmed.",
            code="transform_not_confirmed",
            hint="Send confirm=true to apply the chosen operations.",
            status_code=400,
        )

    operations = [_op_dict(op) for op in request.operations]
    content, filename, df = _stored_frame(dataset_id, user_id=user_id)
    applied, after_df = _apply_operations(df, operations)

    serialized = _to_csv_bytes(after_df, filename)
    result = analyze_bytes(serialized, filename=filename)
    detail = library.store_analysis(dataset_id, result, user_id=user_id)

    return {
        "dataset_id": dataset_id,
        "applied": applied,
        "rows_before": int(len(df)),
        "rows_after": int(len(after_df)),
        "analysis": detail,
        "note": (
            "The stored file is unchanged; the analysis now comes from a new run "
            "over the transformed copy of your data."
        ),
    }


# --- internals -----------------------------------------------------------------


def _op_dict(op: Any) -> dict[str, Any]:
    return {
        "op": str(op.op),
        "column": op.column,
        "label": _NAME_FOR_OP.get(op.op, op.op),
        "rows_affected": 0,
        "sample_before": [],
        "sample_after": [],
    }


def _stored_frame(dataset_id: str, *, user_id: str | None) -> tuple[bytes, str, pd.DataFrame]:
    """The stored bytes, filename and the loaded dataframe for a dataset."""
    content, _content_type, filename = library.read_dataset_file(
        dataset_id, user_id=user_id
    )
    result = load_file(content, filename)
    return content, filename, result.df


def _apply_operations(
    df: pd.DataFrame,
    operations: list[dict[str, Any]],
) -> tuple[list[dict[str, Any]], pd.DataFrame]:
    """Apply the operations in order over a working copy. Returns summaries + df."""
    working = df.copy(deep=True)
    summaries: list[dict[str, Any]] = []

    for op in operations:
        op_name = op["op"]
        if op_name == "drop_duplicates":
            summary, working = _drop_duplicates(working, op)
        else:
            summary, working = _standardize_column(working, op_name, op)
        summaries.append(summary)

    return summaries, working


def _standardize_column(
    df: pd.DataFrame,
    op_name: str,
    op: dict[str, Any],
) -> tuple[dict[str, Any], pd.DataFrame]:
    column = str(op["column"] or "")
    if column not in df.columns:
        raise AppException(
            message=f"Column '{column}' does not exist in this dataset.",
            code="transform_unknown_column",
            hint="Pick a column from the dataset's profile.",
            status_code=422,
        )

    before = df[column].astype(object)
    if op_name == "standardize_casing":
        def transform(value: Any) -> Any:
            return value.casefold() if isinstance(value, str) else value
    else:
        def transform(value: Any) -> Any:
            if isinstance(value, str):
                return " ".join(value.split())
            return value

    after = before.map(transform)
    changed = before.ne(after)
    rows_affected = int(changed.sum())

    samples_before: list[Any] = []
    samples_after: list[Any] = []
    for index in changed[changed].index[: _SAMPLE_SIZE]:
        samples_before.append(before.loc[index])
        samples_after.append(after.loc[index])

    summary = dict(op)
    summary["rows_affected"] = rows_affected
    summary["sample_before"] = samples_before
    summary["sample_after"] = samples_after
    summary["label"] = f"{op['label']} · {column}"

    working = df.copy(deep=True)
    working[column] = after
    return summary, working


def _drop_duplicates(df: pd.DataFrame, op: dict[str, Any]) -> tuple[dict[str, Any], pd.DataFrame]:
    duplicates = df.duplicated(keep="first").sum()
    summary = dict(op)
    summary["rows_affected"] = int(duplicates)
    summary["sample_before"] = []  # duplicates are whole rows; samples add noise
    summary["sample_after"] = []
    working = df.drop_duplicates(keep="first").reset_index(drop=True)
    return summary, working


def _quality_estimate(df: pd.DataFrame) -> float:
    """The same score the profiler computes, for a comparable preview state."""
    profile = profile_dataset(df)
    return float(profile.data_quality_score or 0.0)


def _to_csv_bytes(df: pd.DataFrame, filename: str) -> bytes:
    """The transformed frame as a CSV the analysis pipeline can read again."""
    del filename  # the pipeline re-sniffs content; plain UTF-8 keeps it simple
    buffer = io.StringIO()
    df.to_csv(buffer, index=False)
    return buffer.getvalue().encode("utf-8")