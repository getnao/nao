from __future__ import annotations

import os
import re
import sys
from pathlib import Path
from typing import TYPE_CHECKING, Any, cast

import yaml
from pydantic import BaseModel, Field, ValidationError, model_validator
from rich.console import Console

if TYPE_CHECKING:
    from ibis import BaseBackend

from nao_core.ui import UI, ask_confirm, ask_select

from .confluence import ConfluenceConfig
from .databases import DATABASE_CONFIG_CLASSES, AnyDatabaseConfig, DatabaseTemplate, DatabaseType, parse_database_config
from .error_handler import format_all_validation_errors
from .llm import LLMConfig
from .mcp import McpConfig
from .notion import NotionConfig
from .repos import RepoConfig
from .secrets import process_secrets
from .skills import SkillsConfig
from .slack import SlackConfig
from .test import TestConfig


class NaoConfigError(Exception):
    """Raised when nao config loading fails."""

    pass


# Integration blocks a command can run without. Commands that only read part of the
# config (e.g. `nao sync` with the databases provider) can load with
# drop_invalid_optional_sections=True so an unresolvable block here — typically an
# unset env('...') secret — is ignored with a warning instead of failing the run.
OPTIONAL_SECTIONS = ("llm", "slack", "notion", "confluence", "mcp", "skills", "test")


