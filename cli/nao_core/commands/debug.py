import os
from typing import Tuple

from rich.console import Console
from rich.table import Table

from nao_core.config import NaoConfig, resolve_project_path
from nao_core.tracking import track_command

console = Console()


def _count(models) -> int:
    """Some sdk return a list like object that implements __len__, some no"""
    try:
        return len(models)
    except TypeError:
        return sum(1 for _ in models)


def _check_available_models(llm_config) -> Tuple[bool, str]:
    from nao_core.deps import require_dependency

    provider = llm_config.provider.value
    api_key = llm_config.api_key

    if provider == "openai":
        require_dependency("openai", "openai", "for OpenAI LLM provider")
        from openai import OpenAI

        client = OpenAI(api_key=api_key)
        models = client.models.list()
    elif provider == "anthropic":
        require_dependency("anthropic", "anthropic", "for Anthropic LLM provider")
        from anthropic import Anthropic

        client = Anthropic(api_key=api_key)
        models = client.models.list()
    elif provider == "gemini":
        require_dependency("google.genai", "gemini", "for Google Gemini LLM provider")
        from google import genai

        client = genai.Client(api_key=api_key)
        models = client.models.list()
    elif provider == "mistral":
        require_dependency("mistralai", "mistral", "for Mistral LLM provider")
        from mistralai import Mistral

        client = Mistral(api_key=api_key)
        models = client.models.list()
    elif provider == "openrouter":
        require_dependency("openai", "openai", "for OpenRouter LLM provider")
        from openai import OpenAI

        client = OpenAI(base_url="https://openrouter.ai/api/v1", api_key=api_key)
        models = client.models.list()
    elif provider == "ollama":
        require_dependency("ollama", "ollama", "for Ollama LLM provider")
        import ollama

        models = ollama.list().models
    elif provider == "bedrock":
        region = llm_config.aws_region or os.environ.get("AWS_REGION", "us-east-1")
        if api_key:
            return True, f"Bearer token configured (region: {region})"

        import boto3

        profile = llm_config.aws_profile or os.environ.get("AWS_PROFILE")
        session = boto3.Session(profile_name=profile, region_name=region)
        client = session.client("bedrock")
        response = client.list_foundation_models()
        models = response.get("modelSummaries", [])
    elif provider == "vertex":
        project = llm_config.gcp_project
        location = llm_config.gcp_location or "us-east5"
        if not project:
            return False, "gcp_project is not set in config"

        if llm_config.service_account_json:
            import json

            from google.oauth2 import service_account

            info = json.loads(llm_config.service_account_json)
            credentials = service_account.Credentials.from_service_account_info(
                info, scopes=["https://www.googleapis.com/auth/cloud-platform"]
            )
            return True, f"Service account configured (project: {project}, location: {location})"
        if llm_config.key_file:
            from google.oauth2 import service_account

            credentials = service_account.Credentials.from_service_account_file(
                llm_config.key_file, scopes=["https://www.googleapis.com/auth/cloud-platform"]
            )
            return True, f"Key file configured (project: {project}, location: {location})"

        import google.auth

        credentials, _ = google.auth.default(scopes=["https://www.googleapis.com/auth/cloud-platform"])
        return True, f"ADC configured (project: {project}, location: {location})"
    else:
        return False, f"Unknown provider: {provider}"

    model_count = _count(models)
    return True, f"Connected successfully ({model_count} models available)"


def check_llm_connection(llm_config) -> tuple[bool, str]:
    """Test connectivity to an LLM provider.

    Returns:
            Tuple of (success, message)
    """
    if llm_config.requires_api_key and not llm_config.api_key:
        provider = llm_config.provider.value
        return False, f"API key is empty or not set (required for {provider})"

    try:
        return _check_available_models(llm_config)
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
    config = NaoConfig.try_load(resolve_project_path(), exit_on_error=True)
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
                db_table.add_row(
                    db.name,
                    db.type,
                    "[red]Failed[/red]",
                    f"[red]{message}[/red]",
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
            llm_table.add_row(
                config.llm.provider.value,
                "[red]Failed[/red]",
                f"[red]{message}[/red]",
            )

        console.print()
        console.print(llm_table)
    else:
        console.print("[dim]No LLM configured[/dim]")

    console.print()
