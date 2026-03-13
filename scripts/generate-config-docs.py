#!/usr/bin/env python3
"""Generate nao_config.yaml reference docs from Pydantic models.

Outputs:
  - config-reference.md  — Markdown documentation
  - config-schema.json   — Raw JSON Schema

Usage:
  uv run scripts/generate-config-docs.py [output_dir]
  uv run scripts/generate-config-docs.py --push   # push to getnao/nao-docs
"""

from __future__ import annotations

import argparse
import json
import subprocess
import sys
import tempfile
from pathlib import Path
from typing import Any

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "cli"))

from nao_core.config import NaoConfig  # noqa: E402
from nao_core.config.databases import (  # noqa: E402
    AthenaConfig,
    BigQueryConfig,
    DatabricksConfig,
    DuckDBConfig,
    MssqlConfig,
    PostgresConfig,
    RedshiftConfig,
    SnowflakeConfig,
    TrinoConfig,
)
from nao_core.config.databases.base import DatabaseAccessor, DatabaseConfig  # noqa: E402
from nao_core.config.databases.redshift import RedshiftSSHTunnelConfig  # noqa: E402
from nao_core.config.llm import DEFAULT_ANNOTATION_MODELS, LLMConfig, LLMProvider  # noqa: E402
from nao_core.config.mcp import McpConfig  # noqa: E402
from nao_core.config.notion import NotionConfig  # noqa: E402
from nao_core.config.repos.base import RepoConfig  # noqa: E402
from nao_core.config.skills import SkillsConfig  # noqa: E402
from nao_core.config.slack import SlackConfig  # noqa: E402

DOCS_REPO = "getnao/nao-docs"
DOCS_FILE_PATH = "pages/configuration-reference.mdx"


# ---------------------------------------------------------------------------
# Field extraction helpers
# ---------------------------------------------------------------------------


def _type_label(annotation: Any) -> str:
    """Human-readable type string from a Python annotation."""
    import types
    from enum import Enum
    from typing import Literal, Union, get_args, get_origin

    origin = get_origin(annotation)

    if origin is Union or origin is types.UnionType:
        args = [a for a in get_args(annotation) if a is not type(None)]
        if len(args) == 1:
            return _type_label(args[0])
        return ", ".join(_type_label(a) for a in args)

    if origin is Literal:
        vals = get_args(annotation)
        if len(vals) == 1:
            return f'`"{vals[0]}"`'
        return ", ".join(f'`"{v}"`' for v in vals)

    if origin is list:
        inner = get_args(annotation)
        if inner:
            return f"{_type_label(inner[0])}[]"
        return "list"

    if isinstance(annotation, type) and issubclass(annotation, Enum):
        return ", ".join(f'`"{m.value}"`' for m in annotation)

    simple = {
        str: "string",
        int: "integer",
        float: "number",
        bool: "boolean",
        dict: "object",
    }
    if annotation in simple:
        return simple[annotation]

    if isinstance(annotation, type):
        return f"[{annotation.__name__}](#{annotation.__name__.lower()})"

    return str(annotation)


def _default_label(field_info: Any) -> str:
    """Render the default value for a field."""
    if field_info.default_factory is not None:
        try:
            val = field_info.default_factory()
            if isinstance(val, list):
                if not val:
                    return "`[]`"
                rendered = [v.value if hasattr(v, "value") else v for v in val]
                return f"`{json.dumps(rendered)}`"
            return f"`{json.dumps(val)}`"
        except Exception:
            return "—"

    if field_info.default is None:
        return "`null`"
    if field_info.is_required():
        return "—"
    return f"`{json.dumps(field_info.default)}`"


def _fields_table(
    model: type,
    *,
    exclude: set[str] | None = None,
    override_type: dict[str, str] | None = None,
    override_required: dict[str, bool] | None = None,
) -> str:
    """Build a Markdown table of fields for a Pydantic model."""
    exclude = exclude or set()
    override_type = override_type or {}
    override_required = override_required or {}
    lines = ["| Property | Type | Required | Default | Description |"]
    lines.append("| --- | --- | --- | --- | --- |")

    for name, fi in model.model_fields.items():
        if name in exclude:
            continue
        type_str = override_type.get(name) or _type_label(fi.annotation)
        required = override_required.get(name, fi.is_required())
        req_str = "**Yes**" if required else "No"
        default = "—" if required else _default_label(fi)
        desc = fi.description or "—"
        lines.append(f"| `{name}` | {type_str} | {req_str} | {default} | {desc} |")

    return "\n".join(lines)


# ---------------------------------------------------------------------------
# Markdown generation
# ---------------------------------------------------------------------------

