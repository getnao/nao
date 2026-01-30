import sys

from rich.console import Console
from rich.table import Table

from nao_core.config import NaoConfig
from nao_core.config.databases import AnyDatabaseConfig

console = Console()


def test_database_connection(db_config: AnyDatabaseConfig) -> tuple[bool, str]:
    """Test connectivity to a database.

    Returns:
            Tuple of (success, message)
    """
    try:
        conn = db_config.connect()
        # Run a simple query to verify the connection works
        if hasattr(db_config, "dataset_id") and db_config.dataset_id:
            # If dataset is specified, list tables in that dataset
            tables = conn.list_tables()
            table_count = len(tables)
            return True, f"Connected successfully ({table_count} tables found)"
        elif list_databases := getattr(conn, "list_databases", None):
            # If no dataset, list schemas in the database instead
            schemas = list_databases()
            schema_count = len(schemas)
            return True, f"Connected successfully ({schema_count} schemas found)"
        else:
            # Fallback for backends that don't support list_tables and list_databases
            return True, "Connected but unable to list neither datasets nor schemas"
    except Exception as e:
        return False, str(e)


def test_llm_connection(llm_config) -> tuple[bool, str]:
    """Test connectivity to an LLM provider.

    Returns:
            Tuple of (success, message)
    """
    try:
        if llm_config.provider.value == "openai":
            import openai

            client = openai.OpenAI(api_key=llm_config.api_key)
            # Make a minimal API call to verify the key works
            models = client.models.list()
            # Just check we can iterate (don't need to consume all)
            model_count = sum(1 for _ in models)
            return True, f"Connected successfully ({model_count} models available)"
        elif llm_config.provider.value == "anthropic":
            from anthropic import Anthropic

            client = Anthropic(api_key=llm_config.api_key)

            models = client.models.list()

            model_count = sum(1 for _ in models)
            return True, f"Connected successfully ({model_count} models available)"
        else:
            return False, f"Unknown provider: {llm_config.provider}"
    except Exception as e:
        return False, str(e)


def debug():
    """Test connectivity to configured databases and LLMs.

    Loads the nao configuration from the current directory and tests
    connections to all configured databases and LLM providers.
    """
    console.print("\n[bold cyan]🔍 nao debug - Testing connections...[/bold cyan]\n")

    # Load config
    config = NaoConfig.try_load()
    if not config:
        console.print("[bold red]✗[/bold red] No nao_config.yaml found in current directory")
        console.print("[dim]Run 'nao init' to create a configuration file[/dim]")
        sys.exit(1)
    assert config is not None  # Help type checker after sys.exit

    console.print(f"[bold green]✓[/bold green] Loaded config: [cyan]{config.project_name}[/cyan]\n")

    # Test databases
    if config.databases:
        console.print("[bold]Databases:[/bold]")
        db_table = Table(show_header=True, header_style="bold")
        db_table.add_column("Name")
        db_table.add_column("Type")
        db_table.add_column("Status")
        db_table.add_column("Details")

        for db in config.databases:
            console.print(f"  Testing [cyan]{db.name}[/cyan]...", end=" ")
            success, message = test_database_connection(db)

            if success:
                console.print("[bold green]✓[/bold green]")
                db_table.add_row(
                    db.name,
                    db.type,
                    "[green]Connected[/green]",
                    message,
                )
            else:
                console.print("[bold red]✗[/bold red]")
                # Truncate long error messages
                short_msg = message[:80] + "..." if len(message) > 80 else message
                db_table.add_row(
                    db.name,
                    db.type,
                    "[red]Failed[/red]",
                    short_msg,
                )

        console.print()
        console.print(db_table)
    else:
        console.print("[dim]No databases configured[/dim]")

    console.print()

    # Test LLM
    if config.llm:
        console.print("[bold]LLM Provider:[/bold]")
        llm_table = Table(show_header=True, header_style="bold")
        llm_table.add_column("Provider")
        llm_table.add_column("Status")
        llm_table.add_column("Details")

        console.print(f"  Testing [cyan]{config.llm.provider.value}[/cyan]...", end=" ")
        success, message = test_llm_connection(config.llm)

        if success:
            console.print("[bold green]✓[/bold green]")
            llm_table.add_row(
                config.llm.provider.value,
                "[green]Connected[/green]",
                message,
            )
        else:
            console.print("[bold red]✗[/bold red]")
            short_msg = message[:80] + "..." if len(message) > 80 else message
            llm_table.add_row(
                config.llm.provider.value,
                "[red]Failed[/red]",
                short_msg,
            )

        console.print()
        console.print(llm_table)
    else:
        console.print("[dim]No LLM configured[/dim]")

    console.print()
