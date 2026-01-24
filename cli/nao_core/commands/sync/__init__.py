"""Sync command for synchronizing repositories and database schemas."""

import sys
from pathlib import Path

from rich.console import Console

from nao_core.config import NaoConfig

from .providers import SyncProvider, SyncResult, get_all_providers

console = Console()


def sync(
    output_dirs: dict[str, str] | None = None,
    providers: list[SyncProvider] | None = None,
):
    """Sync resources using configured providers.

    Creates folder structures based on each provider's default output directory:
      - repos/<repo_name>/         (git repositories)
      - databases/<type>/<connection>/<dataset>/<table>/*.md  (database schemas)

    Args:
            output_dirs: Optional dict mapping provider names to custom output directories.
                                     If not specified, uses each provider's default_output_dir.
            providers: Optional list of providers to use. If not specified, uses all
                               registered providers.
    """
    console.print("\n[bold cyan]🔄 nao sync[/bold cyan]\n")

    config = NaoConfig.try_load()
    if config is None:
        console.print("[bold red]✗[/bold red] No nao_config.yaml found in current directory")
        console.print("[dim]Run 'nao init' to create a configuration file[/dim]")
        sys.exit(1)

    console.print(f"[dim]Project:[/dim] {config.project_name}")

    # Use provided providers or default to all registered providers
    active_providers = providers if providers is not None else get_all_providers()
    output_dirs = output_dirs or {}

    # Run each provider
    results: list[SyncResult] = []
    for provider in active_providers:
        if config is None or not provider.should_sync(config):
            continue

        # Get output directory (custom or default)
        output_dir = output_dirs.get(provider.name, provider.default_output_dir)
        output_path = Path(output_dir)

        # Get items and sync
        items = provider.get_items(config)
        result = provider.sync(items, output_path)
        results.append(result)

    # Print summary
    console.print("\n[bold green]✓ Sync Complete[/bold green]\n")

    has_results = False
    for result in results:
        if result.items_synced > 0:
            has_results = True
            console.print(f"  [dim]{result.provider_name}:[/dim] {result.get_summary()}")

    if not has_results:
        console.print("  [dim]Nothing to sync[/dim]")

    console.print()


__all__ = ["sync"]