class NaoConfig(BaseModel):
    """nao project configuration."""

    project_name: str = Field(description="The name of the nao project")
    threads: int | None = Field(default=None, ge=1, description="Default worker threads to use for sync")
    databases: list[AnyDatabaseConfig] = Field(default_factory=list, description="The databases to use")
    repos: list[RepoConfig] = Field(default_factory=list, description="The repositories to use")
    notion: NotionConfig | None = Field(default=None, description="The Notion configurations")
    confluence: ConfluenceConfig | None = Field(default=None, description="The Confluence configuration")
    llm: LLMConfig | None = Field(default=None, description="The LLM configuration")
    slack: SlackConfig | None = Field(default=None, description="The Slack configuration")
    mcp: McpConfig | None = Field(default=None, description="The MCP configuration")
    skills: SkillsConfig | None = Field(default=None, description="The Skills configuration")
    test: TestConfig | None = Field(default=None, description="The defaults used by `nao test`")

    _missing_secrets: dict[str, None] = {}

    @model_validator(mode="before")
    @classmethod
    def parse_databases(cls, data: dict) -> dict:
        """Parse database configs into their specific types."""
        if "databases" in data and isinstance(data["databases"], list):
            data["databases"] = [parse_database_config(db) if isinstance(db, dict) else db for db in data["databases"]]
        return data

    @classmethod
    def promptConfig(cls, project_name: str, existing: "NaoConfig | None" = None) -> "NaoConfig":
        """Interactively prompt the user for all nao configuration options.

        If existing config is provided, shows current items and allows adding more.
        """
        if existing:
            return cls._prompt_extend(existing)

        databases = cls._prompt_databases()
        llm = cls._prompt_llm()
        cls._apply_default_templates(databases, llm)
        repos = cls._prompt_repos()

        return cls(
            project_name=project_name,
            databases=databases,
            repos=repos,
            llm=llm,
        )

    @classmethod
    def _prompt_extend(cls, existing: "NaoConfig") -> "NaoConfig":
        """Extend an existing config by adding more items."""
        databases = list(existing.databases)
        repos = list(existing.repos)
        llm = existing.llm

        UI.title("Current Configuration")
        if databases:
            UI.print(f"  Databases: {', '.join(db.name for db in databases)}")
        if repos:
            UI.print(f"  Repos: {', '.join(r.name for r in repos)}")
        if llm:
            UI.print(f"  LLM: {', '.join(p.id for p in llm.providers)}")
        if existing.slack:
            UI.print("  Slack: configured")
        if existing.notion:
            UI.print("  Notion: configured")
        if existing.confluence:
            UI.print("  Confluence: configured")
        if existing.mcp:
            UI.print("  MCP: configured")
        if existing.skills:
            UI.print("  Skills: configured")
        if existing.test:
            UI.print("  Test: configured")
        UI.print()

        new_databases = cls._prompt_databases(has_existing=bool(existing.databases))
        repos.extend(cls._prompt_repos(has_existing=bool(existing.repos)))

        if not llm:
            llm = cls._prompt_llm()

        cls._apply_default_templates(new_databases, llm)
        databases.extend(new_databases)

        return existing.model_copy(update={"databases": databases, "repos": repos, "llm": llm})

    @staticmethod
    def _prompt_databases(has_existing: bool = False) -> list[AnyDatabaseConfig]:
        """Prompt for database configurations using questionary."""
        databases: list[AnyDatabaseConfig] = []

        prompt = "Add more database connections?" if has_existing else "Set up database connections?"
        if not ask_confirm(prompt, default=not has_existing):
            return databases

        UI.title("Database Configuration")

        db_type = ask_select("Select database type:", choices=DatabaseType.choices())

        config_class = cast(Any, DATABASE_CONFIG_CLASSES[DatabaseType(db_type)])
        db_config = cast(AnyDatabaseConfig, config_class.promptConfig())
        databases.append(db_config)
        UI.success(f"Added database: {db_config.name}")

        return databases

    @staticmethod
    def _prompt_repos(has_existing: bool = False) -> list[RepoConfig]:
        """Prompt for repository configurations using questionary."""
        repos: list[RepoConfig] = []

        prompt = "Add more git repositories?" if has_existing else "Set up git repositories?"
        if not ask_confirm(prompt, default=not has_existing):
            return repos

        repo_config = RepoConfig.promptConfig()
        repos.append(repo_config)
        UI.success(f"Added repository: {repo_config.name}")

        return repos

    @staticmethod
    def _prompt_llm() -> LLMConfig | None:
        """Prompt for LLM configuration."""
        if ask_confirm("Set up LLM configuration?", default=True):
            return LLMConfig.promptConfig(prompt_annotation_model=False)
        return None

    @staticmethod
    def _apply_default_templates(databases: list[AnyDatabaseConfig], llm: LLMConfig | None) -> None:
        """Apply the templates selected by interactive initialization."""
        for db in databases:
            db.templates = [DatabaseTemplate.COLUMNS, DatabaseTemplate.PREVIEW]
            if llm is not None:
                db.templates.append(DatabaseTemplate.AI_SUMMARY)

    def save(self, path: Path) -> None:
        """Save the configuration to a YAML file."""
        config_file = path / "nao_config.yaml"
        with config_file.open("w") as f:
            # Documentation Link
            f.write("# Configuration documentation:\n")
            f.write("# https://docs.getnao.io/nao-agent/context-builder/configuration#nao_config-yaml\n\n")

            yaml.dump(
                self.model_dump(mode="json", by_alias=True, exclude_none=True),
                f,
                default_flow_style=False,
                sort_keys=False,
                allow_unicode=True,
            )

    @classmethod
    def load(
        cls,
        path: Path,
        extra_env: dict[str, str] | None = None,
        drop_invalid_optional_sections: bool = False,
    ) -> "NaoConfig":
        """Load the configuration from a YAML file.

        With drop_invalid_optional_sections=True, a section from OPTIONAL_SECTIONS that
        fails validation is replaced by None and reported as a warning, so commands that
        do not use it can still run. Errors anywhere else fail the load as usual.
        """
        config_file = path / "nao_config.yaml"
        content = config_file.read_text()
        processed_content, missing = process_secrets(content, extra_env=extra_env)
        cls._missing_secrets = {k: None for k, v in missing.items() if v is None}
        data = yaml.safe_load(processed_content)
        cls._warn_on_legacy_llm(data)
        if not drop_invalid_optional_sections:
            return cls.model_validate(data)
        return cls._validate_dropping_optional_sections(data)

    @classmethod
    def _validate_dropping_optional_sections(cls, data: Any) -> "NaoConfig":
        try:
            return cls.model_validate(data)
        except ValidationError as e:
            if not isinstance(data, dict):
                raise

            dropped: dict[str, str] = {}
            for error in e.errors():
                section = error["loc"][0] if error["loc"] else None
                if not isinstance(section, str) or section not in OPTIONAL_SECTIONS:
                    raise
                dropped.setdefault(section, str(error["msg"]))

            config = cls.model_validate({**data, **{section: None for section in dropped}})
            for section, reason in dropped.items():
                hint = ""
                if cls._missing_secrets:
                    hint = f" (unset environment variables: {', '.join(cls._missing_secrets)})"
                UI.warn(
                    f"Ignoring invalid `{section}` config for this command: {reason}{hint}. "
                    f"Commands that use `{section}` will keep failing until it validates."
                )
            return config

    @staticmethod
    def _warn_on_legacy_llm(data: Any) -> None:
        """Warn when the `llm` block still declares a single inline provider."""
        if not isinstance(data, dict) or not LLMConfig.uses_legacy_shape(data.get("llm")):
            return

        UI.warn(
            "nao_config.yaml declares a single inline `llm` provider, which is deprecated. Move it "
            "under `llm.providers` to configure several providers, the models each one exposes and "
            "their costs. Run `nao migrate` to rewrite it automatically."
        )

    def get_connection(self, name: str) -> BaseBackend:
        """Get an Ibis connection by database name."""
        for db in self.databases:
            if db.name == name:
                return db.connect()
        raise ValueError(f"Database '{name}' not found in configuration")

    def get_all_connections(self) -> dict[str, BaseBackend]:
        """Get all Ibis connections as a dict keyed by name."""
        return {db.name: db.connect() for db in self.databases}

    @classmethod
    def try_load(
        cls,
        path: Path,
        *,
        exit_on_error: bool = False,
        raise_on_error: bool = False,
        extra_env: dict[str, str] | None = None,
        drop_invalid_optional_sections: bool = False,
    ) -> "NaoConfig | None":
        """Try to load config from path.

        Args:
            path: Directory containing nao_config.yaml.
            exit_on_error: If True, prints error message and calls sys.exit(1) on failure.
            raise_on_error: If True, raises NaoConfigError on failure.
            extra_env: Optional env vars that take precedence over os.environ during template resolution.
            drop_invalid_optional_sections: If True, an invalid OPTIONAL_SECTIONS block is
                nulled with a warning instead of failing the load (see `load`).
        Returns:
            NaoConfig if loaded successfully, None if failed and both flags are False.
        """

        config_file = path / "nao_config.yaml"

        def handle_error(message: str) -> None:
            if raise_on_error:
                raise NaoConfigError(message)
            if exit_on_error:
                console = Console()
                console.print(f"[bold red]✗[/bold red] {message}")
                sys.exit(1)

        if not config_file.exists():
            handle_error("No nao_config.yaml found in current directory")
            return None

        try:
            os.chdir(path)
            return cls.load(
                path,
                extra_env=extra_env,
                drop_invalid_optional_sections=drop_invalid_optional_sections,
            )
        except yaml.YAMLError as e:
            handle_error(f"Failed to load nao_config.yaml: Invalid YAML syntax: {e}")
            return None
        except ValidationError as e:
            # Build detailed error message with suggestions
            main_errors = format_all_validation_errors(e, cls)
            msg = f"Failed to load nao_config.yaml:\n  • {main_errors}"

            # Add warning about missing env vars if any
            if cls._missing_secrets:
                env_var_warnings = "\n  • ".join(
                    f"{k} (environment variable not set or empty)" for k in cls._missing_secrets.keys()
                )
                msg += f"\n\nWarning: Missing or empty environment variables:\n  • {env_var_warnings}"

            handle_error(msg)
            return None
        except ValueError as e:
            handle_error(f"Failed to load nao_config.yaml: {e}")
            return None

    @classmethod
    def json_schema(cls) -> dict:
        """Generate JSON schema for the configuration."""
        return cls.model_json_schema()


