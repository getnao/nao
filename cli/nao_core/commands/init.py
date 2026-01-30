import os
from dataclasses import dataclass
from pathlib import Path
from typing import Annotated

from cyclopts import Parameter
from rich.console import Console
from rich.panel import Panel
from rich.prompt import Confirm, Prompt

from nao_core.config import (
    AnyDatabaseConfig,
    BigQueryConfig,
    DatabaseType,
    DatabricksConfig,
    DuckDBConfig,
    LLMConfig,
    LLMProvider,
    NaoConfig,
    PostgresConfig,
    SlackConfig,
    SnowflakeConfig,
)
from nao_core.config.exceptions import InitError
from nao_core.config.repos import RepoConfig

console = Console()


class EmptyProjectNameError(InitError):
    """Raised when project name is empty."""

    def __init__(self):
        super().__init__("Project name cannot be empty.")


class ProjectExistsError(InitError):
    """Raised when project folder already exists."""

    def __init__(self, project_name: str):
        self.project_name = project_name
        super().__init__(f"Folder '{project_name}' already exists.")


class EmptyApiKeyError(InitError):
    """Raised when API key is empty."""

    def __init__(self):
        super().__init__("API key cannot be empty.")


@dataclass
class CreatedFile:
    path: Path
    content: str | None


def setup_project_name(force: bool = False) -> tuple[str, Path]:
    """Setup the project name."""
    # Check if we're in a directory with an existing nao_config.yaml
    current_dir = Path.cwd()
    config_file = current_dir / "nao_config.yaml"

    if config_file.exists():
        # Load existing config to get project name
        existing_config = NaoConfig.try_load(current_dir)
        if existing_config:
            console.print("\n[bold yellow]Found existing nao_config.yaml[/bold yellow]")
            console.print(f"[dim]Project: {existing_config.project_name}[/dim]\n")

            if force or Confirm.ask("[bold]Re-initialize this project?[/bold]", default=True):
                return existing_config.project_name, current_dir
            else:
                raise InitError("Initialization cancelled.")

    # Normal flow: prompt for project name
    project_name = Prompt.ask("[bold]Enter your project name[/bold]")

    if not project_name:
        raise EmptyProjectNameError()

    project_path = Path(project_name)

    if project_path.exists() and not force:
        raise ProjectExistsError(project_name)

    project_path.mkdir(parents=True, exist_ok=True)

    return project_name, project_path


def setup_bigquery() -> BigQueryConfig:
    """Setup a BigQuery database configuration."""
    return BigQueryConfig.promptConfig()


def setup_duckdb() -> DuckDBConfig:
    """Setup a DuckDB database configuration."""
    return DuckDBConfig.promptConfig()


def setup_databricks() -> DatabricksConfig:
    """Setup a Databricks database configuration."""
    return DatabricksConfig.promptConfig()


def setup_snowflake() -> SnowflakeConfig:
    """Setup a Snowflake database configuration."""
    return SnowflakeConfig.promptConfig()


def setup_postgres() -> PostgresConfig:
    """Setup a PostgreSQL database configuration."""
    return PostgresConfig.promptConfig()


def setup_databases() -> list[AnyDatabaseConfig]:
    """Setup database configurations."""
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

        if db_type == DatabaseType.BIGQUERY.value:
            db_config = setup_bigquery()
            databases.append(db_config)
            console.print(f"\n[bold green]✓[/bold green] Added database [cyan]{db_config.name}[/cyan]")
        elif db_type == DatabaseType.POSTGRES.value:
            db_config = setup_postgres()
            databases.append(db_config)
            console.print(f"\n[bold green]✓[/bold green] Added database [cyan]{db_config.name}[/cyan]")

        elif db_type == DatabaseType.DUCKDB.value:
            db_config = setup_duckdb()
            databases.append(db_config)
            console.print(f"\n[bold green]✓[/bold green] Added database [cyan]{db_config.name}[/cyan]")

        elif db_type == DatabaseType.DATABRICKS.value:
            db_config = setup_databricks()
            databases.append(db_config)
            console.print(f"\n[bold green]✓[/bold green] Added database [cyan]{db_config.name}[/cyan]")

        elif db_type == DatabaseType.SNOWFLAKE.value:
            db_config = setup_snowflake()
            databases.append(db_config)
            console.print(f"\n[bold green]✓[/bold green] Added database [cyan]{db_config.name}[/cyan]")

        add_another = Confirm.ask("\n[bold]Add another database?[/bold]", default=False)
        if not add_another:
            break

    return databases


def setup_repos() -> list[RepoConfig]:
    """Setup repository configurations."""
    repos: list[RepoConfig] = []
    should_setup = Confirm.ask("\n[bold]Set up git repositories?[/bold]", default=True)

    if not should_setup:
        return repos

    while True:
        console.print("\n[bold cyan]Git Repository Configuration[/bold cyan]\n")
        name = Prompt.ask("[bold]Repository name[/bold]")
        url = Prompt.ask("[bold]Repository URL[/bold]")

        repos.append(RepoConfig(name=name, url=url))
        console.print(f"\n[bold green]✓[/bold green] Added repository [cyan]{name}[/cyan]")

        add_another = Confirm.ask("\n[bold]Add another repository?[/bold]", default=False)
        if not add_another:
            break

    return repos


