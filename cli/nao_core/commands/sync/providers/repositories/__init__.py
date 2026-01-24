"""Repository syncing functionality for cloning and pulling git repositories."""

import subprocess
from pathlib import Path

from rich.console import Console

from nao_core.config.repos import RepoConfig

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


def sync_repositories(repos: list[RepoConfig], base_path: Path) -> int:
    """Sync all configured repositories.

    Args:
            repos: List of repository configurations
            base_path: Base path where repositories are stored

    Returns:
            Number of successfully synced repositories
    """
    if not repos:
        return 0

    base_path.mkdir(parents=True, exist_ok=True)
    success_count = 0

    console.print("\n[bold cyan]📦 Syncing Repositories[/bold cyan]")
    console.print(f"[dim]Location:[/dim] {base_path.absolute()}\n")

    for repo in repos:
        if clone_or_pull_repo(repo, base_path):
            success_count += 1
            console.print(f"  [green]✓[/green] {repo.name}")

    return success_count
