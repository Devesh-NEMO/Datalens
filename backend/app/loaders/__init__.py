"""Datalens loader layer.

Each module in this package owns one file family. ``registry`` is the only
public entry point: it resolves an upload to a loader using both the extension
and the file's magic bytes, then applies the size and shape caps.
"""

from app.loaders.base import (
    Loader,
    LoadMetadata,
    LoadOptions,
    LoadResult,
    normalize_columns,
)
from app.loaders.registry import (
    FORMATS,
    SUPPORTED_EXTENSIONS,
    FormatSpec,
    list_formats,
    load_file,
    resolve_loader,
    supported_extensions_text,
)

__all__ = [
    "FORMATS",
    "SUPPORTED_EXTENSIONS",
    "FormatSpec",
    "Loader",
    "LoadMetadata",
    "LoadOptions",
    "LoadResult",
    "list_formats",
    "load_file",
    "normalize_columns",
    "resolve_loader",
    "supported_extensions_text",
]
