"""Shared contracts for the Datalens loader layer.

A loader turns raw uploaded bytes into a ``pandas.DataFrame`` plus metadata about
what it found. Loaders deliberately stop short of cleaning: they hand back raw
string cells so the existing cleaner keeps behaving identically for every format.
No loader may evaluate formulas, run macros, unpickle, or call ``eval``.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Protocol, runtime_checkable

import pandas as pd


@dataclass(frozen=True)
class LoadOptions:
    """Optional caller hints for picking a sheet (spreadsheets) or table (SQLite)."""

    sheet: str | None = None
    table: str | None = None


@dataclass
class LoadMetadata:
    """Everything the loader learned about the bytes it was handed."""

    format: str
    encoding: str | None = None
    delimiter: str | None = None
    header_row: int = 0
    rows: int = 0
    columns: int = 0
    sheet_name: str | None = None
    sheet_names: list[str] = field(default_factory=list)
    table_name: str | None = None
    table_names: list[str] = field(default_factory=list)


@dataclass
class LoadResult:
    """A parsed table, its metadata, and human-readable warnings for the UI."""

    df: pd.DataFrame
    metadata: LoadMetadata
    warnings: list[str] = field(default_factory=list)


@runtime_checkable
class Loader(Protocol):
    """Every format family implements exactly this one method."""

    name: str

    def load(self, file_bytes: bytes, filename: str, options: LoadOptions) -> LoadResult:
        """Parse ``file_bytes`` into a dataframe."""
        ...


def normalize_columns(columns: list[object]) -> list[str]:
    """Trim whitespace and guarantee non-empty unique string column names."""
    normalized: list[str] = []
    seen: dict[str, int] = {}

    for i, col in enumerate(columns):
        name = str(col).strip() if col is not None else ""
        if not name:
            name = f"Unnamed_{i + 1}"

        if name in seen:
            seen[name] += 1
            name = f"{name}_{seen[name]}"
        else:
            seen[name] = 0

        normalized.append(name)

    return normalized


def finish(
    df: pd.DataFrame,
    *,
    fmt: str,
    warnings: list[str],
    encoding: str | None = None,
    delimiter: str | None = None,
    header_row: int = 0,
    sheet_name: str | None = None,
    sheet_names: list[str] | None = None,
    table_name: str | None = None,
    table_names: list[str] | None = None,
) -> LoadResult:
    """Normalize column names, stamp metadata, and wrap the frame in a LoadResult."""
    df.columns = normalize_columns(list(df.columns))
    return LoadResult(
        df=df,
        metadata=LoadMetadata(
            format=fmt,
            encoding=encoding,
            delimiter=delimiter,
            header_row=header_row,
            rows=len(df),
            columns=len(df.columns),
            sheet_name=sheet_name,
            sheet_names=list(sheet_names or []),
            table_name=table_name,
            table_names=list(table_names or []),
        ),
        warnings=warnings,
    )