DATABASE_CONFIGS: list[tuple[str, str, type[DatabaseConfig]]] = [
    ("PostgreSQL", "postgres", PostgresConfig),
    ("Snowflake", "snowflake", SnowflakeConfig),
    ("BigQuery", "bigquery", BigQueryConfig),
    ("DuckDB", "duckdb", DuckDBConfig),
    ("Databricks", "databricks", DatabricksConfig),
    ("Microsoft SQL Server", "mssql", MssqlConfig),
    ("Amazon Redshift", "redshift", RedshiftConfig),
    ("Trino", "trino", TrinoConfig),
    ("Amazon Athena", "athena", AthenaConfig),
]

BASE_DB_FIELDS = {"type", "name", "include", "exclude", "accessors"}


def _section_databases() -> str:
    parts: list[str] = []
    parts.append("## Databases\n")
    parts.append("All database configurations share these common fields:\n")
    parts.append(
        _fields_table(
            DatabaseConfig,
            exclude=set(),
            override_type={"type": "string — see below", "accessors": "string[]"},
        )
    )
    parts.append("")
    parts.append(f"**Accessor values:** {', '.join(f'`{a.value}`' for a in DatabaseAccessor)}\n")
    parts.append(
        "Patterns in `include` / `exclude` use glob syntax against `schema.table` "
        "(e.g. `prod_*.*`, `analytics.dim_*`).\n"
    )

    for label, type_val, config_cls in DATABASE_CONFIGS:
        parts.append(f"### {label} (`type: {type_val}`)\n")
        parts.append(_fields_table(config_cls, exclude=BASE_DB_FIELDS))
        parts.append("")

    parts.append("### RedshiftSSHTunnelConfig\n")
    parts.append("Nested under `ssh_tunnel` in a Redshift database entry.\n")
    parts.append(_fields_table(RedshiftSSHTunnelConfig))
    parts.append("")

    return "\n".join(parts)


def _section_llm() -> str:
    parts: list[str] = []
    parts.append("## LLM\n")
    parts.append(_fields_table(LLMConfig, override_type={"provider": ", ".join(f'`"{p.value}"`' for p in LLMProvider)}))
    parts.append("")

    parts.append("### Provider authentication\n")
    parts.append("| Provider | Env variable | API key | Base URL env |")
    parts.append("| --- | --- | --- | --- |")
    from nao_core.config.llm import PROVIDER_AUTH

    for provider, auth in PROVIDER_AUTH.items():
        base_url = f"`{auth.base_url_env_var}`" if auth.base_url_env_var else "—"
        parts.append(f"| `{provider.value}` | `{auth.env_var}` | {auth.api_key} | {base_url} |")
    parts.append("")

    parts.append("### Default annotation models\n")
    parts.append("Used for `ai_summary` generation when `annotation_model` is not set.\n")
    parts.append("| Provider | Default model |")
    parts.append("| --- | --- |")
    for provider, model in DEFAULT_ANNOTATION_MODELS.items():
        parts.append(f"| `{provider.value}` | `{model}` |")
    parts.append("")
    return "\n".join(parts)


def _section_repos() -> str:
    parts: list[str] = []
    parts.append("## Repos\n")
    parts.append(_fields_table(RepoConfig))
    parts.append("")
    return "\n".join(parts)


def _section_notion() -> str:
    parts: list[str] = []
    parts.append("## Notion\n")
    parts.append(_fields_table(NotionConfig))
    parts.append("")
    return "\n".join(parts)


def _section_slack() -> str:
    parts: list[str] = []
    parts.append("## Slack\n")
    parts.append(_fields_table(SlackConfig))
    parts.append("")
    return "\n".join(parts)


def _section_mcp() -> str:
    parts: list[str] = []
    parts.append("## MCP\n")
    parts.append(_fields_table(McpConfig))
    parts.append("")
    return "\n".join(parts)


def _section_skills() -> str:
    parts: list[str] = []
    parts.append("## Skills\n")
    parts.append(_fields_table(SkillsConfig))
    parts.append("")
    return "\n".join(parts)


def _example_yaml() -> str:
    return """\
## Example

```yaml
project_name: my-project

databases:
  - type: postgres
    name: prod-db
    host: localhost
    port: 5432
    database: analytics
    user: ${{ env('DB_USER') }}
    password: ${{ env('DB_PASSWORD') }}
    include:
      - "public.*"
    exclude:
      - "public.tmp_*"
    accessors:
      - columns
      - description
      - preview
      - ai_summary

  - type: duckdb
    name: local
    path: ./warehouse.duckdb

repos:
  - name: dbt-models
    url: https://github.com/myorg/dbt-models.git
    branch: main

llm:
  provider: openai
  api_key: ${{ env('OPENAI_API_KEY') }}
  annotation_model: gpt-4.1-mini

notion:
  api_key: ${{ env('NOTION_API_KEY') }}
  pages:
    - https://notion.so/my-page-id

slack:
  bot_token: ${{ env('SLACK_BOT_TOKEN') }}
  signing_secret: ${{ env('SLACK_SIGNING_SECRET') }}

mcp:
  json_file_path: ./agent/mcps/mcp.json

skills:
  folder_path: ./agent/skills/
```
"""


