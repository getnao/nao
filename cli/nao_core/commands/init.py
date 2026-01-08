from pathlib import Path
from typing import Annotated

from cyclopts import Parameter
from rich.console import Console
from rich.prompt import Confirm, Prompt

from nao_core.config import BigQueryConfig, DatabaseConfig, DatabaseType, LLMConfig, LLMProvider, NaoConfig

console = Console()


class InitError(Exception):
    """Base exception for init command errors."""

    pass


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


def setup_project_name(force: bool = False) -> tuple[str, Path]:
    """Setup the project name."""
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
    console.print("\n[bold cyan]BigQuery Configuration[/bold cyan]\n")

    name = Prompt.ask("[bold]Connection name[/bold]", default="bigquery-prod")

    project_id = Prompt.ask("[bold]GCP Project ID[/bold]")
    if not project_id:
        raise InitError("GCP Project ID cannot be empty.")

    dataset_id = Prompt.ask("[bold]Default dataset[/bold] [dim](optional, press Enter to skip)[/dim]", default="")

    credentials_path = Prompt.ask(
        "[bold]Service account JSON path[/bold] [dim](optional, uses ADC if empty)[/dim]",
        default="",
    )

    return BigQueryConfig(
        name=name,
        project_id=project_id,
        dataset_id=dataset_id or None,
        credentials_path=credentials_path or None,
    )


def setup_databases() -> list[DatabaseConfig]:
    """Setup database configurations."""
    databases: list[DatabaseConfig] = []

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

        add_another = Confirm.ask("\n[bold]Add another database?[/bold]", default=False)
        if not add_another:
            break

    return databases


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
            llm=setup_llm(),
        )
        config.save(project_path)

        console.print()
        console.print(f"[bold green]✓[/bold green] Created project [cyan]{project_name}[/cyan]")
        console.print(f"[bold green]✓[/bold green] Created [dim]{project_path / 'nao_config.yaml'}[/dim]")
        console.print()
        console.print("[bold green]Done![/bold green] Your nao project is ready. 🎉")
    except InitError as e:
        console.print(f"[bold red]✗[/bold red] {e}")
