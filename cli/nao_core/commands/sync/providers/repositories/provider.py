"""Repository sync provider implementation."""

import shutil
import subprocess
from pathlib import Path
from typing import Any

from rich.console import Console

from nao_core.commands.sync.cleanup import cleanup_stale_repos
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


def pre_compile_dbt_docs(repo: RepoConfig, base_path: Path) -> bool:
    """Optionally compile dbt docs for a synced repository.

    This is best-effort and does not block repository sync completion.
    """
    try:
        if not repo.compile_dbt_docs:
            return True

        repo_path = base_path / repo.name
        dbt_project_file = repo_path / "dbt_project.yml"

        if not dbt_project_file.exists():
            console.print(
                f"  [yellow]⚠[/yellow] {repo.name}: `compile_dbt_docs=true` but no dbt_project.yml found, skipping"
            )
            return True

        dbt_binary = shutil.which("dbt")
        if not dbt_binary:
            console.print(
                f"  [yellow]⚠[/yellow] {repo.name}: dbt not found in PATH, cannot pre-compile docs (install dbt-core)"
            )
            return True

        cmd = [dbt_binary, "docs", "generate", "--project-dir", str(repo_path)]
        if repo.dbt_profiles_dir:
            cmd.extend(["--profiles-dir", repo.dbt_profiles_dir])

        console.print(f"  [dim]Pre-compiling dbt docs for[/dim] {repo.name}")
        result = subprocess.run(cmd, capture_output=True, text=True, check=False)

        if result.returncode != 0:
            console.print(
                f"  [yellow]⚠[/yellow] {repo.name}: `dbt docs generate` failed: {result.stderr.strip() or result.stdout.strip()}"
            )
            return True

        catalog_path = repo_path / "target" / "catalog.json"
        manifest_path = repo_path / "target" / "manifest.json"
        if catalog_path.exists() and manifest_path.exists():
            console.print(
                f"  [green]✓[/green] {repo.name} dbt docs compiled (target/catalog.json, target/manifest.json)"
            )
        else:
            console.print(
                f"  [yellow]⚠[/yellow] {repo.name}: dbt docs command succeeded but target/catalog.json or target/manifest.json was not found"
            )

        return True
    except Exception as e:
        console.print(f"  [yellow]⚠[/yellow] {repo.name}: error pre-compiling dbt docs: {e}")
        return True


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

    def pre_sync(self, config: NaoConfig, output_path: Path) -> None:
        """
        Always run before syncing.
        """

        cleanup_stale_repos(config.repos, output_path, verbose=True)

    def get_items(self, config: NaoConfig) -> list[RepoConfig]:
        return config.repos

    def sync(self, items: list[Any], output_path: Path, project_path: Path | None = None) -> SyncResult:
        """Sync all configured repositories.

        Args:
                items: List of repository configurations
                output_path: Base path where repositories are stored
                project_path: Path to the nao project root (unused for repos)

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
                pre_compile_dbt_docs(repo, output_path)
                success_count += 1
                console.print(f"  [green]✓[/green] {repo.name}")

        return SyncResult(provider_name=self.name, items_synced=success_count)
