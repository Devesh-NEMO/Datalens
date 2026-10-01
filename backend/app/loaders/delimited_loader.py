"""Delimited text loader for .csv, .tsv, .txt and .tab.

Behaviour is byte-for-byte identical to the previous CSV-only path: encoding
fallback order, delimiter heuristic, and the all-strings read that lets the
cleaner decide what is numeric.
"""

from __future__ import annotations

import io

import pandas as pd

from app.loaders.base import LoadOptions, LoadResult, finish

SUPPORTED_DELIMITERS = [",", ";", "\t", "|"]

#: Extension label reported in metadata and in GET /v1/formats.
FORMAT_NAME = "delimited"

#: Tried in order; the first that decodes wins. Latin-1 never fails, so it is last.
ENCODING_FALLBACKS = ["utf-8", "utf-8-sig", "latin-1"]


def detect_delimiter(sample_text: str) -> str:
    """Detect the delimiter from a text sample using a frequency heuristic."""
    if not sample_text.strip():
        return ","

    # Count occurrences in the first few non-empty lines
    lines = [line for line in sample_text.splitlines() if line.strip()][:10]
    if not lines:
        return ","

    counts: dict[str, int] = {d: 0 for d in SUPPORTED_DELIMITERS}
    for line in lines:
        for d in SUPPORTED_DELIMITERS:
            counts[d] += line.count(d)

    best_delimiter = max(counts, key=counts.get)  # type: ignore[arg-type]
    if counts[best_delimiter] > 0:
        return best_delimiter

    return ","


def decode_bytes(file_bytes: bytes) -> tuple[str, str]:
    """Decode raw bytes to text, returning ``(text, encoding_used)``."""
    for enc in ENCODING_FALLBACKS:
        try:
            return file_bytes.decode(enc), enc
        except UnicodeDecodeError:
            continue
    # Latin-1 with replacement: lossy but never raises.
    return file_bytes.decode("latin-1", errors="replace"), "latin-1"


class DelimitedLoader:
    """Reads comma/semicolon/tab/pipe separated text into raw string cells."""

    name = FORMAT_NAME

    def load(self, file_bytes: bytes, filename: str, options: LoadOptions) -> LoadResult:
        """Parse delimited text into a dataframe of raw strings."""
        warnings: list[str] = []

        text, encoding = decode_bytes(file_bytes)
        if encoding != "utf-8":
            warnings.append(f"File was decoded using '{encoding}' encoding fallback.")

        delimiter = detect_delimiter(text[:4096])

        # Read all columns as raw strings to avoid losing formatting before cleaning
        df = pd.read_csv(
            io.StringIO(text),
            sep=delimiter,
            dtype=str,
            keep_default_na=False,
            engine="python",
            on_bad_lines="skip",
        )

        return finish(
            df,
            fmt=self.name,
            warnings=warnings,
            encoding=encoding,
            delimiter=delimiter,
        )


delimited_loader = DelimitedLoader()
