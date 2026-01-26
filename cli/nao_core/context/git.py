"""Git-based context provider."""

import subprocess
from pathlib import Path

from rich.console import Console

from .base import ContextProvider

console = Console()


class GitContextProvider(ContextProvider):
    """Context provider that clones/pulls from a git repository.

    This provider enables containerized deployments without volume mounts
    by fetching context from a git repository on startup and refresh.
    """

    def __init__(
        self,
        repo_url: str,
        target_path: Path,
        branch: str = "main",
        token: str | None = None,
    ):
        """Initialize the git context provider.

        Args:
            repo_url: Git repository URL (https:// or git@).
            target_path: Local path where repo will be cloned.
            branch: Branch to clone/pull (default: 'main').
            token: Auth token for private repos (optional).
        """
        super().__init__(target_path)
        self.repo_url = repo_url
        self.branch = branch
        self.token = token

    def _get_auth_url(self) -> str:
        """Inject token into URL for private repos.

        Returns:
            Repository URL with token if provided, original URL otherwise.
        """
        if not self.token:
            return self.repo_url

        # Handle HTTPS URLs
        if self.repo_url.startswith("https://"):
            # https://github.com/org/repo → https://token@github.com/org/repo
            return self.repo_url.replace("https://", f"https://{self.token}@")

        # For SSH URLs or other formats, return as-is
        return self.repo_url

    def init(self) -> None:
        """Clone the repository if not exists, otherwise pull.

        Raises:
            subprocess.CalledProcessError: If git command fails.
            ValueError: If cloned repo doesn't contain nao_config.yaml.
        """
        if self.is_initialized():
            console.print(f"[dim]Context already initialized at {self.target_path}[/dim]")
            self.refresh()
        else:
            self._clone()

        if not self.validate():
            raise ValueError(
                "nao_config.yaml not found in cloned repository.\n"
                "Ensure the repository contains a valid nao project at its root."
            )

    def _clone(self) -> None:
        """Clone the repository.

        Uses shallow clone (--depth 1) for faster initial setup.
        """
        console.print(f"[cyan]Cloning context from {self.repo_url}...[/cyan]")

        # Ensure parent directory exists
        self.target_path.parent.mkdir(parents=True, exist_ok=True)

        # Remove target if it exists but isn't a git repo
        if self.target_path.exists() and not (self.target_path / ".git").exists():
            import shutil

            shutil.rmtree(self.target_path)

        cmd = [
            "git",
            "clone",
            "--branch",
            self.branch,
            "--depth",
            "1",
            "--single-branch",
            self._get_auth_url(),
            str(self.target_path),
        ]

        try:
            subprocess.run(
                cmd,
                check=True,
                capture_output=True,
                text=True,
            )
            console.print(f"[green]✓[/green] Context cloned to {self.target_path}")
        except subprocess.CalledProcessError as e:
            # Sanitize error message to not expose token
            error_msg = e.stderr.replace(self.token, "***") if self.token else e.stderr
            console.print(f"[red]✗[/red] Failed to clone repository: {error_msg}")
            raise

    def refresh(self) -> bool:
        """Pull latest changes from the repository.

        Returns:
            True if changes were pulled, False if already up-to-date.

        Raises:
            subprocess.CalledProcessError: If git pull fails.
        """
        if not self.is_initialized():
            console.print("[yellow]Context not initialized, running init instead[/yellow]")
            self.init()
            return True

        console.print(f"[cyan]Refreshing context from {self.repo_url}...[/cyan]")

        try:
            # Fetch with the auth URL
            subprocess.run(
                ["git", "fetch", self._get_auth_url(), self.branch],
                cwd=self.target_path,
                check=True,
                capture_output=True,
                text=True,
            )

            # Check if there are changes
            diff_result = subprocess.run(
                ["git", "diff", "HEAD..FETCH_HEAD", "--stat"],
                cwd=self.target_path,
                capture_output=True,
                text=True,
            )

            if diff_result.stdout.strip():
                # There are changes, do a hard reset to FETCH_HEAD
                subprocess.run(
                    ["git", "reset", "--hard", "FETCH_HEAD"],
                    cwd=self.target_path,
                    check=True,
                    capture_output=True,
                )
                console.print("[green]✓[/green] Context updated")
                return True
            else:
                console.print("[dim]Context already up-to-date[/dim]")
                return False

        except subprocess.CalledProcessError as e:
            error_msg = e.stderr.replace(self.token, "***") if self.token else e.stderr
            console.print(f"[red]✗[/red] Failed to refresh context: {error_msg}")
            raise

    def is_initialized(self) -> bool:
        """Check if repository has been cloned.

        Returns:
            True if .git directory exists at target path.
        """
        return (self.target_path / ".git").exists()
