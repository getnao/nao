"""Sync command for synchronizing repositories and database schemas."""

import sys
from pathlib import Path

from rich.console import Console

from nao_core.config import NaoConfig

from .databases import sync_databases
from .repositories import sync_repositories

console = Console()


def sync(output_dir: str = "databases", repos_dir: str = "repos"):
    """Sync repositories and database schemas to local files.

    Creates folder structures:
      - repos/<repo_name>/         (git repositories)
      - databases/bigquery/<connection>/<dataset>/<table>/*.md  (database schemas)

    Args:
            output_dir: Output directory for database schemas (default: "databases")
            repos_dir: Output directory for repositories (default: "repos")
    """
    console.print("\n[bold cyan]🔄 nao sync[/bold cyan]\n")

    config = NaoConfig.try_load()
    if not config:
        console.print("[bold red]✗[/bold red] No nao_config.yaml found in current directory")
        console.print("[dim]Run 'nao init' to create a configuration file[/dim]")
        sys.exit(1)

    console.print(f"[dim]Project:[/dim] {config.project_name}")

    repos_synced = 0
    if config.repos:
        repos_path = Path(repos_dir)
        repos_synced = sync_repositories(config.repos, repos_path)

    db_path = Path(output_dir)
    datasets_synced, tables_synced = sync_databases(config.databases, db_path)

    console.print("\n[bold green]✓ Sync Complete[/bold green]\n")

    if repos_synced > 0:
        console.print(f"  [dim]Repositories:[/dim] {repos_synced} synced")

    if tables_synced > 0:
        console.print(f"  [dim]Databases:[/dim] {tables_synced} tables across {datasets_synced} datasets")

    if repos_synced == 0 and tables_synced == 0:
        console.print("  [dim]Nothing to sync[/dim]")

    console.print()


__all__ = ["sync"]
