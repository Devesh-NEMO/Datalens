"""Spreadsheet loader for .xlsx, .xlsm and .xls.

Only cached cell values are read: macros are never executed and formulas are
never evaluated, because openpyxl/xlrd are handed ``data_only=True`` semantics
through pandas' read path and we never invoke the Office host at all.
"""

from __future__ import annotations

import io

import pandas as pd

from app.core.errors import PasswordProtectedError, UnprocessableDataError
from app.loaders import detect
from app.loaders.base import LoadOptions, LoadResult, finish

FORMAT_NAME = "excel"

#: Content kinds this loader legitimately claims.
CLAIMED_KINDS = frozenset(
    {detect.ZIP_OOXML, detect.ZIP_MACRO, detect.OLE2_PLAIN}
)


class ExcelLoader:
    """Reads .xlsx/.xlsm/.xls workbooks. Values only, never macros or formulas."""

    name = FORMAT_NAME

    def load(self, file_bytes: bytes, filename: str, options: LoadOptions) -> LoadResult:
        """Read one sheet from an Excel workbook into a dataframe of raw strings."""
        return _read_workbook(file_bytes, filename, options)


def _read_workbook(file_bytes: bytes, filename: str, options: LoadOptions) -> LoadResult:
    kind = detect.sniff(file_bytes)
    if kind == detect.OLE2_ENCRYPTED:
        raise PasswordProtectedError(
            message=(
                "This file is password protected. Datalens reads cached cell "
                "values and cannot open an encrypted workbook."
            ),
            hint="Remove the password in Excel and upload the file again.",
        )

    warnings: list[str] = []
    if kind == detect.ZIP_MACRO:
        warnings.append(
            "This workbook contains macros. Macros were ignored; only cell values were read."
        )

    buffer = io.BytesIO(file_bytes)
    try:
        excel_file = pd.ExcelFile(buffer)
    except Exception as exc:  # noqa: BLE001 - any engine failure is a 422 for the client
        raise UnprocessableDataError(
            message=f"Could not open the Excel workbook: {exc!s}",
            hint="Ensure the workbook is a valid .xlsx or .xls file and is not corrupted.",
        ) from exc

    sheet_names = list(excel_file.sheet_names)
    if not sheet_names:
        raise UnprocessableDataError(
            message="Excel file contains no readable sheets.",
            hint="Ensure the workbook contains at least one sheet with data.",
        )

    if options.sheet is not None:
        if options.sheet not in sheet_names:
            raise UnprocessableDataError(
                message=f"Sheet '{options.sheet}' not found in Excel workbook.",
                hint=f"Available sheets: {', '.join(sheet_names)}",
            )
        resolved_sheet = options.sheet
    else:
        resolved_sheet = sheet_names[0]
        if len(sheet_names) > 1:
            warnings.append(
                f"Read sheet '{resolved_sheet}'. "
                f"{len(sheet_names)} sheets found: {', '.join(sheet_names)}."
            )

    try:
        df = pd.read_excel(
            excel_file,
            sheet_name=resolved_sheet,
            dtype=str,
            keep_default_na=False,
        )
    except Exception as exc:  # noqa: BLE001 - surface a 422, never a traceback
        raise UnprocessableDataError(
            message=f"Could not read sheet '{resolved_sheet}': {exc!s}",
            hint="Ensure the sheet contains tabular data with a header row.",
        ) from exc

    return finish(
        df,
        fmt=FORMAT_NAME,
        warnings=warnings,
        sheet_name=resolved_sheet,
        sheet_names=sheet_names,
    )


excel_loader = ExcelLoader()
