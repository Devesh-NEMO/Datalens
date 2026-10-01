"""Unit tests for the loader layer: registry resolution, CSV, and Excel.

The CSV tests double as the regression suite for the refactor that moved the old
``app/services/loader.py`` behaviour into ``app/loaders/delimited_loader.py``.
"""

import io

import pandas as pd
import pytest

from app.config import settings
from app.core.errors import (
    FormatMismatchError,
    PayloadTooLargeError,
    UnprocessableDataError,
    UnsupportedFormatError,
)
from app.loaders import LoadOptions, load_file, normalize_columns
from app.loaders.delimited_loader import detect_delimiter
from app.loaders.detect import sniff


def _xlsx_bytes(sheets: dict[str, pd.DataFrame]) -> bytes:
    buffer = io.BytesIO()
    with pd.ExcelWriter(buffer, engine="openpyxl") as writer:
        for name, frame in sheets.items():
            frame.to_excel(writer, sheet_name=name, index=False)
    return buffer.getvalue()


# --- pure helpers ------------------------------------------------------------


def test_detect_delimiter() -> None:
    """Test delimiter detection on common delimited formats."""
    assert detect_delimiter("a,b,c\n1,2,3") == ","
    assert detect_delimiter("a;b;c\n1;2;3") == ";"
    assert detect_delimiter("a\tb\tc\n1\t2\t3") == "\t"
    assert detect_delimiter("a|b|c\n1|2|3") == "|"
    assert detect_delimiter("") == ","


def test_normalize_columns() -> None:
    """Test column name normalization and deduplication."""
    normalized = normalize_columns(["  Product ", "Product", "", None])
    assert normalized == ["Product", "Product_1", "Unnamed_3", "Unnamed_4"]


# --- content sniffing --------------------------------------------------------


def test_sniff_recognises_text() -> None:
    assert sniff(b"a,b\n1,2\n") == "text"


def test_sniff_recognises_xlsx() -> None:
    data = _xlsx_bytes({"Sheet1": pd.DataFrame({"a": [1]})})
    assert sniff(data) == "zip_ooxml"


def test_sniff_recognises_empty() -> None:
    assert sniff(b"") == "empty"


def test_sniff_survives_truncated_zip() -> None:
    """A corrupt zip header must not raise out of the sniffer."""
    assert sniff(b"PK\x03\x04" + b"\x00" * 8) == "zip_other"


# --- delimited (behaviour unchanged by the refactor) -------------------------


def test_load_csv_delimiters() -> None:
    """Test loading delimited files with comma, semicolon, tab, and pipe delimiters."""
    for delimiter in [",", ";", "\t", "|"]:
        text = f"item{delimiter}price\nLaptop{delimiter}1200\nMouse{delimiter}25\n"
        result = load_file(text.encode("utf-8"), "test.csv")
        assert result.metadata.rows == 2
        assert result.metadata.columns == 2
        assert list(result.df.columns) == ["item", "price"]
        assert result.metadata.delimiter == delimiter


def test_load_csv_encodings() -> None:
    """Test loading CSV files with utf-8, utf-8-sig, and latin-1 encodings."""
    content = "produit,prix\nCafé,5.50\n"

    assert load_file(content.encode("utf-8"), "sales.csv").metadata.rows == 1
    assert load_file(content.encode("utf-8-sig"), "sales.csv").metadata.rows == 1
    latin = load_file(content.encode("latin-1"), "sales.csv")
    assert latin.metadata.rows == 1
    assert latin.metadata.encoding == "latin-1"
    assert any("latin-1" in w for w in latin.warnings)


def test_load_tsv_extension() -> None:
    """.tsv is routed to the same delimited loader."""
    result = load_file(b"a\tb\n1\t2\n", "data.tsv")
    assert result.metadata.format == "delimited"
    assert result.metadata.delimiter == "\t"


# --- excel -------------------------------------------------------------------


def test_load_excel_in_memory() -> None:
    """Test loading Excel (.xlsx) file in memory."""
    excel_bytes = _xlsx_bytes({"SalesData": pd.DataFrame({"product": ["Desk", "Chair"],
                                                          "sales": [300, 150]})})

    result = load_file(excel_bytes, "report.xlsx")
    assert result.metadata.rows == 2
    assert result.metadata.sheet_name == "SalesData"
    assert result.metadata.sheet_names == ["SalesData"]

    named = load_file(excel_bytes, "report.xlsx", LoadOptions(sheet="SalesData"))
    assert named.metadata.rows == 2


