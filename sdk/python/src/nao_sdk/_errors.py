"""Error types raised by the nao SDK."""

from __future__ import annotations

from typing import Optional


class NaoError(Exception):
    """Base class for all errors raised by the SDK."""


class NaoAPIError(NaoError):
    """Raised when the nao API returns a non-2xx response."""

    def __init__(self, message: str, status_code: Optional[int] = None):
        super().__init__(message)
        self.status_code = status_code
        self.message = message
