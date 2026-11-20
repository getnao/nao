"""Git-based context provider."""

import subprocess
from pathlib import Path

from rich.console import Console

from .base import ContextProvider

console = Console()


def resolve_repo_root(target: Path, subpath: str | None) -> Path:
    """Return the clone root for ``target``.

    Callers (e.g. docker/entrypoint.sh) may already point ``target`` at the
    project subdirectory inside the clone, so strip the subpath off when it is
    the trailing part of the path — unless ``target`` is itself a clone, since
    a clone root may legitimately be named like the subpath. The subpath is
    normalized here, so ``"/nao/"`` and ``"nao"`` are the same, while ``"."``
    means no subpath.
    """
    subpath = (subpath or "").strip("/")
    if subpath in ("", "."):
        return target
    if (target / ".git").exists():
        return target
    parts = Path(subpath).parts
    if parts and target.parts[-len(parts) :] == parts:
        return target.parents[len(parts) - 1]
    return target


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
        subpath: str | None = None,
    ):
        """Initialize the git context provider.

        Args:
            repo_url: Git repository URL (https:// or git@).
            target_path: Local path where repo will be cloned (may already be
                the project subdirectory, see ``subpath``).
            branch: Branch to clone/pull (default: 'main').
            token: Auth token for private repos (optional).
            subpath: nao project directory inside the repository (optional);
                ``"."`` means the repository root.
        """
        subpath = (subpath or "").strip("/")
        self.subpath = subpath if subpath and subpath != "." else None
        self.repo_root = resolve_repo_root(Path(target_path), self.subpath)
        super().__init__(self.repo_root / self.subpath if self.subpath else self.repo_root)
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
        if (self.repo_root / ".git").exists():
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

        Uses shallow clone (--depth 1) for faster initial setup; with a subpath
        only that directory is checked out.
        """
        console.print(f"[cyan]Cloning context from {self.repo_url}...[/cyan]")

        # Ensure parent directory exists
        self.repo_root.parent.mkdir(parents=True, exist_ok=True)

        # Remove target if it exists but isn't a git repo
        if self.repo_root.exists() and not (self.repo_root / ".git").exists():
            if self.subpath:
                raise RuntimeError(
                    f"{self.repo_root} exists but is not a git repository; refusing to "
                    "delete it. Remove it by hand if it is stale."
                )
            import shutil

            shutil.rmtree(self.repo_root)

        cmd = [
            "git",
            "clone",
            "--branch",
            self.branch,
            "--depth",
            "1",
            "--single-branch",
        ]
        if self.subpath:
            cmd += ["--filter=blob:none", "--sparse"]
        cmd += [self._get_auth_url(), str(self.repo_root)]

        try:
            subprocess.run(
                cmd,
                check=True,
                capture_output=True,
                text=True,
            )
            if self.subpath:
                subprocess.run(
                    ["git", "sparse-checkout", "set", self.subpath],
                    cwd=self.repo_root,
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

        A missing project directory only needs reporting: the clone still
        fetches, so an upstream restore is picked up by the next refresh.

        Returns:
            True if changes were pulled, False if already up-to-date.

        Raises:
            subprocess.CalledProcessError: If git pull fails.
            RuntimeError: If the upstream project directory is missing.
        """
        if not (self.repo_root / ".git").exists():
            console.print("[yellow]Context not initialized, running init instead[/yellow]")
            self.init()
            return True

        console.print(f"[cyan]Refreshing context from {self.repo_url}...[/cyan]")

        try:
            # Fetch with the auth URL
            subprocess.run(
                ["git", "fetch", self._get_auth_url(), self.branch],
                cwd=self.repo_root,
                check=True,
                capture_output=True,
                text=True,
            )

            # Check if there are changes
            diff_result = subprocess.run(
                ["git", "diff", "HEAD..FETCH_HEAD", "--stat"],
                cwd=self.repo_root,
                capture_output=True,
                text=True,
            )

            updated = bool(diff_result.stdout.strip())
            if updated:
                subprocess.run(
                    ["git", "reset", "--hard", "FETCH_HEAD"],
                    cwd=self.repo_root,
                    check=True,
                    capture_output=True,
                )
                console.print("[green]✓[/green] Context updated")
            else:
                console.print("[dim]Context already up-to-date[/dim]")

        except subprocess.CalledProcessError as e:
            error_msg = e.stderr.replace(self.token, "***") if self.token else e.stderr
            console.print(f"[red]✗[/red] Failed to refresh context: {error_msg}")
            raise

        if not self.target_path.exists():
            raise RuntimeError(
                f"{self.target_path} is missing from the clone: the upstream project "
                "directory no longer exists. Restore it upstream; re-cloning would not help."
            )

        return updated

    def is_initialized(self) -> bool:
        """Check if repository has been cloned and the project dir is present.

        Returns:
            True if .git exists at the clone root and the project directory
            (``repo_root`` for root-level deployments) exists.
        """
        return (self.repo_root / ".git").exists() and self.target_path.exists()