def setup_llm() -> LLMConfig | None:
    """Setup the LLM configuration."""
    llm_config = None
    should_setup = Confirm.ask("\n[bold]Set up LLM configuration?[/bold]", default=True)

    if should_setup:
        console.print("\n[bold cyan]LLM Configuration[/bold cyan]\n")

        provider_choices = [p.value for p in LLMProvider]
        llm_provider = Prompt.ask(
            "[bold]Select LLM provider[/bold]",
            choices=provider_choices,
            default=provider_choices[0],
        )

        api_key = Prompt.ask(
            f"[bold]Enter your {llm_provider.upper()} API key[/bold]",
            password=True,
        )

        if not api_key:
            raise EmptyApiKeyError()

        llm_config = LLMConfig(
            provider=LLMProvider(llm_provider),
            api_key=api_key,
        )

    return llm_config


def setup_slack() -> SlackConfig | None:
    """Setup the Slack configuration."""
    slack_config = None
    should_setup = Confirm.ask("\n[bold]Set up Slack integration?[/bold]", default=False)

    if should_setup:
        console.print("\n[bold cyan]Slack Configuration[/bold cyan]\n")

        bot_token = Prompt.ask(
            "[bold]Enter your Slack bot token[/bold]",
            password=True,
        )

        if not bot_token:
            raise InitError("Slack bot token cannot be empty.")

        signing_secret = Prompt.ask(
            "[bold]Enter your Slack signing secret[/bold]",
            password=True,
        )

        if not signing_secret:
            raise InitError("Slack signing secret cannot be empty.")

        slack_config = SlackConfig(
            bot_token=bot_token,
            signing_secret=signing_secret,
        )

    return slack_config


def create_empty_structure(project_path: Path) -> tuple[list[str], list[CreatedFile]]:
    """Create project folder structure to guide users.

    To add new folders, simply append them to the FOLDERS list below.
    Each folder will be created automatically (can be empty).
    """
    FOLDERS = [
        "databases",
        "queries",
        "docs",
        "semantics",
        "repos",
        "agent/tools",
        "agent/mcps",
    ]

    FILES = [
        CreatedFile(path=Path("RULES.md"), content=None),
        CreatedFile(path=Path(".naoignore"), content="templates/\n*.j2\n"),
    ]

    created_folders = []
    for folder in FOLDERS:
        folder_path = project_path / folder
        folder_path.mkdir(parents=True, exist_ok=True)
        created_folders.append(folder)

    created_files = []
    for file in FILES:
        file_path = project_path / file.path
        if file.content:
            file_path.write_text(file.content)
        else:
            file_path.touch()
        created_files.append(file)

    return created_folders, created_files


def init(
    *,
    force: Annotated[bool, Parameter(name=["-f", "--force"])] = False,
):
    """Initialize a new nao project.

    Creates a project folder with a nao_config.yaml configuration file.

    Parameters
    ----------
    force : bool
        Force re-initialization even if the folder already exists.
    """
    console.print("\n[bold cyan]🚀 nao project initialization[/bold cyan]\n")

    try:
        project_name, project_path = setup_project_name(force=force)
        config = NaoConfig(
            project_name=project_name,
            databases=setup_databases(),
            repos=setup_repos(),
            llm=setup_llm(),
            slack=setup_slack(),
        )
        config.save(project_path)

        # Create project folder structure
        created_folders, created_files = create_empty_structure(project_path)

        console.print()
        console.print(f"[bold green]✓[/bold green] Created project [cyan]{project_name}[/cyan]")
        console.print(f"[bold green]✓[/bold green] Created [dim]{project_path / 'nao_config.yaml'}[/dim]")
        console.print()
        console.print("[bold green]Done![/bold green] Your nao project is ready. 🎉")

        is_subfolder = project_path.resolve() != Path.cwd().resolve()

        has_connections = config.databases or config.llm
        if has_connections:
            # Change directory for the debug command to run in the right context
            os.chdir(project_path)
            from nao_core.commands.debug import debug

            debug()

        console.print()

        cd_instruction = ""
        if is_subfolder:
            cd_instruction = f"\n[bold]First, navigate to your project:[/bold]\n[cyan]cd {project_path}[/cyan]\n\n"

        help_content = f"""{cd_instruction}[bold]Available Commands:[/bold]

[cyan]nao debug[/cyan]   - Test connectivity to your configured databases and LLM
              Verifies that all connections are working properly

[cyan]nao sync[/cyan]    - Sync database schemas to local markdown files
              Creates documentation for your tables and columns

[cyan]nao chat[/cyan]    - Start the nao chat interface
              Launch the web UI to chat with your data
"""
        console.print(Panel(help_content, border_style="cyan", title="🚀 Get Started", title_align="left"))
        console.print()

    except InitError as e:
        console.print(f"[bold red]✗[/bold red] {e}")
