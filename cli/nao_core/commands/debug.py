import os
from typing import Tuple

from rich.console import Console
from rich.table import Table

from nao_core.config import NaoConfig
from nao_core.tracking import track_command

console = Console()


def _count(models) -> int:
    """Some sdk return a list like object that implements __len__, some no"""
    try:
        return len(models)
    except TypeError:
        return sum(1 for _ in models)


def _check_available_models(provider: str, api_key: str) -> Tuple[bool, str]:
    if provider == "openai":
        from openai import OpenAI

        client = OpenAI(api_key=api_key)
        models = client.models.list()
    elif provider == "anthropic":
        from anthropic import Anthropic

        client = Anthropic(api_key=api_key)
        models = client.models.list()
    elif provider == "gemini":
        from google import genai

        client = genai.Client(api_key=api_key)
        models = client.models.list()
    elif provider == "mistral":
        from mistralai import Mistral

        client = Mistral(api_key=api_key)
        models = client.models.list()
    elif provider == "openrouter":
        from openai import OpenAI

        client = OpenAI(base_url="https://openrouter.ai/api/v1", api_key=api_key)
        models = client.models.list()
    elif provider == "ollama":
        try:
            import ollama
        except ImportError:
            return (
                False,
                "Provider 'ollama' requires the optional dependency 'ollama'. Install it to use this provider.",
            )

        models = ollama.list().models
    elif provider == "bedrock":
        region = os.environ.get("AWS_REGION", "us-east-1")
        bearer_token = api_key or os.environ.get("AWS_BEARER_TOKEN_BEDROCK")
        if bearer_token:
            return True, f"Bearer token configured (region: {region})"

        import boto3

        client = boto3.client("bedrock", region_name=region)
        response = client.list_foundation_models()
        models = response.get("modelSummaries", [])
    else:
        return False, f"Unknown provider: {provider}"

    model_count = _count(models)
    return True, f"Connected successfully ({model_count} models available)"


def check_llm_connection(llm_config) -> tuple[bool, str]:
    """Test connectivity to an LLM provider.

    Returns:
            Tuple of (success, message)
    """
    # Check if API key is required but missing
    if llm_config.requires_api_key and not llm_config.api_key:
        provider = llm_config.provider.value
        return False, f"API key is empty or not set (required for {provider})"

    try:
        return _check_available_models(llm_config.provider.value, llm_config.api_key)
    except Exception as e:
        error_msg = str(e)
        if "Unauthorized" in error_msg or "401" in error_msg:
            return False, f"Authentication failed: {error_msg} (check if API key is valid)"
        if "invalid_api_key" in error_msg.lower():
            return False, f"Invalid API key: {error_msg}"
        return False, error_msg


@track_command("debug")
def debug():
    """Test connectivity to configured databases and LLMs.

    Loads the nao configuration from the current directory and tests
    connections to all configured databases and LLM providers.
    """
    console.print("\n[bold cyan]🔍 nao debug - Testing connections...[/bold cyan]\n")

    # Load config
    config = NaoConfig.try_load(exit_on_error=True)
    assert config is not None  # Help type checker after exit_on_error=True

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
            success, message = db.check_connection()

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
        success, message = check_llm_connection(config.llm)

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
