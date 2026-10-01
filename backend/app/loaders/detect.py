"""Content sniffing by magic bytes.

An extension is a hint, never proof. Every upload is sniffed before a loader is
chosen so that a renamed executable, a PDF, or a ``.pkl`` can never reach a
parser, and so that a ``data.csv`` that is really a zip bomb is rejected up front.
"""

from __future__ import annotations

import io
import zipfile

# --- content kinds -----------------------------------------------------------

EMPTY = "empty"
TEXT = "text"
JSON = "json"
XML = "xml"
HTML = "html"
ZIP_OOXML = "zip_ooxml"
ZIP_MACRO = "zip_macro"
ZIP_ODS = "zip_ods"
ZIP_OTHER = "zip_other"
OLE2_PLAIN = "ole2_plain"
OLE2_ENCRYPTED = "ole2_encrypted"
PARQUET = "parquet"
ARROW = "arrow"
ORC = "orc"
SQLITE = "sqlite"
GZIP = "gzip"
SAS7BDAT = "sas7bdat"
UNKNOWN = "unknown"

_OLE2_MAGIC = b"\xd0\xcf\x11\xe0\xa1\xb1\x1a\xe1"
_SQLITE_MAGIC = b"SQLite format 3\x00"
_ENCRYPTED_PACKAGE = "EncryptedPackage".encode("utf-16-le")
_SAS_MAGIC = b"SAS     SAS     SASLIB"
_ODS_MIMETYPE = b"application/vnd.oasis.opendocument.spreadsheet"

#: Human-readable names used in warnings and in ``GET /v1/formats``.
KIND_LABELS: dict[str, str] = {
    EMPTY: "empty file",
    TEXT: "delimited text",
    JSON: "JSON",
    XML: "XML",
    HTML: "HTML",
    ZIP_OOXML: "Excel workbook (xlsx)",
    ZIP_MACRO: "macro-enabled Excel workbook (xlsm)",
    ZIP_ODS: "OpenDocument spreadsheet (ods)",
    ZIP_OTHER: "zip archive",
    OLE2_PLAIN: "legacy Excel workbook (xls)",
    OLE2_ENCRYPTED: "encrypted Office document",
    PARQUET: "Parquet",
    ARROW: "Arrow IPC / Feather",
    ORC: "ORC",
    SQLITE: "SQLite database",
    GZIP: "gzip archive",
    SAS7BDAT: "SAS dataset",
    UNKNOWN: "unrecognised content",
}

_BOMS = (b"\xef\xbb\xbf", b"\xff\xfe", b"\xfe\xff")


def _strip_bom(data: bytes) -> bytes:
    for bom in _BOMS:
        if data.startswith(bom):
            return data[len(bom) :]
    return data


def _sniff_zip(data: bytes) -> str:
    """Distinguish OOXML / macro-enabled OOXML / ODS from a plain zip archive."""
    try:
        with zipfile.ZipFile(io.BytesIO(data)) as archive:
            names = set(archive.namelist())
            if "mimetype" in names:
                try:
                    declared = archive.read("mimetype").strip()
                except Exception:  # noqa: BLE001 - a bad mimetype entry is not fatal
                    declared = b""
                if declared == _ODS_MIMETYPE:
                    return ZIP_ODS
            if "xl/workbook.xml" in names:
                if any(n.endswith("vbaProject.bin") for n in names):
                    return ZIP_MACRO
                return ZIP_OOXML
            return ZIP_OTHER
    except Exception:  # noqa: BLE001 - a truncated/hostile zip is just "some other zip"
        return ZIP_OTHER


def _sniff_textual(head: bytes) -> str:
    lowered = head.lstrip()[:64].lower()
    if lowered.startswith(b"<?xml"):
        return XML
    if lowered.startswith(b"<!doctype html") or lowered.startswith(b"<html"):
        return HTML
    if lowered[:1] in (b"{", b"["):
        return JSON
    return TEXT


def sniff(file_bytes: bytes) -> str:
    """Return the content kind for ``file_bytes``.

    Never raises: unrecognised or truncated input is reported as
    :data:`UNKNOWN` (or :data:`EMPTY` for zero bytes) and the caller decides
    whether that is acceptable.
    """
    if not file_bytes:
        return EMPTY

    if file_bytes[:4] == b"PAR1" or file_bytes[-4:] == b"PAR1":
        return PARQUET
    if file_bytes[:6] == b"ARROW1":
        return ARROW
    if file_bytes[:3] == b"ORC":
        return ORC
    if file_bytes[:16] == _SQLITE_MAGIC:
        return SQLITE
    if file_bytes[:2] == b"\x1f\x8b":
        return GZIP
    if _SAS_MAGIC in file_bytes[:256]:
        return SAS7BDAT
    if file_bytes[:2] == b"PK":
        return _sniff_zip(file_bytes)
    if file_bytes[:8] == _OLE2_MAGIC:
        if _ENCRYPTED_PACKAGE in file_bytes[:8192]:
            return OLE2_ENCRYPTED
        return OLE2_PLAIN

    return _sniff_textual(_strip_bom(file_bytes[:512]))


def is_binary(kind: str) -> bool:
    """True when ``kind`` is not something pandas can be handed as raw bytes."""
    return kind not in {TEXT, JSON, XML, HTML, EMPTY, UNKNOWN}
