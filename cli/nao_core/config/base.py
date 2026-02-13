import os
import re
import sys
from pathlib import Path
from typing import cast

import yaml
from ibis import BaseBackend
from pydantic import BaseModel, Field, ValidationError, model_validator
from rich.console import Console

from nao_core.ui import UI, ask_confirm, ask_select

from .databases import DATABASE_CONFIG_CLASSES, AnyDatabaseConfig, DatabaseType, parse_database_config
from .llm import LLMConfig
from .mcp import McpConfig
from .notion import NotionConfig
from .repos import RepoConfig
from .skills import SkillsConfig
from .slack import SlackConfig


class NaoConfigError(Exception):
    """Raised when nao config loading fails."""

    pass


class NaoConfig(BaseModel):
    """nao project configuration."""

    project_name: str = Field(description="The name of the nao project")
    databases: list[AnyDatabaseConfig] = Field(default_factory=list, description="The databases to use")
    repos: list[RepoConfig] = Field(default_factory=list, description="The repositories to use")
    notion: NotionConfig | None = Field(default=None, description="The Notion configurations")
    llm: LLMConfig | None = Field(default=None, description="The LLM configuration")
    slack: SlackConfig | None = Field(default=None, description="The Slack configuration")
    mcp: McpConfig | None = Field(default=None, description="The MCP configuration")
    skills: SkillsConfig | None = Field(default=None, description="The Skills configuration")

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

        return cls(
            project_name=project_name,
            databases=cls._prompt_databases(),
            repos=cls._prompt_repos(),
            llm=cls._prompt_llm(),
            slack=cls._prompt_slack(),
            notion=cls._prompt_notion(),
            mcp=cls._prompt_mcp(project_name),
            skills=cls._prompt_skills(project_name),
        )

    @classmethod
    def _prompt_extend(cls, existing: "NaoConfig") -> "NaoConfig":
        """Extend an existing config by adding more items."""
        databases = list(existing.databases)
        repos = list(existing.repos)
        llm = existing.llm
        slack = existing.slack
        notion = existing.notion
        mcp = existing.mcp
        skills = existing.skills

        # Show current config summary
        UI.title("Current Configuration")
        if databases:
            UI.print(f"  Databases: {', '.join(db.name for db in databases)}")
        if repos:
            UI.print(f"  Repos: {', '.join(r.name for r in repos)}")
        if llm:
            UI.print(f"  LLM: {llm.provider}")
        if slack:
            UI.print("  Slack: configured")
        if notion:
            UI.print("  Notion: configured")
        if mcp:
            UI.print("  MCP: configured")
        if skills:
            UI.print("  Skills: configured")
        UI.print()

        # Prompt for additions
        databases.extend(cls._prompt_databases(has_existing=bool(existing.databases)))
        repos.extend(cls._prompt_repos(has_existing=bool(existing.repos)))

        if not llm:
            llm = cls._prompt_llm()

        if not slack:
            slack = cls._prompt_slack()

        if not notion:
            notion = cls._prompt_notion()

        if not mcp:
            mcp = cls._prompt_mcp(existing.project_name)

        if not skills:
            skills = cls._prompt_skills(existing.project_name)

        return cls(
            project_name=existing.project_name,
            databases=databases,
            repos=repos,
            llm=llm,
            slack=slack,
            notion=notion,
            mcp=mcp,
            skills=skills,
        )

    @staticmethod
    def _prompt_databases(has_existing: bool = False) -> list[AnyDatabaseConfig]:
        """Prompt for database configurations using questionary."""
        databases: list[AnyDatabaseConfig] = []

        prompt = "Add more database connections?" if has_existing else "Set up database connections?"
        if not ask_confirm(prompt, default=not has_existing):
            return databases

        while True:
            UI.title("Database Configuration")

            db_type = ask_select("Select database type:", choices=DatabaseType.choices())

            config_class = DATABASE_CONFIG_CLASSES[DatabaseType(db_type)]
            db_config = cast(AnyDatabaseConfig, config_class.promptConfig())
            databases.append(db_config)

            UI.success(f"Added database: {db_config.name}")

            if not ask_confirm("Add another database?", default=False):
                break

        return databases

    @staticmethod
    def _prompt_repos(has_existing: bool = False) -> list[RepoConfig]:
        """Prompt for repository configurations using questionary."""
        repos: list[RepoConfig] = []

        prompt = "Add more git repositories?" if has_existing else "Set up git repositories?"
        if not ask_confirm(prompt, default=not has_existing):
            return repos

        while True:
            repo_config = RepoConfig.promptConfig()
            repos.append(repo_config)
            UI.success(f"Added repository: {repo_config.name}")

            if not ask_confirm("Add another repository?", default=False):
                break

        return repos

    @staticmethod
    def _prompt_llm() -> LLMConfig | None:
        """Prompt for LLM configuration using questionary."""
        if ask_confirm("Set up LLM configuration?", default=True):
            return LLMConfig.promptConfig()
        return None

    @staticmethod
    def _prompt_slack() -> SlackConfig | None:
        """Prompt for Slack configuration using questionary."""
        if ask_confirm("Set up Slack integration?", default=False):
            return SlackConfig.promptConfig()
        return None

    @staticmethod
    def _prompt_notion() -> NotionConfig | None:
        """Prompt for Notion configuration using questionary."""
        if ask_confirm("Set up Notion integration?", default=False):
            return NotionConfig.promptConfig()
        return None

    @staticmethod
    def _prompt_mcp(project_name: str) -> McpConfig | None:
        """Prompt for MCP configuration using questionary."""
        if ask_confirm("Set up MCP servers?", default=False):
            McpConfig.promptConfig(project_name)
        return None

    @staticmethod
    def _prompt_skills(project_name: str) -> SkillsConfig | None:
        """Prompt for Skills configuration using questionary."""
        if ask_confirm("Set up Skills folder?", default=False):
            SkillsConfig.promptConfig(project_name)
        return None

    def save(self, path: Path) -> None:
        """Save the configuration to a YAML file."""
        config_file = path / "nao_config.yaml"
        with config_file.open("w") as f:
            yaml.dump(
                self.model_dump(mode="json", by_alias=True, exclude_none=True),
                f,
                default_flow_style=False,
                sort_keys=False,
                allow_unicode=True,
            )

    @classmethod
    def load(cls, path: Path) -> "NaoConfig":
        """Load the configuration from a YAML file."""
        config_file = path / "nao_config.yaml"
        content = config_file.read_text()
        content = cls._process_env_vars(content)
        data = yaml.safe_load(content)
        return cls.model_validate(data)

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
        path: Path | None = None,
        *,
        exit_on_error: bool = False,
        raise_on_error: bool = False,
    ) -> "NaoConfig | None":
        """Try to load config from path.

        Args:
            path: Directory containing nao_config.yaml. Defaults to NAO_DEFAULT_PROJECT_PATH
                  environment variable if set, otherwise current directory.
            exit_on_error: If True, prints error message and calls sys.exit(1) on failure.
            raise_on_error: If True, raises NaoConfigError on failure.
        Returns:
            NaoConfig if loaded successfully, None if failed and both flags are False.
        """
        if path is None:
            default_path = os.environ.get("NAO_DEFAULT_PROJECT_PATH")
            path = Path(default_path) if default_path else Path.cwd()

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
            return cls.load(path)
        except yaml.YAMLError as e:
            handle_error(f"Failed to load nao_config.yaml: Invalid YAML syntax: {e}")
            return None
        except ValidationError as e:
            errors = "; ".join(
                f"{' → '.join(str(x) for x in err['loc']) or 'config'}: {err['msg']}" for err in e.errors()
            )
            handle_error(f"Failed to load nao_config.yaml: {errors}")
            return None
        except ValueError as e:
            handle_error(f"Failed to load nao_config.yaml: {e}")
            return None

    @classmethod
    def json_schema(cls) -> dict:
        """Generate JSON schema for the configuration."""
        return cls.model_json_schema()

    @staticmethod
    def _process_env_vars(content: str) -> str:
        # Support both ${{ env('VAR') }} and {{ env('VAR') }} formats
        regex = re.compile(r"\$?\{\{\s*env\(['\"]([^'\"]+)['\"]\)\s*\}\}")

        def replacer(match: re.Match[str]) -> str:
            env_var = match.group(1)
            return os.environ.get(env_var, "")

        return regex.sub(replacer, content)
