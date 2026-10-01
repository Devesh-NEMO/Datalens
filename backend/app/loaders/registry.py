"""Loader registry: extension *and* magic bytes decide which loader runs.

Resolution order matters and is deliberate:

1. Reject unknown extensions outright (``unsupported_format``) — this keeps
   ``.pkl``/``.pdf``/``.docx``/images away from every parser.
2. Sniff the bytes. If the sniffed kind belongs to a *different* family than the
   extension claims, reject with ``format_content_mismatch`` rather than guessing.
3. Only then run the loader, and apply the row/column caps afterwards.
"""

from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass
from pathlib import Path

from app.config import settings
from app.core.errors import (
    FormatMismatchError,
    PayloadTooLargeError,
    UnprocessableDataError,
    UnsupportedFormatError,
)
from app.loaders import detect
from app.loaders.base import Loader, LoadOptions, LoadResult
from app.loaders.delimited_loader import DelimitedLoader
from app.loaders.excel_loader import ExcelLoader


@dataclass(frozen=True)
class FormatSpec:
    """One readable file family, as advertised to the frontend."""

    loader: str
    label: str
    extensions: tuple[str, ...]
    mime_types: tuple[str, ...] = ()
    #: True when the family can contain several sheets/tables and needs a picker.
    needs_picker: bool = False

    def as_dict(self) -> dict[str, object]:
        return {
            "loader": self.loader,
            "label": self.label,
            "extensions": list(self.extensions),
            "mime_types": list(self.mime_types),
            "needs_picker": self.needs_picker,
        }


# --- the registry ------------------------------------------------------------

_LOADERS: dict[str, Loader] = {
    "delimited": DelimitedLoader(),
    "excel": ExcelLoader(),
}

#: Content kinds each loader is allowed to receive. A mismatch here is an error,
#: which is what stops a zip bomb disguised as ``sales.csv``.
CLAIMED_KINDS: dict[str, frozenset[str]] = {
    "delimited": frozenset({detect.TEXT, detect.UNKNOWN}),
    "excel": frozenset({detect.ZIP_OOXML, detect.ZIP_MACRO, detect.OLE2_PLAIN}),
}

FORMATS: tuple[FormatSpec, ...] = (
    FormatSpec(
        loader="delimited",
        label="Delimited text",
        extensions=(".csv", ".tsv", ".txt", ".tab"),
        mime_types=("text/csv", "text/tab-separated-values", "text/plain"),
    ),
    FormatSpec(
        loader="excel",
        label="Excel workbook",
        extensions=(".xlsx", ".xlsm", ".xls", ".xlsb", ".ods"),
        mime_types=(
            "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            "application/vnd.ms-excel.sheet.macroEnabled.12",
            "application/vnd.ms-excel",
            "application/vnd.oasis.opendocument.spreadsheet",
        ),
        needs_picker=True,
    ),
)

_EXTENSION_INDEX: dict[str, FormatSpec] = {
    ext: spec for spec in FORMATS for ext in spec.extensions
}

#: Used to build the hint on unsupported uploads. Generated from FORMATS so the
#: frontend's list and the server's list can never drift apart.
SUPPORTED_EXTENSIONS: frozenset[str] = frozenset(_EXTENSION_INDEX)


def supported_extensions_text() -> str:
    """Comma-separated extension list for error hints."""
    return ", ".join(sorted(SUPPORTED_EXTENSIONS))


def list_formats() -> list[dict[str, object]]:
    """Serialisable description of every supported format, for GET /v1/formats."""
    return [
        {
            **spec.as_dict(),
            "max_upload_mb": settings.max_upload_mb,
            "max_rows": settings.max_rows,
            "max_columns": settings.max_columns,
        }
        for spec in FORMATS
    ]


