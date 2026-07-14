"""Dependency checking utilities for optional nao-core extras.

nao-core uses optional dependency groups (extras) so users only install
what they need.  The helpers here produce clear, actionable error messages
when a required package is missing.
"""

from __future__ import annotations

import importlib
from typing import TYPE_CHECKING, Any

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
    "starrocks": ["mysql.connector"],
    # LLM providers
    "openai": ["openai"],
    "anthropic": ["anthropic"],
    "mistral": ["mistralai"],
    "gemini": ["google.genai"],
    "ollama": ["ollama"],
    # Integrations
    "notion": ["notion_client", "notion2md"],
    # Secret resolution backends
    "aws-secrets": ["boto3", "glom"],
    "k8s-secrets": ["kubernetes"],
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


def require_database_backend(backend: str, *, extra: str | None = None, database_type: str | None = None) -> None:
    """Verify that the ibis backend for *backend* is importable."""
    install_extra = extra or _PROVIDER_ALIASES.get(backend, backend)
    display_type = database_type or backend
    try:
        importlib.import_module(f"ibis.backends.{backend}")
    except (ImportError, ModuleNotFoundError):
        raise MissingDependencyError(
            f"ibis-framework[{backend}]",
            install_extra,
            f"to connect to {display_type} databases",
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


def ensure_extras_installed(extras: list[str], *, assume_yes: bool = False) -> bool:
    """Install missing extras, prompting first unless *assume_yes*.

    Returns True when the extras are ready (nothing missing or install
    succeeded), False when installation was skipped or failed.
    """
    if not extras:
        return True

    from nao_core.ui import UI, ask_confirm

    extras_label = ", ".join(extras)
    UI.title("Installing provider dependencies")
    UI.print(f"[dim]Extras: {extras_label}[/dim]\n")

    should_install = assume_yes or ask_confirm("Install the required provider dependencies now?", default=True)
    if not should_install:
        extras_str = ",".join(extras)
        UI.print()
        UI.warn("Skipped dependency installation.")
        UI.print(f"You can install them later with: [bold cyan]pip install 'nao-core[{extras_str}]'[/bold cyan]")
        return False

    UI.print()
    return _install_with_progress(extras)


def get_missing_extras_for_databases(databases: list[Any]) -> list[str]:
    """Return the extras needed by the given databases that are not installed yet."""
    missing: list[str] = []
    seen: set[str] = set()

    for db in databases:
        extra = _resolve_extra(db.type)
        if extra and extra not in seen and not _is_extra_installed(extra):
            missing.append(extra)
            seen.add(extra)

    return missing


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


def _install_with_progress(extras: list[str]) -> bool:
    """Run the extras install with a Rich spinner. Returns True on success."""
    from rich.console import Console
    from rich.status import Status

    from nao_core.ui import UI

    console = Console()

    with Status("[bold cyan]Installing dependencies…[/bold cyan]", console=console, spinner="dots"):
        success = install_extras(extras)

    if success:
        UI.success("Dependencies installed successfully.")
        return True

    extras_str = ",".join(extras)
    UI.error("Automatic installation failed.")
    UI.print(f"Install manually with: [bold cyan]pip install 'nao-core[{extras_str}]'[/bold cyan]")
    return False


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