LLM_OVERRIDE_NOTICE = (
    "# An LLM provider edited in the app (Settings > Project > Models) is stored in the app",
    "# database and takes precedence over this block until it is deleted there.",
)


def annotate_llm_override(config_path: Path) -> None:
    """Note, above the saved `llm` block, that editing a provider in the app overrides it."""
    content = config_path.read_text()
    lines = content.splitlines()
    index = next((i for i, line in enumerate(lines) if line.rstrip() == "llm:"), None)
    if index is None:
        return

    lines[index:index] = LLM_OVERRIDE_NOTICE
    trailing_newline = "\n" if content.endswith("\n") else ""
    config_path.write_text("\n".join(lines) + trailing_newline)


def annotate_optional_templates(config_path: Path) -> None:
    """Add commented optional templates to each saved database configuration."""
    content = config_path.read_text()
    lines = content.splitlines()
    index = 0
    changed = False

    while index < len(lines):
        templates_match = re.match(r"^(\s*)templates:\s*$", lines[index])
        if not templates_match:
            index += 1
            continue

        templates_indent = len(templates_match.group(1))
        item_index = index + 1
        selected_templates: set[str] = set()
        item_prefix: str | None = None

        while item_index < len(lines):
            item_match = re.match(r"^(\s*)- (\S+)", lines[item_index])
            if not item_match or len(item_match.group(1)) < templates_indent:
                break
            item_prefix = item_match.group(1)
            selected_templates.add(item_match.group(2))
            item_index += 1

        if item_prefix is None:
            index += 1
            continue

        optional_templates = [
            ("profiling", "# - profiling  -- Adds profiling of your data in agent context"),
            ("query_history", "# - query_history  -- Pulls most frequent queries / joins on each table"),
        ]
        comments = [
            f"{item_prefix}{comment}" for template, comment in optional_templates if template not in selected_templates
        ]
        lines[item_index:item_index] = comments
        changed = changed or bool(comments)
        index = item_index + len(comments)

    if changed:
        trailing_newline = "\n" if content.endswith("\n") else ""
        config_path.write_text("\n".join(lines) + trailing_newline)


def resolve_project_path() -> Path:
    """Resolve the nao project directory from the current working directory."""
    return Path.cwd()
