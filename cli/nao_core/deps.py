"""Dependency checking utilities for optional nao-core extras.

nao-core uses optional dependency groups (extras) so users only install
what they need.  The helpers here produce clear, actionable error messages
when a required package is missing.
"""

from __future__ import annotations

import importlib


class MissingDependencyError(ImportError):
    """Raised when an optional dependency is not installed."""

    def __init__(self, package: str, extra: str, purpose: str = ""):
        self.package = package
        self.extra = extra
        pip_cmd = f"pip install 'nao-core[{extra}]'"
        uv_cmd = f"uv pip install 'nao-core[{extra}]'"
        message = (
            f"The '{package}' package is required{f' {purpose}' if purpose else ''}.\n"
            f"Install it with:\n"
            f"  {pip_cmd}\n"
            f"or:\n"
            f"  {uv_cmd}"
        )
        super().__init__(message)


def require_dependency(package: str, extra: str, purpose: str = "") -> None:
    """Verify that *package* is importable, raising a helpful error if not."""
    try:
        importlib.import_module(package)
    except ImportError:
        raise MissingDependencyError(package, extra, purpose) from None


def require_database_backend(backend: str) -> None:
    """Verify that the ibis backend for *backend* is importable."""
    extra = _BACKEND_EXTRA.get(backend, backend)
    try:
        importlib.import_module(f"ibis.backends.{backend}")
    except (ImportError, ModuleNotFoundError):
        raise MissingDependencyError(
            f"ibis-framework[{backend}]",
            extra,
            f"to connect to {backend} databases",
        ) from None


_BACKEND_EXTRA: dict[str, str] = {
    "postgres": "postgres",
    "bigquery": "bigquery",
    "snowflake": "snowflake",
    "duckdb": "duckdb",
    "clickhouse": "clickhouse",
    "databricks": "databricks",
    "mssql": "mssql",
    "athena": "athena",
    "trino": "trino",
}
