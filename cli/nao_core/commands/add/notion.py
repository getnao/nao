"""Add Notion pages to nao configuration without hand-editing YAML."""

from __future__ import annotations

from pathlib import Path
from typing import Annotated

from cyclopts import Parameter

from nao_core.config.notion import extract_page_id
from nao_core.tracking import track_command
from nao_core.ui import UI, ask_text


def _find_config_path() -> Path:
    """Find the nao_config.yaml file path, raising if missing."""
    import os

    default_path = os.environ.get("NAO_DEFAULT_PROJECT_PATH")
    project_dir = Path(default_path) if default_path else Path.cwd()
    config_path = project_dir / "nao_config.yaml"
    if not config_path.exists():
        raise FileNotFoundError("No nao_config.yaml found. Run `nao init` first.")
    return config_path


def _load_yaml(config_path: Path):
    """Load YAML with ruamel for round-trip preservation."""
    from ruamel.yaml import YAML

    yaml = YAML()
    yaml.preserve_quotes = True
    with config_path.open() as f:
        return yaml.load(f)


def _save_yaml(config_path: Path, data) -> None:
    """Write YAML back preserving comments and env var templates."""
    from ruamel.yaml import YAML

    yaml = YAML()
    yaml.preserve_quotes = True
    yaml.default_flow_style = False
    with config_path.open("w") as f:
        yaml.dump(data, f)


def _get_existing_page_ids(pages: list) -> set[str]:
    """Extract normalized page IDs from the existing pages list."""
    ids: set[str] = set()
    for page in pages:
        try:
            ids.add(extract_page_id(str(page)))
        except ValueError:
            pass
    return ids


def _run_notion_sync() -> None:
    """Run nao sync for notion provider only."""
    from nao_core.commands.sync import sync

    sync(provider=["notion"], render_templates=False)


@track_command("add_notion")
def notion(
    pages: Annotated[
        list[str],
        Parameter(
            help="Notion page URLs or IDs to add.",
            show=True,
        ),
    ],
    *,
    sync: Annotated[
        bool,
        Parameter(
            name=["--sync"],
            help="Run sync after adding pages.",
        ),
    ] = True,
    api_key: Annotated[
        str | None,
        Parameter(
            name=["--api-key"],
            help="Notion API key (if not already configured).",
        ),
    ] = None,
) -> None:
    """Add Notion pages to nao configuration.

    Examples:
      nao add notion https://www.notion.so/naolabs/My-Page-abc123
      nao add notion abc123def456 789abc012def --no-sync
    """
    try:
        config_path = _find_config_path()
    except FileNotFoundError as e:
        UI.error(str(e))
        return

    data = _load_yaml(config_path)
    if data is None:
        UI.error("nao_config.yaml is empty. Run `nao init` first.")
        return

    # Ensure notion section exists
    if "notion" not in data or data["notion"] is None:
        key = api_key or ask_text("Notion API key:", password=True, required_field=True)
        if not key:
            UI.error("API key is required to set up Notion.")
            return
        data["notion"] = {"api_key": key, "pages": []}

    notion_config = data["notion"]
    if "pages" not in notion_config or notion_config["pages"] is None:
        notion_config["pages"] = []

    existing_ids = _get_existing_page_ids(notion_config["pages"])
    added: list[str] = []
    has_errors = False

    for page in pages:
        try:
            page_id = extract_page_id(page)
        except ValueError:
            has_errors = True
            UI.error(f"Invalid Notion page URL or ID: {page}")
            continue

        if page_id in existing_ids:
            UI.warn(f"Page {page_id} already configured, skipping.")
            continue

        notion_config["pages"].append(page_id)
        existing_ids.add(page_id)
        added.append(page_id)

    if not added:
        if not has_errors:
            UI.info("No new pages to add.")
        return

    try:
        _save_yaml(config_path, data)
    except OSError as e:
        UI.error(f"Failed to save config: {e}")
        return

    for page_id in added:
        UI.success(f"Added page {page_id}")

    UI.info(f"{len(added)} page(s) added to nao_config.yaml")

    if sync and added:
        from nao_core.deps import _is_extra_installed

        if not _is_extra_installed("notion"):
            UI.warn("Notion extras not installed. Skipping sync.")
            UI.info("Install with: pip install 'nao-core[notion]'")
            return
        UI.print()
        _run_notion_sync()