def test_load_excel_lists_all_sheets_for_the_picker() -> None:
    """Multiple sheets are exposed in metadata so the frontend can offer a picker."""
    excel_bytes = _xlsx_bytes(
        {
            "First": pd.DataFrame({"product": ["Desk"], "sales": [300]}),
            "Second": pd.DataFrame({"product": ["Chair"], "sales": [150]}),
        }
    )
    result = load_file(excel_bytes, "report.xlsx")
    assert result.metadata.sheet_names == ["First", "Second"]
    assert result.metadata.sheet_name == "First"
    assert any("sheets found" in w for w in result.warnings)


def test_load_excel_second_sheet_when_requested() -> None:
    """The picker value selects a non-default sheet."""
    excel_bytes = _xlsx_bytes(
        {
            "First": pd.DataFrame({"product": ["Desk"], "sales": [300]}),
            "Second": pd.DataFrame({"product": ["Chair"], "sales": [150]}),
        }
    )
    result = load_file(excel_bytes, "report.xlsx", LoadOptions(sheet="Second"))
    assert result.metadata.sheet_name == "Second"
    assert result.df["product"].tolist() == ["Chair"]


def test_load_excel_invalid_sheet() -> None:
    """Test loading non-existent sheet raises UnprocessableDataError."""
    excel_bytes = _xlsx_bytes({"Sheet1": pd.DataFrame({"product": ["Desk"], "sales": [300]})})

    with pytest.raises(UnprocessableDataError) as exc_info:
        load_file(excel_bytes, "report.xlsx", LoadOptions(sheet="NonExistentSheet"))
    assert "not found" in exc_info.value.message


# --- rejection paths ---------------------------------------------------------


def test_unsupported_file_type() -> None:
    """Test rejecting unsupported file extensions with code 'unsupported_format'."""
    for name in ("data.json", "data.pdf", "data.pkl", "data.docx", "data.png", "noext"):
        with pytest.raises(UnsupportedFormatError) as exc_info:
            load_file(b"some content", name)
        assert exc_info.value.code == "unsupported_format"
        assert ".csv" in exc_info.value.hint


def test_extension_content_mismatch() -> None:
    """A CSV that is really a zip must be rejected, not handed to the text parser."""
    excel_bytes = _xlsx_bytes({"Sheet1": pd.DataFrame({"a": [1]})})

    with pytest.raises(FormatMismatchError) as exc_info:
        load_file(excel_bytes, "disguised.csv")
    assert exc_info.value.code == "format_content_mismatch"
    assert "xlsx" in exc_info.value.message.lower()


def test_excel_renamed_to_excel_extension_is_fine() -> None:
    """Content that matches the claimed extension is accepted."""
    excel_bytes = _xlsx_bytes({"Sheet1": pd.DataFrame({"a": [1]})})
    assert load_file(excel_bytes, "report.xlsx").metadata.format == "excel"


def test_empty_file() -> None:
    """Test empty file raises UnprocessableDataError."""
    with pytest.raises(UnprocessableDataError):
        load_file(b"", "data.csv")


def test_file_too_large(monkeypatch: pytest.MonkeyPatch) -> None:
    """Test file exceeding size limit raises PayloadTooLargeError."""
    monkeypatch.setattr(settings, "max_upload_mb", 1)
    large_bytes = b"a,b\n" + (b"1,2\n" * 600000)  # > 1MB
    with pytest.raises(PayloadTooLargeError) as exc_info:
        load_file(large_bytes, "data.csv")
    assert exc_info.value.code == "payload_too_large"


def test_max_rows_exceeded(monkeypatch: pytest.MonkeyPatch) -> None:
    """Test exceeding row count limit raises UnprocessableDataError."""
    monkeypatch.setattr(settings, "max_rows", 5)
    with pytest.raises(UnprocessableDataError) as exc_info:
        load_file(b"col1,col2\n1,a\n2,b\n3,c\n4,d\n5,e\n6,f\n", "data.csv")
    assert "rows" in exc_info.value.message


def test_max_columns_exceeded(monkeypatch: pytest.MonkeyPatch) -> None:
    """Test exceeding column count limit raises UnprocessableDataError."""
    monkeypatch.setattr(settings, "max_columns", 3)
    with pytest.raises(UnprocessableDataError) as exc_info:
        load_file(b"c1,c2,c3,c4\n1,2,3,4\n", "data.csv")
    assert "columns" in exc_info.value.message
