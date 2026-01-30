"""Sync command for synchronizing repositories and database schemas."""

import sys
from pathlib import Path

from rich.console import Console

from nao_core.config import NaoConfig
from nao_core.templates.render import render_all_templates

from .providers import SyncProvider, SyncResult, get_all_providers

console = Console()


def sync(
    output_dirs: dict[str, str] | None = None,
    providers: list[SyncProvider] | None = None,
    render_templates: bool = True,
):
    """Sync resources using configured providers.

    Creates folder structures based on each provider's default output directory:
      - repos/<repo_name>/         (git repositories)
      - databases/<type>/<connection>/<dataset>/<table>/*.md  (database schemas)

    After syncing providers, renders any Jinja templates (*.j2 files) found in
    the project directory, making the `nao` context object available for
    accessing provider data.

    Args:
            output_dirs: Optional dict mapping provider names to custom output directories.
                                     If not specified, uses each provider's default_output_dir.
            providers: Optional list of providers to use. If not specified, uses all
                               registered providers.
            render_templates: Whether to render Jinja templates after syncing providers.
                                              Defaults to True.
    """
    console.print("\n[bold cyan]🔄 nao sync[/bold cyan]\n")

    config = NaoConfig.try_load()
    if config is None:
        console.print("[bold red]✗[/bold red] No nao_config.yaml found in current directory")
        console.print("[dim]Run 'nao init' to create a configuration file[/dim]")
        sys.exit(1)
    assert config is not None  # Help type checker after sys.exit

    # Get project path (current working directory after NaoConfig.try_load)
    project_path = Path.cwd()

    console.print(f"[dim]Project:[/dim] {config.project_name}")

    # Use provided providers or default to all registered providers
    active_providers = providers if providers is not None else get_all_providers()
    output_dirs = output_dirs or {}

    # Run each provider
    results: list[SyncResult] = []
    for provider in active_providers:
        # Get output directory (custom or default)
        output_dir = output_dirs.get(provider.name, provider.default_output_dir)
        output_path = Path(output_dir)

        try:
            provider.pre_sync(config, output_path)

            if not provider.should_sync(config):
                continue

            # Get items and sync
            items = provider.get_items(config)
            result = provider.sync(items, output_path, project_path=project_path)
            results.append(result)
        except Exception as e:
            # Capture error but continue with other providers
            results.append(SyncResult.from_error(provider.name, e))
            console.print(f"  [yellow]⚠[/yellow] {provider.emoji} {provider.name}: [red]{e}[/red]")

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


__all__ = ["sync"]
