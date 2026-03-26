"""Dependency checking utilities for optional nao-core extras.

nao-core uses optional dependency groups (extras) so users only install
what they need.  The helpers here produce clear, actionable error messages
when a required package is missing.
"""

from __future__ import annotations

import importlib
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from nao_core.config.base import NaoConfig


# ---------------------------------------------------------------------------
# Single registry: extra name → modules that must be importable
# ---------------------------------------------------------------------------

_EXTRAS: dict[str, list[str]] = {
    # Database backends
    "postgres": ["ibis.backends.postgres"],
    "bigquery": ["ibis.backends.bigquery"],
    "snowflake": ["ibis.backends.snowflake"],
    "duckdb": ["ibis.backends.duckdb"],
    "clickhouse": ["ibis.backends.clickhouse"],
    "databricks": ["ibis.backends.databricks"],
    "mysql": ["ibis.backends.mysql"],
    "mssql": ["ibis.backends.mssql"],
    "athena": ["ibis.backends.athena"],
    "trino": ["ibis.backends.trino"],
    "redshift": ["ibis.backends.postgres", "sshtunnel"],
    "fabric": ["ibis.backends.mssql", "azure.identity"],
    # LLM providers
    "openai": ["openai"],
    "anthropic": ["anthropic"],
    "mistral": ["mistralai"],
    "gemini": ["google.genai"],
    "ollama": ["ollama"],
    # Integrations
    "notion": ["notion_client", "notion2md"],
}

# Providers whose extra name differs from their config value.
_PROVIDER_ALIASES: dict[str, str] = {
    "openrouter": "openai",
    "vertex": "gemini",
}


# ---------------------------------------------------------------------------
# Public helpers
# ---------------------------------------------------------------------------


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
    extra = _PROVIDER_ALIASES.get(backend, backend)
    try:
        importlib.import_module(f"ibis.backends.{backend}")
    except (ImportError, ModuleNotFoundError):
        raise MissingDependencyError(
            f"ibis-framework[{backend}]",
            extra,
            f"to connect to {backend} databases",
        ) from None


def get_required_extras(config: NaoConfig) -> list[str]:
    """Return the list of extras needed for a given config."""
    extras: list[str] = []
    seen: set[str] = set()

    for db in config.databases:
        extra = _resolve_extra(db.type)
        if extra and extra not in seen:
            extras.append(extra)
            seen.add(extra)

    if config.llm:
        extra = _resolve_extra(config.llm.provider.value)
        if extra and extra not in seen:
            extras.append(extra)
            seen.add(extra)

    if config.notion and "notion" not in seen:
        extras.append("notion")
        seen.add("notion")

    return extras


def get_missing_extras(config: NaoConfig) -> list[str]:
    """Return the list of extras that are needed but not yet installed."""
    return [extra for extra in get_required_extras(config) if not _is_extra_installed(extra)]


def get_install_command(config: NaoConfig) -> str | None:
    """Return the pip install command for missing extras, or None if everything is installed."""
    missing = get_missing_extras(config)
    if not missing:
        return None

    extras_str = ",".join(missing)
    return f"pip install 'nao-core[{extras_str}]'"


def install_extras(extras: list[str]) -> bool:
    """Install the given nao-core extras using pip or uv.

    Returns True if the install succeeded, False otherwise.
    """
    import shutil
    import subprocess
    import sys

    extras_str = ",".join(extras)
    spec = f"nao-core[{extras_str}]"

    uv_path = shutil.which("uv")
    if uv_path:
        cmd = [uv_path, "pip", "install", spec]
    else:
        cmd = [sys.executable, "-m", "pip", "install", spec]

    try:
        result = subprocess.run(cmd, capture_output=True, text=True, timeout=300)
        if result.returncode == 0:
            importlib.invalidate_caches()
            return True
        return False
    except (subprocess.TimeoutExpired, FileNotFoundError, OSError):
        return False


# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------


def _resolve_extra(provider_or_type: str) -> str | None:
    """Map a config provider/database type to its extra name."""
    name = _PROVIDER_ALIASES.get(provider_or_type, provider_or_type)
    return name if name in _EXTRAS else None


def _is_extra_installed(extra: str) -> bool:
    """Check if every module required by *extra* is importable."""
    for module in _EXTRAS.get(extra, []):
        try:
            importlib.import_module(module)
        except (ImportError, ModuleNotFoundError):
            return False
    return True
