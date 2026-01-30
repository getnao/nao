import os
import re
import sys
from pathlib import Path
from typing import cast

import dotenv
import yaml
from ibis import BaseBackend
from pydantic import BaseModel, Field, ValidationError, model_validator
from rich.console import Console
from rich.prompt import Confirm, Prompt

from .databases import DATABASE_CONFIG_CLASSES, AnyDatabaseConfig, DatabaseType, parse_database_config
from .llm import LLMConfig
from .notion import NotionConfig
from .repos import RepoConfig
from .slack import SlackConfig

dotenv.load_dotenv()

console = Console()


class NaoConfig(BaseModel):
    """nao project configuration."""

    project_name: str = Field(description="The name of the nao project")
    databases: list[AnyDatabaseConfig] = Field(default_factory=list, description="The databases to use")
    repos: list[RepoConfig] = Field(default_factory=list, description="The repositories to use")
    notion: NotionConfig | None = Field(default=None, description="The Notion configurations")
    llm: LLMConfig | None = Field(default=None, description="The LLM configuration")
    slack: SlackConfig | None = Field(default=None, description="The Slack configuration")

    @model_validator(mode="before")
    @classmethod
    def parse_databases(cls, data: dict) -> dict:
        """Parse database configs into their specific types."""
        if "databases" in data and isinstance(data["databases"], list):
            data["databases"] = [parse_database_config(db) if isinstance(db, dict) else db for db in data["databases"]]
        return data

    @classmethod
    def promptConfig(cls, project_name: str) -> "NaoConfig":
        """Interactively prompt the user for all nao configuration options."""
        return cls(
            project_name=project_name,
            databases=cls._prompt_databases(),
            repos=cls._prompt_repos(),
            llm=cls._prompt_llm(),
            slack=cls._prompt_slack(),
        )

    @staticmethod
    def _prompt_databases() -> list[AnyDatabaseConfig]:
        """Prompt for database configurations."""
        databases: list[AnyDatabaseConfig] = []

        should_setup = Confirm.ask("\n[bold]Set up database connections?[/bold]", default=True)
        if not should_setup:
            return databases

        while True:
            console.print("\n[bold cyan]Database Configuration[/bold cyan]\n")

            db_type_choices = [t.value for t in DatabaseType]
            db_type = Prompt.ask(
                "[bold]Select database type[/bold]",
                choices=db_type_choices,
                default=db_type_choices[0],
            )

            config_class = DATABASE_CONFIG_CLASSES[DatabaseType(db_type)]
            db_config = cast(AnyDatabaseConfig, config_class.promptConfig())
            databases.append(db_config)
            console.print(f"\n[bold green]✓[/bold green] Added database [cyan]{db_config.name}[/cyan]")

            if not Confirm.ask("\n[bold]Add another database?[/bold]", default=False):
                break

        return databases

    @staticmethod
    def _prompt_repos() -> list[RepoConfig]:
        """Prompt for repository configurations."""
        repos: list[RepoConfig] = []

        should_setup = Confirm.ask("\n[bold]Set up git repositories?[/bold]", default=True)
        if not should_setup:
            return repos

        while True:
            repo_config = RepoConfig.promptConfig()
            repos.append(repo_config)
            console.print(f"\n[bold green]✓[/bold green] Added repository [cyan]{repo_config.name}[/cyan]")

            if not Confirm.ask("\n[bold]Add another repository?[/bold]", default=False):
                break

        return repos

    @staticmethod
    def _prompt_llm() -> LLMConfig | None:
        """Prompt for LLM configuration."""
        if Confirm.ask("\n[bold]Set up LLM configuration?[/bold]", default=True):
            return LLMConfig.promptConfig()
        return None

    @staticmethod
    def _prompt_slack() -> SlackConfig | None:
        """Prompt for Slack configuration."""
        if Confirm.ask("\n[bold]Set up Slack integration?[/bold]", default=False):
            return SlackConfig.promptConfig()
        return None

    def save(self, path: Path) -> None:
        """Save the configuration to a YAML file."""
        config_file = path / "nao_config.yaml"
        with config_file.open("w") as f:
            yaml.dump(
                self.model_dump(mode="json", by_alias=True),
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
    ) -> "NaoConfig | None":
        """Try to load config from path.

        Args:
            path: Directory containing nao_config.yaml. Defaults to NAO_DEFAULT_PROJECT_PATH
                  environment variable if set, otherwise current directory.
            exit_on_error: If True, prints error message and calls sys.exit(1) on failure.
                If False (default), returns None on failure.
        Returns:
            NaoConfig if loaded successfully, None if failed and exit_on_error=False.
            Never returns None when exit_on_error=True (exits instead).
        """
        if path is None:
            default_path = os.environ.get("NAO_DEFAULT_PROJECT_PATH")
            path = Path(default_path) if default_path else Path.cwd()

        config_file = path / "nao_config.yaml"

        # Check if file exists first
        if not config_file.exists():
            if exit_on_error:
                console = Console()
                console.print("[bold red]✗[/bold red] No nao_config.yaml found in current directory")
                sys.exit(1)
            return None

        try:
            os.chdir(path)
            return cls.load(path)
        except yaml.YAMLError as e:
            if exit_on_error:
                console = Console()
                console.print("[bold red]✗[/bold red] Failed to load nao_config.yaml:")
                console.print(f"[red]Invalid YAML syntax: {e}[/red]")
                sys.exit(1)
            return None
        except ValidationError as e:
            if exit_on_error:
                console = Console()
                console.print("[bold red]✗[/bold red] Failed to load nao_config.yaml:")
                console.print()
                for error in e.errors():
                    loc = " → ".join(str(x) for x in error["loc"]) if error["loc"] else "config"
                    console.print(f"  [red]•[/red] [bold]{loc}[/bold]: {error['msg']}")
                console.print()
                sys.exit(1)
            return None
        except ValueError as e:
            if exit_on_error:
                console = Console()
                console.print("[bold red]✗[/bold red] Failed to load nao_config.yaml:")
                console.print(f"[red]{e}[/red]")
                sys.exit(1)
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
