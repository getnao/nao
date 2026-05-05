"""Repository sync provider implementation."""

import re
import shutil
import subprocess
from pathlib import Path, PurePosixPath
from typing import Any

from rich.console import Console

from nao_core.commands.sync.cleanup import cleanup_stale_repos
from nao_core.config import NaoConfig
from nao_core.config.repos import RepoConfig

from ..base import SyncProvider, SyncResult

console = Console()


def clone_or_pull_repo(repo: RepoConfig, base_path: Path) -> bool:
    """Clone a repository and strip .git/ so files are tracked as regular content."""
    repo_path = base_path / repo.name
    tmp_path = base_path / f"{repo.name}.tmp"

    try:
        # Guard against path traversal via malicious repo.name (e.g. "../other")
        if not repo_path.resolve().is_relative_to(base_path.resolve()):
            console.print(f"  [yellow]⚠[/yellow] Invalid repo path: {repo.name}")
            return False

        action = "Re-cloning" if repo_path.exists() else "Cloning"
        console.print(f"  [dim]{action}[/dim] {repo.name}")

        if tmp_path.exists():
            shutil.rmtree(tmp_path)

        cmd = ["git", "clone"]
        if repo.branch:
            cmd.extend(["-b", repo.branch])
        if repo.url:
            cmd.extend([repo.url, str(tmp_path)])

        result = subprocess.run(
            cmd,
            capture_output=True,
            text=True,
            check=False,
        )

        if result.returncode != 0:
            console.print(f"  [yellow]⚠[/yellow] Failed to clone {repo.name}: {result.stderr.strip()}")
            shutil.rmtree(tmp_path, ignore_errors=True)
            return False

        # Strip .git/ so parent repo tracks files as regular content, not a gitlink
        git_dir = tmp_path / ".git"
        if git_dir.exists():
            shutil.rmtree(git_dir)

        # Atomic swap: only replace existing repo after successful clone
        if repo_path.exists():
            shutil.rmtree(repo_path)
        tmp_path.rename(repo_path)

        return True

    except Exception as e:
        console.print(f"  [yellow]⚠[/yellow] Error syncing {repo.name}: {e}")
        shutil.rmtree(tmp_path, ignore_errors=True)
        return False


def _glob_to_regex(pattern: str) -> re.Pattern[str]:
    """Convert a path-aware glob pattern to a compiled regex.

    Handles ** as zero-or-more directory levels. Segments are split on /
    so that * only matches within a single path component.
    """
    segments = pattern.split("/")
    regex_parts: list[str] = []

    for i, seg in enumerate(segments):
        if seg == "**":
            if i == len(segments) - 1:
                regex_parts.append(".*")
            else:
                regex_parts.append("(?:.+/)?")
        else:
            part = ""
            for ch in seg:
                if ch == "*":
                    part += "[^/]*"
                elif ch == "?":
                    part += "[^/]"
                elif ch in r"\.[{()+^$|":
                    part += "\\" + ch
                else:
                    part += ch
            regex_parts.append(part + ("/" if i < len(segments) - 1 else ""))

    return re.compile("^" + "".join(regex_parts) + "$")


def _matches_single_pattern(relative_path: str, pattern: str) -> bool:
    """Match a single glob pattern against a relative file path.

    Patterns without / are matched against the filename only (any depth).
    Patterns with / are matched against the full path with ** support.
    """
    if "/" not in pattern:
        filename = relative_path.rsplit("/", 1)[-1] if "/" in relative_path else relative_path
        return _glob_to_regex(pattern).match(filename) is not None
    return _glob_to_regex(pattern).match(relative_path) is not None


def _matches_patterns(relative_path: str, include: list[str], exclude: list[str]) -> bool:
    """Check if a relative file path matches include/exclude glob patterns."""
    if include:
        if not any(_matches_single_pattern(relative_path, p) for p in include):
            return False

    if exclude:
        if any(_matches_single_pattern(relative_path, p) for p in exclude):
            return False

    return True


def sync_local_repo(repo: RepoConfig, base_path: Path) -> bool:
    """Sync a local path repository by copying matching files."""
    assert repo.local_path is not None

    source_path = Path(repo.local_path).resolve()
    repo_path = base_path / repo.name

    try:
        if not source_path.exists():
            console.print(f"  [yellow]⚠[/yellow] Local path does not exist: {source_path}")
            return False

        if not source_path.is_dir():
            console.print(f"  [yellow]⚠[/yellow] Local path is not a directory: {source_path}")
            return False

        console.print(f"  [dim]Syncing local path[/dim] {repo.name} [dim]from[/dim] {source_path}")

        if repo_path.exists():
            shutil.rmtree(repo_path)

        has_filters = bool(repo.include or repo.exclude)

        if not has_filters:
            shutil.copytree(source_path, repo_path, dirs_exist_ok=True)
        else:
            repo_path.mkdir(parents=True, exist_ok=True)
            for file_path in source_path.rglob("*"):
                if not file_path.is_file():
                    continue

                relative = PurePosixPath(file_path.relative_to(source_path)).as_posix()
                if not _matches_patterns(relative, repo.include, repo.exclude):
                    continue

                dest = repo_path / relative
                dest.parent.mkdir(parents=True, exist_ok=True)
                shutil.copy2(file_path, dest)

        return True

    except Exception as e:
        console.print(f"  [yellow]⚠[/yellow] Error syncing local path {repo.name}: {e}")
        return False


def sync_repo(repo: RepoConfig, base_path: Path) -> bool:
    """Sync a single repository — dispatches to git clone/pull or local copy."""
    if repo.is_local:
        return sync_local_repo(repo, base_path)
    return clone_or_pull_repo(repo, base_path)


class RepositorySyncProvider(SyncProvider):
    """Provider for syncing repositories (git and local path)."""

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
        cleanup_stale_repos(config.repos, output_path, verbose=True)

    def get_items(self, config: NaoConfig) -> list[RepoConfig]:
        return config.repos

    def sync(self, items: list[Any], output_path: Path, project_path: Path | None = None) -> SyncResult:
        if not items:
            return SyncResult(provider_name=self.name, items_synced=0)

        output_path.mkdir(parents=True, exist_ok=True)
        success_count = 0

        console.print(f"\n[bold cyan]{self.emoji} Syncing {self.name}[/bold cyan]")
        console.print(f"[dim]Location:[/dim] {output_path.absolute()}\n")

        for repo in items:
            if sync_repo(repo, output_path):
                success_count += 1
                console.print(f"  [green]✓[/green] {repo.name}")

        return SyncResult(provider_name=self.name, items_synced=success_count)