def resolve_loader(filename: str, file_bytes: bytes) -> tuple[str, str]:
    """Return ``(loader_name, content_kind)`` or raise an AppException."""
    ext = Path(filename).suffix.lower()
    spec = _EXTENSION_INDEX.get(ext)

    if spec is None:
        raise UnsupportedFormatError(
            message=(
                f"Unsupported file format '{ext or 'unknown'}'."
                if ext
                else "Unsupported file: it has no extension."
            ),
            hint=f"Supported formats are: {supported_extensions_text()}.",
            supported=supported_extensions_text(),
        )

    kind = detect.sniff(file_bytes)
    if kind == detect.EMPTY:
        raise UnprocessableDataError(
            message="Uploaded file is empty (0 bytes).",
            hint="Please upload a file that contains data.",
        )

    if kind not in CLAIMED_KINDS[spec.loader]:
        actual = detect.KIND_LABELS.get(kind, kind)
        raise FormatMismatchError(
            message=(
                f"The file is named '{ext}' but its contents look like {actual}, "
                f"not {spec.label.lower()}."
            ),
            hint=(
                f"Rename the file to '{_example_extension_for(spec)}' or re-export "
                "your data in the format it actually is."
            ),
        )

    return spec.loader, kind


def _example_extension_for(spec: FormatSpec) -> str:
    return spec.extensions[0]


def get_loader(name: str) -> Loader:
    """Look up a loader by registry name."""
    try:
        return _LOADERS[name]
    except KeyError as exc:
        raise UnsupportedFormatError(
            message=f"No loader registered for '{name}'.",
            hint="This is an internal configuration error.",
        ) from exc


def load_file(
    file_bytes: bytes,
    filename: str,
    options: LoadOptions | None = None,
) -> LoadResult:
    """Load uploaded bytes into a dataframe, enforcing size and shape caps.

    This is the single entry point the API layer should use.
    """
    opts = options or LoadOptions()

    file_size = len(file_bytes)
    if file_size == 0:
        raise UnprocessableDataError(
            message="Uploaded file is empty (0 bytes).",
            hint="Please upload a file that contains data.",
        )

    if file_size > settings.max_upload_bytes:
        mb_size = file_size / (1024 * 1024)
        raise PayloadTooLargeError(
            message=(
                f"File size ({mb_size:.1f} MB) exceeds maximum allowed "
                f"{settings.max_upload_mb} MB."
            ),
            hint=f"Please upload a file smaller than {settings.max_upload_mb} MB.",
        )

    loader_name, _ = resolve_loader(filename, file_bytes)
    loader = get_loader(loader_name)

    try:
        result = loader.load(file_bytes, filename, opts)
    except (
        PayloadTooLargeError,
        UnsupportedFormatError,
        FormatMismatchError,
        UnprocessableDataError,
    ):
        raise
    except Exception as exc:  # noqa: BLE001 - a parser blow-up must stay a 422
        raise UnprocessableDataError(
            message=f"Failed to parse file: {exc!s}",
            hint="Please ensure the file is not corrupted and is in a supported format.",
        ) from exc

    _enforce_shape_caps(result)
    return result


def _enforce_shape_caps(result: LoadResult) -> None:
    """Row/column caps, applied after parsing (some formats cannot be sized early)."""
    row_count = len(result.df)
    col_count = len(result.df.columns)

    if col_count == 0 or (row_count == 0 and col_count <= 1 and result.df.empty):
        raise UnprocessableDataError(
            message="No tabular data or columns could be parsed from the file.",
            hint="Check that your file contains tabular data with column headers.",
        )

    if col_count > settings.max_columns:
        raise UnprocessableDataError(
            message=(
                f"File contains {col_count} columns, exceeding the maximum "
                f"allowed of {settings.max_columns}."
            ),
            hint=f"Reduce the number of columns to at most {settings.max_columns}.",
        )

    if row_count > settings.max_rows:
        raise UnprocessableDataError(
            message=(
                f"File contains {row_count} rows, exceeding the maximum "
                f"allowed of {settings.max_rows}."
            ),
            hint=f"Reduce the number of rows to at most {settings.max_rows}.",
        )


def loader_names() -> list[Callable[[bytes, str, LoadOptions], LoadResult]]:
    """Every registered loader callable. Used by tests to exercise each family."""
    return list(_LOADERS.values())
