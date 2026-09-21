import os
from typing import Any, Tuple

from rich.console import Console
from rich.markup import escape
from rich.table import Table

from nao_core.config import NaoConfig, resolve_project_path
from nao_core.config.llm import (
    OPENAI_COMPATIBLE_PROVIDERS,
    PROVIDER_AUTH,
    PROVIDERS_WITHOUT_MODEL_LIST,
    ProviderConfig,
)
from nao_core.tracking import track_command

console = Console()


def _count(models) -> int:
    """Some sdk return a list like object that implements __len__, some no"""
    try:
        return len(models)
    except TypeError:
        return sum(1 for _ in models)


def _extract_model_id(model: Any) -> str | None:
    if isinstance(model, dict):
        for key in ("modelId", "id", "model", "name"):
            value = model.get(key)
            if isinstance(value, str) and value:
                return value
        return None

    for attr in ("id", "model", "name", "modelId"):
        value = getattr(model, attr, None)
        if isinstance(value, str) and value:
            return value
    return None


def _collect_model_ids(models: Any) -> set[str]:
    """Normalize provider model list entries into a set of comparable ids."""
    ids: set[str] = set()
    for model in models:
        model_id = _extract_model_id(model)
        if not model_id:
            continue
        ids.add(model_id)
        if model_id.startswith("models/"):
            ids.add(model_id.removeprefix("models/"))
    return ids


def _is_model_available(configured_id: str, available: set[str]) -> bool:
    if configured_id in available or f"models/{configured_id}" in available:
        return True
    return any(candidate == configured_id or candidate.startswith(f"{configured_id}:") for candidate in available)


def _missing_configured_models(llm_config: ProviderConfig, available: set[str]) -> list[str]:
    if not llm_config.models:
        return []
    return [model.id for model in llm_config.models if not _is_model_available(model.id, available)]


def _connection_message(model_count: int, missing: list[str]) -> str:
    message = f"Connected successfully ({model_count} models available)"
    if missing:
        message += f". Warning: configured model(s) not in provider list: {', '.join(missing)}"
    return message


def _check_openai_compatible(llm_config: ProviderConfig) -> Tuple[bool, str]:
    """Test a provider that speaks the OpenAI API, falling back to a probe call.

    Qwen and MiniMax do not implement `GET /v1/models`, so for them alone a 404 is answered with a
    one-token completion against the configured model. Every other provider reports the error as-is,
    so that a wrong endpoint stays visible.
    """
    from nao_core.deps import require_dependency

    require_dependency("openai", "openai", f"for {llm_config.id} LLM provider")
    from openai import OpenAI

    base_url = llm_config.base_url or PROVIDER_AUTH[llm_config.provider].default_base_url
    # The client refuses to start without a key, which endpoints that need no auth simply ignore.
    client = OpenAI(api_key=llm_config.api_key or "no-key", base_url=base_url)

    try:
        models = list(client.models.list())
    except Exception as error:
        if llm_config.provider not in PROVIDERS_WITHOUT_MODEL_LIST or not _is_not_found(error):
            raise
        return _probe_completion(client, llm_config)

    missing = _missing_configured_models(llm_config, _collect_model_ids(models))
    return True, _connection_message(len(models), missing)


def _is_not_found(error: Exception) -> bool:
    message = str(error)
    return "404" in message or "not found" in message.lower()


def _probe_completion(client: Any, llm_config: ProviderConfig) -> Tuple[bool, str]:
    """Verify credentials with the smallest possible completion, for providers with no model list."""
    model = llm_config.default_model
    if not model:
        return False, "Provider exposes no model list, declare a model to test the connection"

    client.chat.completions.create(
        model=model.id,
        messages=[{"role": "user", "content": "ping"}],
        max_tokens=1,
    )
    return True, f"Connected successfully (no model list, verified '{model.id}' with a test completion)"


def _check_available_models(llm_config: ProviderConfig) -> Tuple[bool, str]:
    from nao_core.deps import require_dependency

    provider = llm_config.provider.value
    api_key = llm_config.api_key

    base_url = llm_config.base_url

    if llm_config.provider in OPENAI_COMPATIBLE_PROVIDERS:
        return _check_openai_compatible(llm_config)

    if provider == "anthropic":
        require_dependency("anthropic", "anthropic", "for Anthropic LLM provider")
        from anthropic import Anthropic

        anthropic_kwargs: dict[str, Any] = {"api_key": api_key}
        if base_url:
            anthropic_kwargs["base_url"] = base_url
        client = Anthropic(**anthropic_kwargs)
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

    model_list = list(models)
    available_ids = _collect_model_ids(model_list)
    missing = _missing_configured_models(llm_config, available_ids)
    return True, _connection_message(_count(model_list), missing)


def check_llm_connection(llm_config: ProviderConfig) -> tuple[bool, str]:
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
                    escape(message),
                )
            else:
                console.print("[bold red]✗[/bold red]")
                db_table.add_row(
                    db.name,
                    db.type,
                    "[red]Failed[/red]",
                    f"[red]{escape(message)}[/red]",
                )

        console.print()
        console.print(db_table)
    else:
        console.print("[dim]No databases configured[/dim]")

    console.print()

    # Test LLM
    if config.llm:
        console.print("[bold]LLM Providers:[/bold]")
        llm_table = Table(show_header=True, header_style="bold")
        llm_table.add_column("Provider")
        llm_table.add_column("Models")
        llm_table.add_column("Status")
        llm_table.add_column("Details")
        model_warnings: list[str] = []

        for provider_config in config.llm.providers:
            provider_name = provider_config.id
            console.print(f"  Testing [cyan]{provider_name}[/cyan]...", end=" ")
            success, message = check_llm_connection(provider_config)
            models = ", ".join(model.id for model in provider_config.models) or "[dim]provider default[/dim]"
            has_model_warning = "Warning: configured model(s) not in provider list" in message

            if success and has_model_warning:
                console.print("[bold yellow]⚠[/bold yellow]")
                llm_table.add_row(
                    provider_name, models, "[yellow]Connected[/yellow]", f"[yellow]{escape(message)}[/yellow]"
                )
                model_warnings.append(f"{provider_name}: {message.split('Warning: ', 1)[1]}")
            elif success:
                console.print("[bold green]✓[/bold green]")
                llm_table.add_row(provider_name, models, "[green]Connected[/green]", escape(message))
            else:
                console.print("[bold red]✗[/bold red]")
                llm_table.add_row(provider_name, models, "[red]Failed[/red]", f"[red]{escape(message)}[/red]")

        console.print()
        console.print(llm_table)
        for warning in model_warnings:
            console.print(f"[yellow]⚠[/yellow] {escape(warning)}")
    else:
        console.print("[dim]No LLM configured[/dim]")

    console.print()
