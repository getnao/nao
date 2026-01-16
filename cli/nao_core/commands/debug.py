import sys

from rich.console import Console
from rich.table import Table

from nao_core.config import NaoConfig

console = Console()


def test_database_connection(db_config) -> tuple[bool, str]:
    """Test connectivity to a database.

    Returns:
            Tuple of (success, message)
    """
    try:
        conn = db_config.connect()
        # Run a simple query to verify the connection works
        if db_config.dataset_id:
            # If dataset is specified, list tables in that dataset
            tables = conn.list_tables()
            table_count = len(tables)
            return True, f"Connected successfully ({table_count} tables found)"
        else:
            # If no dataset, list datasets in the project instead
            datasets = conn.list_databases()
            dataset_count = len(datasets)
            return True, f"Connected successfully ({dataset_count} datasets found)"
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
