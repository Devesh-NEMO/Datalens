"""Custom application exceptions and the single error shape the API speaks.

Every failure the client can see is rendered as::

    {"error": {"code": "...", "message": "...", "hint": "..."}}

Stack traces are logged server-side and never serialised into a response body.
"""

from __future__ import annotations

import logging

from fastapi import Request, status
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException as StarletteHTTPException

logger = logging.getLogger("data_analyzer.errors")


class AppException(Exception):
    """Base application exception with structured error details."""

    def __init__(
        self,
        message: str,
        code: str = "application_error",
        hint: str | None = None,
        status_code: int = status.HTTP_400_BAD_REQUEST,
    ) -> None:
        super().__init__(message)
        self.message = message
        self.code = code
        self.hint = hint or "Please check your request and try again."
        self.status_code = status_code


class UnsupportedFormatError(AppException):
    """Raised when a file's extension is not one Datalens knows how to read."""

    def __init__(
        self,
        message: str = "Unsupported file format.",
        hint: str = "Export your data as CSV or Excel and try again.",
        supported: str | None = None,
    ) -> None:
        super().__init__(
            message=message,
            code="unsupported_format",
            hint=hint,
            status_code=status.HTTP_415_UNSUPPORTED_MEDIA_TYPE,
        )
        if supported:
            self.supported = supported


class FormatMismatchError(AppException):
    """Raised when a file's extension disagrees with what its bytes actually are."""

    def __init__(
        self,
        message: str,
        hint: str = "Rename the file to match its real contents, or re-export it.",
    ) -> None:
        super().__init__(
            message=message,
            code="format_content_mismatch",
            hint=hint,
            status_code=status.HTTP_415_UNSUPPORTED_MEDIA_TYPE,
        )


class PasswordProtectedError(AppException):
    """Raised for spreadsheets or workbooks encrypted with an open password."""

    def __init__(
        self,
        message: str = "This file is password protected.",
        hint: str = "Remove the password and try again.",
    ) -> None:
        super().__init__(
            message=message,
            code="password_protected",
            hint=hint,
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
        )


class InvalidArchiveError(AppException):
    """Raised for archives that are nested, ambiguous, or bomb-shaped."""

    def __init__(
        self,
        message: str,
        hint: str = "Upload a plain data file rather than a compressed archive.",
    ) -> None:
        super().__init__(
            message=message,
            code="invalid_archive",
            hint=hint,
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
        )


class PayloadTooLargeError(AppException):
    """Raised when the uploaded file exceeds the maximum allowed size."""

    def __init__(
        self,
        message: str = "File size exceeds the allowed limit.",
        hint: str = "Please reduce the file size and try again.",
    ) -> None:
        super().__init__(
            message=message,
            code="payload_too_large",
            hint=hint,
            status_code=status.HTTP_413_CONTENT_TOO_LARGE,
        )


class UnprocessableDataError(AppException):
    """Raised when data violates constraints (row count, missing columns, etc.)."""

    def __init__(
        self,
        message: str,
        hint: str = "Please check your data format and column requirements.",
    ) -> None:
        super().__init__(
            message=message,
            code="unprocessable_entity",
            hint=hint,
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
        )


def format_error_response(code: str, message: str, hint: str, status_code: int) -> JSONResponse:
    """Create a standardized error response."""
    return JSONResponse(
        status_code=status_code,
        content={
            "error": {
                "code": code,
                "message": message,
                "hint": hint,
            }
        },
    )


async def app_exception_handler(request: Request, exc: AppException) -> JSONResponse:
    """Handle custom application exceptions."""
    logger.warning("AppException on %s: %s (code=%s)", request.url.path, exc.message, exc.code)
    return format_error_response(
        code=exc.code,
        message=exc.message,
        hint=exc.hint,
        status_code=exc.status_code,
    )


async def http_exception_handler(
    request: Request,
    exc: StarletteHTTPException,
) -> JSONResponse:
    """Handle standard Starlette/FastAPI HTTP exceptions."""
    logger.warning(
        "HTTPException on %s: %s (status=%d)",
        request.url.path,
        exc.detail,
        exc.status_code,
    )
    code = f"http_{exc.status_code}"
    hint = "Please check your request."
    if exc.status_code == status.HTTP_404_NOT_FOUND:
        code = "not_found"
        hint = "The requested endpoint does not exist. Refer to /docs for available endpoints."
    elif exc.status_code == status.HTTP_405_METHOD_ALLOWED:
        code = "method_not_allowed"
        hint = "Check the allowed HTTP methods for this endpoint."

    return format_error_response(
        code=code,
        message=str(exc.detail),
        hint=hint,
        status_code=exc.status_code,
    )


async def validation_exception_handler(
    request: Request,
    exc: RequestValidationError,
) -> JSONResponse:
    """Handle request validation errors from Pydantic."""
    logger.warning("Validation error on %s: %s", request.url.path, exc.errors())
    errors = exc.errors()
    first_error = errors[0] if errors else {}
    loc = " -> ".join(str(item) for item in first_error.get("loc", []))
    msg = first_error.get("msg", "Invalid parameter")
    full_message = f"Validation failed at '{loc}': {msg}" if loc else f"Validation failed: {msg}"

    return format_error_response(
        code="validation_error",
        message=full_message,
        hint="Please verify request headers, query parameters, or form body fields.",
        status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
    )


async def generic_exception_handler(request: Request, exc: Exception) -> JSONResponse:
    """Catch-all exception handler to prevent leaking stack traces."""
    logger.exception("Unhandled server error processing request to %s: %s", request.url.path, exc)
    return format_error_response(
        code="internal_error",
        message="An unexpected server error occurred while processing your request.",
        hint="Please check server logs or contact support if the issue persists.",
        status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
    )