def generate_markdown() -> str:
    parts: list[str] = []

    parts.append("# Configuration Reference\n")
    parts.append(
        "Complete reference for the `nao_config.yaml` file. "
        "This page is auto-generated from the Pydantic models in "
        "[`cli/nao_core/config/`](https://github.com/getnao/nao/tree/main/cli/nao_core/config).\n"
    )
    parts.append(
        "Values wrapped in `${{ env('VAR') }}` or `{{ env('VAR') }}` are resolved "
        "from environment variables at load time.\n"
    )

    # Top-level
    parts.append("## Top-level properties\n")
    parts.append(
        _fields_table(
            NaoConfig,
            override_type={
                "databases": "[DatabaseConfig[]](#databases)",
                "repos": "[RepoConfig[]](#repos)",
                "notion": "[NotionConfig](#notion)",
                "llm": "[LLMConfig](#llm)",
                "slack": "[SlackConfig](#slack)",
                "mcp": "[McpConfig](#mcp)",
                "skills": "[SkillsConfig](#skills)",
            },
        )
    )
    parts.append("")

    parts.append(_section_databases())
    parts.append(_section_llm())
    parts.append(_section_repos())
    parts.append(_section_notion())
    parts.append(_section_slack())
    parts.append(_section_mcp())
    parts.append(_section_skills())
    parts.append(_example_yaml())

    # JSON Schema appendix
    parts.append("## JSON Schema\n")
    parts.append(
        "The raw JSON Schema is available at "
        "[`config-schema.json`](https://github.com/getnao/nao-docs/blob/main/public/config-schema.json).\n"
    )

    return "\n".join(parts)


# ---------------------------------------------------------------------------
# Push to nao-docs
# ---------------------------------------------------------------------------


def _run(cmd: list[str], **kwargs: Any) -> subprocess.CompletedProcess[str]:
    """Run a subprocess, printing stderr on failure."""
    result = subprocess.run(cmd, capture_output=True, text=True, **kwargs)
    if result.returncode != 0:
        detail = result.stderr.strip() or result.stdout.strip()
        print(f"command failed: {' '.join(cmd)}", file=sys.stderr)
        if detail:
            print(detail, file=sys.stderr)
        sys.exit(result.returncode)
    return result


def push_to_docs_repo(md_content: str, schema_json: str) -> None:
    """Clone nao-docs, write files, commit, and push a branch."""
    import datetime

    branch = f"docs/config-ref-{datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%d-%H%M%S')}"

    with tempfile.TemporaryDirectory() as tmp:
        tmp_path = Path(tmp)

        _run(["gh", "repo", "clone", DOCS_REPO, str(tmp_path), "--", "--depth=1"])
        _run(["git", "checkout", "-b", branch], cwd=tmp_path)

        docs_file = tmp_path / DOCS_FILE_PATH
        docs_file.parent.mkdir(parents=True, exist_ok=True)
        docs_file.write_text(md_content)

        schema_file = tmp_path / "public" / "config-schema.json"
        schema_file.parent.mkdir(parents=True, exist_ok=True)
        schema_file.write_text(schema_json)

        _run(["git", "add", "-A"], cwd=tmp_path)

        status = subprocess.run(
            ["git", "diff", "--cached", "--quiet"], cwd=tmp_path
        )
        if status.returncode == 0:
            print("Nothing to commit — docs are already up to date.")
            return

        _run(["git", "commit", "-m", "docs: update configuration reference"], cwd=tmp_path)
        _run(["git", "push", "-u", "origin", branch], cwd=tmp_path)

        result = _run(
            [
                "gh",
                "pr",
                "create",
                "--repo",
                DOCS_REPO,
                "--head",
                branch,
                "--title",
                "docs: update configuration reference",
                "--body",
                "Auto-generated from the Pydantic config models in `getnao/nao`.",
            ],
            cwd=tmp_path,
        )
        print(result.stdout.strip())


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------


def main() -> None:
    parser = argparse.ArgumentParser(description="Generate nao config reference docs")
    parser.add_argument("output_dir", nargs="?", default=".", help="Directory to write output files")
    parser.add_argument("--push", action="store_true", help=f"Push to {DOCS_REPO} via gh CLI")
    parser.add_argument("--json-schema", action="store_true", help="Only print JSON schema to stdout")
    args = parser.parse_args()

    schema = NaoConfig.model_json_schema()
    schema_json = json.dumps(schema, indent=2) + "\n"

    if args.json_schema:
        print(schema_json)
        return

    md_content = generate_markdown()

    if args.push:
        push_to_docs_repo(md_content, schema_json)
        return

    out = Path(args.output_dir)
    out.mkdir(parents=True, exist_ok=True)

    md_path = out / "config-reference.md"
    md_path.write_text(md_content)
    print(f"wrote {md_path}")

    schema_path = out / "config-schema.json"
    schema_path.write_text(schema_json)
    print(f"wrote {schema_path}")


if __name__ == "__main__":
    main()
