import io
import tarfile
from pathlib import Path
from typing import Annotated, cast

import httpx
import yaml
from cyclopts import Parameter

from nao_core.tracking import track_command
from nao_core.ui import UI

DEFAULT_EXCLUSIONS = {
    ".git",
    "__pycache__",
    "node_modules",
    ".venv",
    ".env",
    "*.pyc",
}


def _load_naoignore(project_path: Path) -> set[str]:
    ignore_file = project_path / ".naoignore"
    if not ignore_file.exists():
        return set()
    patterns = set()
    for line in ignore_file.read_text().splitlines():
        stripped = line.strip()
        if stripped and not stripped.startswith("#"):
            patterns.add(stripped)
    return patterns


def _should_exclude(rel_path: Path, exclusions: set[str]) -> bool:
    for part in rel_path.parts:
        if part in exclusions:
            return True
    name = rel_path.name
    for pattern in exclusions:
        if pattern.startswith("*.") and name.endswith(pattern[1:]):
            return True
    return False


def _build_tarball(project_path: Path, exclusions: set[str]) -> bytes:
    buf = io.BytesIO()
    with tarfile.open(fileobj=buf, mode="w:gz") as tar:
        for file_path in sorted(project_path.rglob("*")):
            if not file_path.is_file():
                continue
            rel = file_path.relative_to(project_path)
            if _should_exclude(rel, exclusions):
                continue
            tar.add(file_path, arcname=str(rel))
    buf.seek(0)
    return buf.read()


def _read_project_name(project_path: Path) -> str | None:
    """Read project_name from nao_config.yaml without resolving env vars."""
    config_file = project_path / "nao_config.yaml"
    if not config_file.exists():
        UI.error("No nao_config.yaml found in current directory")
        return None
    try:
        data = yaml.safe_load(config_file.read_text())
    except yaml.YAMLError as e:
        UI.error(f"Failed to load nao_config.yaml: Invalid YAML syntax: {e}")
        return None
    name = data.get("project_name") if isinstance(data, dict) else None
    if not name:
        UI.error("nao_config.yaml is missing a 'project_name' field")
        return None
    return name


@track_command("deploy")
def deploy(
    url: Annotated[str, Parameter(help="Remote nao instance URL")],
    api_key: Annotated[str, Parameter(help="API key for authentication", name=["--api-key", "-k"])],
    path: Annotated[
        Path | None,
        Parameter(help="Project directory (defaults to current directory)", name=["--path", "-p"]),
    ] = None,
    dry_run: Annotated[
        bool,
        Parameter(help="Validate and preview user group changes without deploying", name="--dry-run"),
    ] = False,
) -> None:
    """Deploy project context to a remote nao instance."""
    project_path = path or Path.cwd()
    project_name = _read_project_name(project_path)
    if project_name is None:
        return

    UI.print(f"\n[bold]Deploying[/bold] [cyan]{project_name}[/cyan] to [cyan]{url}[/cyan]\n")

    exclusions = DEFAULT_EXCLUSIONS | _load_naoignore(project_path)

    UI.print("[dim]Packaging project files...[/dim]")
    tarball = _build_tarball(project_path, exclusions)
    size_mb = len(tarball) / (1024 * 1024)
    UI.print(f"[dim]Package size: {size_mb:.1f} MB[/dim]")

    deploy_url = f"{url.rstrip('/')}/api/deploy"

    UI.print("[dim]Uploading...[/dim]")
    try:
        response = httpx.post(
            deploy_url,
            headers={"Authorization": f"Bearer {api_key}"},
            files={"context": ("context.tar.gz", tarball, "application/gzip")},
            params={"dryRun": "true"} if dry_run else None,
            timeout=120.0,
        )
    except httpx.ConnectError:
        UI.error(f"Could not connect to {url}")
        UI.print("[dim]Check the URL and ensure the nao instance is running.[/dim]")
        return
    except httpx.TimeoutException:
        UI.error("Request timed out")
        return

    if response.status_code == 401:
        UI.error("Authentication failed. Check your API key.")
        return

    if response.status_code != 200:
        UI.error(f"Deploy failed ({response.status_code})")
        try:
            error = response.json().get("error", response.text)
        except Exception:
            error = response.text
        UI.print(f"[red]{error}[/red]")
        return

    result = response.json()
    status = result.get("status", "unknown")

    if status == "dry-run":
        _print_user_group_diff(result.get("userGroups", {}))
        UI.success("Dry run completed. No files or user groups were changed.")
    elif status == "created":
        UI.success(f"Project [cyan]{project_name}[/cyan] {status}")
    else:
        UI.warn(f"Project [cyan]{project_name}[/cyan] {status}")
    UI.print(f"[dim]Project ID: {result.get('projectId')}[/dim]")


def _print_user_group_diff(diff: object) -> None:
    if not isinstance(diff, dict):
        return
    data = cast(dict[str, object], diff)
    summary = data.get("summary")
    if isinstance(summary, dict):
        summary_data = cast(dict[str, object], summary)
        labels = ("created", "adopted", "updated", "archived", "reactivated", "unchanged")
        UI.print("[bold]User group preview[/bold]")
        UI.print("  " + ", ".join(f"{label}: {summary_data.get(label, 0)}" for label in labels))
    pending = data.get("pendingEmails")
    if isinstance(pending, list) and pending:
        UI.warn(f"Pending member emails: {', '.join(str(email) for email in pending)}")
    access_changes = data.get("accessChanges")
    if isinstance(access_changes, list) and access_changes:
        UI.warn(f"Access changes: {', '.join(str(group) for group in access_changes)}")
    budget_changes = data.get("budgetChanges")
    if isinstance(budget_changes, list) and budget_changes:
        UI.warn(f"Budget changes: {', '.join(str(group) for group in budget_changes)}")
    revocations = data.get("shareRevocations")
    if isinstance(revocations, dict):
        revocation_data = cast(dict[str, object], revocations)
        chats = revocation_data.get("chats", 0)
        stories = revocation_data.get("stories", 0)
        if chats or stories:
            UI.warn(f"Shares revoked: {chats} chats, {stories} stories")
