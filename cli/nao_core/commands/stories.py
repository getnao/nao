import json
from pathlib import Path
from typing import Annotated, Any

from cyclopts import App, Parameter

from nao_core.ui import UI

from .migration_client import MigrationClient, MigrationError

stories = App(name="stories", help="Create and organize nao stories.")


@stories.command
def folders(
    *,
    project_id: str | None = None,
    json_output: Annotated[bool, Parameter(name="--json")] = False,
) -> None:
    """List story folders."""
    result = _client(project_id, json_output).request("GET", "/story-folders")
    if json_output:
        _print_json(result)
        return
    for folder in result["folders"]:
        UI.print(f"{folder['id']}\t{folder['name']}")


@stories.command(name="create-folder")
def create_folder(
    name: str,
    *,
    parent_id: str | None = None,
    public_root: Annotated[bool, Parameter(name="--public-root")] = False,
    project_id: str | None = None,
    json_output: Annotated[bool, Parameter(name="--json")] = False,
) -> None:
    """Create a story folder."""
    if parent_id is not None and public_root:
        raise MigrationError("--parent-id and --public-root cannot be used together.")
    body: dict[str, Any] = {"name": name}
    if parent_id is not None or public_root:
        body["parent_id"] = parent_id
    result = _client(project_id, json_output).request(
        "POST",
        "/story-folders",
        body=body,
    )
    if json_output:
        _print_json(result)
        return
    folder = result["folder"]
    UI.print(f"{folder['id']}\t{folder['name']}")


@stories.command
def create(
    *,
    title: Annotated[str, Parameter(name="--title")],
    content_file: Annotated[Path, Parameter(name="--content-file")],
    folder_id: str | None = None,
    project_id: str | None = None,
    json_output: Annotated[bool, Parameter(name="--json")] = False,
) -> None:
    """Create a standalone story from a markdown file."""
    body: dict[str, Any] = {"title": title, "code": _read_content(content_file)}
    if folder_id is not None:
        body["folder_id"] = folder_id
    result = _client(project_id, json_output).request("POST", "/stories", body=body)
    if json_output:
        _print_json(result)
        return
    story = result["story"]
    UI.print(f"{story['id']}\t{story['title']}")


@stories.command
def update(
    story_id: str,
    *,
    title: str | None = None,
    content_file: Path | None = None,
    project_id: str | None = None,
    json_output: Annotated[bool, Parameter(name="--json")] = False,
) -> None:
    """Update a story by UUID."""
    if title is None and content_file is None:
        raise MigrationError("Provide --title or --content-file.")
    body: dict[str, Any] = {}
    if title is not None:
        body["title"] = title
    if content_file is not None:
        body["code"] = _read_content(content_file)
    result = _client(project_id, json_output).request("PATCH", f"/stories/{story_id}", body=body)
    if json_output:
        _print_json(result)
        return
    story = result["story"]
    UI.print(f"{story['id']}\t{story['title']}")


@stories.command
def move(
    story_id: str,
    *,
    folder_id: str | None = None,
    project_id: str | None = None,
    json_output: Annotated[bool, Parameter(name="--json")] = False,
) -> None:
    """Move a story to a folder, or to public root when no folder is provided."""
    result = _client(project_id, json_output).request(
        "POST",
        f"/stories/{story_id}/move",
        body={"folder_id": folder_id},
    )
    if json_output:
        _print_json(result)
        return
    UI.print(f"{result['storyId']}\t{result['folderId'] or 'public root'}")


def _read_content(path: Path) -> str:
    try:
        return path.read_text(encoding="utf-8")
    except (OSError, UnicodeError) as error:
        raise MigrationError(f"Could not read content file: {path}") from error


def _client(project_id: str | None, noninteractive: bool) -> MigrationClient:
    return MigrationClient(project_id=project_id, noninteractive=noninteractive)


def _print_json(result: dict[str, Any]) -> None:
    print(json.dumps(result, separators=(",", ":")))


__all__ = ["stories"]
