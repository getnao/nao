"""Sync command for synchronizing repositories and database schemas."""

import sys
from pathlib import Path
from typing import Annotated

from cyclopts import Parameter
from rich.console import Console

from nao_core.config import NaoConfig
from nao_core.templates.render import render_all_templates
from nao_core.tracking import track_command

from .providers import (
    PROVIDER_CHOICES,
    ProviderSelection,
    SyncResult,
    get_all_providers,
    get_providers_by_names,
)

console = Console()


@track_command("sync")
def sync(
    *,
    provider: Annotated[
        list[str] | None,
        Parameter(
            name=["-p", "--provider"],
            help=f"Provider(s) to sync. Use `-p provider:name` to sync a specific connection (e.g. databases:my-db). Or just `-p databases` to sync all connections. Options: {', '.join(PROVIDER_CHOICES)}",
        ),
    ] = None,
    output_dirs: Annotated[dict[str, str] | None, Parameter(show=False)] = None,
    _providers: Annotated[list[ProviderSelection] | None, Parameter(show=False)] = None,
    render_templates: bool = True,
):
    """Sync resources using configured providers.

    Creates folder structures based on each provider's default output directory:
      - repos/<repo_name>/         (git repositories)
      - databases/<type>/<connection>/<dataset>/<table>/*.md  (database schemas)

    After syncing providers, renders any Jinja templates (*.j2 files) found in
    the project directory, making the `nao` context object available for
    accessing provider data.
    """
    console.print("\n[bold cyan]🔄 nao sync[/bold cyan]\n")

    config = NaoConfig.try_load(exit_on_error=True)
    assert config is not None  # Help type checker after exit_on_error=True

    # Get project path (current working directory after NaoConfig.try_load)
    project_path = Path.cwd()

    console.print(f"[dim]Project:[/dim] {config.project_name}")

    # Resolve providers: CLI names > programmatic providers > all providers
    if provider:
        try:
            active_providers = get_providers_by_names(provider)
        except ValueError as e:
            console.print(f"[red]Error:[/red] {e}")
            sys.exit(1)
    elif _providers is not None:
        active_providers = _providers
    else:
        active_providers = get_all_providers()

    output_dirs = output_dirs or {}

    # Run each provider
    results: list[SyncResult] = []
    for selection in active_providers:
        sync_provider = selection.provider
        connection_filter = selection.connection_name

        # Get output directory (custom or default)
        output_dir = output_dirs.get(sync_provider.name, sync_provider.default_output_dir)
        output_path = Path(output_dir)

        try:
            sync_provider.pre_sync(config, output_path)

            if not sync_provider.should_sync(config):
                continue

            # Get items and filter by connection name if specified
            items = sync_provider.get_items(config)
            if connection_filter:
                items = [item for item in items if getattr(item, "name", None) == connection_filter]
                if not items:
                    console.print(
                        f"[yellow]Warning:[/yellow] No connection named '{connection_filter}' found for {sync_provider.name}"
                    )
                    continue

            result = sync_provider.sync(items, output_path, project_path=project_path)
            results.append(result)
        except Exception as e:
            # Capture error but continue with other providers
            results.append(SyncResult.from_error(sync_provider.name, e))
            console.print(f"  [yellow]⚠[/yellow] {sync_provider.emoji} {sync_provider.name}: [red]{e}[/red]")

    # Render user Jinja templates
    template_result = None
    if render_templates:
        console.print("\n[bold cyan]📝 Rendering templates[/bold cyan]\n")
        template_result = render_all_templates(project_path, config, console)

    # Separate successful and failed results
    successful_results = [r for r in results if r.success]
    failed_results = [r for r in results if not r.success]

    # Print summary with appropriate status
    if failed_results:
        if successful_results:
            console.print("\n[bold yellow]⚠ Sync Completed with Errors[/bold yellow]\n")
        else:
            console.print("\n[bold red]✗ Sync Failed[/bold red]\n")
    else:
        console.print("\n[bold green]✓ Sync Complete[/bold green]\n")

    has_results = False

    # Show successful syncs
    for result in successful_results:
        if result.items_synced > 0:
            has_results = True
            console.print(f"  [dim]{result.provider_name}:[/dim] {result.get_summary()}")

    # Show template results
    if template_result and (template_result.templates_rendered > 0 or template_result.templates_failed > 0):
        has_results = True
        console.print(f"  [dim]Templates:[/dim] {template_result.get_summary()}")

    # Show errors section if any
    if failed_results:
        has_results = True
        console.print("\n  [bold red]Errors:[/bold red]")
        for result in failed_results:
            console.print(f"    [red]•[/red] {result.provider_name}: {result.error}")

    if not has_results:
        console.print("  [dim]Nothing to sync[/dim]")

    console.print()

    # Exit with error code if any provider or template failed
    has_failures = bool(failed_results) or (template_result and template_result.templates_failed > 0)
    if has_failures:
        sys.exit(1)


__all__ = ["sync"]
