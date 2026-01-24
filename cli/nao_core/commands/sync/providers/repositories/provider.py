"""Repository sync provider implementation."""

import subprocess
from pathlib import Path
from typing import Any

from rich.console import Console

from nao_core.config import NaoConfig
from nao_core.config.repos import RepoConfig

from ..base import SyncProvider, SyncResult

console = Console()


def clone_or_pull_repo(repo: RepoConfig, base_path: Path) -> bool:
    """Clone a repository if it doesn't exist, or pull latest changes if it does.

    Args:
            repo: Repository configuration
            base_path: Base path where repositories are stored

    Returns:
            True if successful, False otherwise
    """
    repo_path = base_path / repo.name

    try:
        if repo_path.exists():
            # Repository exists - pull latest changes
            console.print(f"  [dim]Pulling latest changes for[/dim] {repo.name}")

            result = subprocess.run(
                ["git", "pull"],
                cwd=repo_path,
                capture_output=True,
                text=True,
                check=False,
            )

            if result.returncode != 0:
                console.print(f"  [yellow]⚠[/yellow] Failed to pull {repo.name}: {result.stderr.strip()}")
                return False

            # If branch is specified, checkout that branch
            if repo.branch:
                subprocess.run(
                    ["git", "checkout", repo.branch],
                    cwd=repo_path,
                    capture_output=True,
                    text=True,
                    check=False,
                )

        else:
            # Repository doesn't exist - clone it
            console.print(f"  [dim]Cloning[/dim] {repo.name}")

            cmd = ["git", "clone"]
            if repo.branch:
                cmd.extend(["-b", repo.branch])
            cmd.extend([repo.url, str(repo_path)])

            result = subprocess.run(
                cmd,
                capture_output=True,
                text=True,
                check=False,
            )

            if result.returncode != 0:
                console.print(f"  [yellow]⚠[/yellow] Failed to clone {repo.name}: {result.stderr.strip()}")
                return False

        return True

    except Exception as e:
        console.print(f"  [yellow]⚠[/yellow] Error syncing {repo.name}: {e}")
        return False


class RepositorySyncProvider(SyncProvider):
    """Provider for syncing git repositories."""

    @property
    def name(self) -> str:
        return "Repositories"

    @property
    def emoji(self) -> str:
        return "📦"

    @property
    def default_output_dir(self) -> str:
        return "repos"

    def get_items(self, config: NaoConfig) -> list[RepoConfig]:
        return config.repos

    def sync(self, items: list[Any], output_path: Path) -> SyncResult:
        """Sync all configured repositories.

        Args:
                items: List of repository configurations
                output_path: Base path where repositories are stored

        Returns:
                SyncResult with number of successfully synced repositories
        """
        if not items:
            return SyncResult(provider_name=self.name, items_synced=0)

        output_path.mkdir(parents=True, exist_ok=True)
        success_count = 0

        console.print(f"\n[bold cyan]{self.emoji} Syncing {self.name}[/bold cyan]")
        console.print(f"[dim]Location:[/dim] {output_path.absolute()}\n")

        for repo in items:
            if clone_or_pull_repo(repo, output_path):
                success_count += 1
                console.print(f"  [green]✓[/green] {repo.name}")

        return SyncResult(provider_name=self.name, items_synced=success_count)
