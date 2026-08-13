"""Print the resolved `nao_config.yaml` for the current project.

Redacts well-known sensitive fields by default. Honours `--format yaml|json`
and `--show-secrets` for local debugging.
"""

from __future__ import annotations

import json
import sys
from typing import Annotated, Any, Literal

import yaml
from cyclopts import Parameter

from nao_core.config import NaoConfig, NaoConfigError, resolve_project_path
from nao_core.tracking import track_command
from nao_core.ui import UI

# Field-name patterns treated as secret. Matched case-insensitively against
# the leaf name, plus a suffix check so `my_api_key`, `gcpAccessToken`,
# `dbPassword` all land.
_SENSITIVE_EXACT = {
    "api_key",
    "access_key",
    "secret_key",
    "password",
    "token",
    "service_account_json",
    "key_file",
    "private_key",
    "client_secret",
    "bearer_token",
    "auth_token",
    "session_token",
    "aws_access_key_id",
    "aws_secret_access_key",
    "motherduck_token",
}
_SENSITIVE_SUFFIXES = ("_key", "_token", "_password", "_secret", "password", "secret")

REDACTED = "***"


def _is_sensitive(name: str) -> bool:
    lowered = name.lower()
    if lowered in _SENSITIVE_EXACT:
        return True
    return any(suffix in lowered for suffix in _SENSITIVE_SUFFIXES)


def _redact(value: Any) -> Any:
    """Replace sensitive leaves inside an already-dumped structure."""
    if isinstance(value, dict):
        return {key: (_redact(item) if not _is_sensitive(key) else REDACTED) for key, item in value.items()}
    if isinstance(value, list):
        return [_redact(item) for item in value]
    return value


def _dump(config: NaoConfig) -> dict[str, Any]:
    """Serialise the config to a JSON-safe dict.

    Mirrors the order in `NaoConfig.save` (project_name, then top-level blocks)
    and uses the same `mode="json"`, `by_alias=True`, `exclude_none=True`
    settings so what `show` prints round-trips with what `init` writes.
    """
    return config.model_dump(mode="json", by_alias=True, exclude_none=True)


def _format_yaml(data: dict[str, Any]) -> str:
    return yaml.safe_dump(data, default_flow_style=False, sort_keys=False, allow_unicode=True)


def _format_json(data: dict[str, Any]) -> str:
    return json.dumps(data, indent=2, sort_keys=False, ensure_ascii=False)


@track_command("config show")
def show(
    format: Annotated[Literal["yaml", "json"], Parameter(name=["--format"])] = "yaml",
    show_secrets: Annotated[bool, Parameter(name=["--show-secrets"])] = False,
) -> None:
    """Print the resolved configuration for the current project.

    Loads `nao_config.yaml` from the current directory, resolves every
    `{{ env(...) }}` / `{{ aws(...) }}` / `{{ k8s(...) }}` secret reference,
    then prints the result. Sensitive fields (`api_key`, `*_token`,
    `*_password`, `*_secret`, plus a small set of well-known names) are
    replaced by `***` unless `--show-secrets` is passed.

    Parameters
    ----------
    format :
        Output format. `yaml` (default) or `json`.
    show_secrets :
        Print resolved secret values instead of `***`. Prints a one-line
        warning to stderr; intended for local debugging only.
    """
    project_path = resolve_project_path()
    config_file = project_path / "nao_config.yaml"
    if not config_file.exists():
        UI.error(f"No nao_config.yaml found in {project_path}")
        raise SystemExit(1)

    try:
        config = NaoConfig.try_load(project_path, raise_on_error=True)
    except NaoConfigError as error:
        UI.error(str(error))
        raise SystemExit(1) from error

    if config is None:
        UI.error(f"Failed to load {config_file}")
        raise SystemExit(1)

    data = _dump(config)
    if not show_secrets:
        data = _redact(data)
    else:
        print(
            "warning: --show-secrets prints resolved secret values; do not share the output",
            file=sys.stderr,
        )

    payload = _format_yaml(data) if format == "yaml" else _format_json(data)
    # Use plain print for the final emit: Rich's console would re-wrap long
    # YAML / JSON lines, which would break naive `| wc -l` and diff tooling.
    print(payload, end="" if payload.endswith("\n") else "\n")
