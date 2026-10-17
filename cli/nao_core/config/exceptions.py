"""Shared exceptions for nao_core."""


class InitError(Exception):
    """Base exception for init command errors."""

    pass


class ResultTooLargeError(Exception):
    """Raised when a SQL result exceeds the configured row or byte cap.

    The cap exists so one oversized query cannot OOM-kill the worker. The
    message is user-facing: it names the limit that was hit and tells the
    user how to narrow the query, so the agent can relay it unchanged.
    """

    pass
