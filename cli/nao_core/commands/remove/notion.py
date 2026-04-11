"""Remove Notion pages from nao configuration."""

from __future__ import annotations

from typing import Annotated

from cyclopts import Parameter

from nao_core.commands.add.notion import _find_config_path, _load_yaml, _save_yaml
from nao_core.config.notion import extract_page_id
from nao_core.tracking import track_command
from nao_core.ui import UI


@track_command("remove_notion")
def notion(
    pages: Annotated[
        list[str],
        Parameter(
            help="Notion page URLs or IDs to remove.",
            show=True,
        ),
    ],
) -> None:
    """Remove Notion pages from nao configuration.

    Examples:
      nao remove notion abc123def456
      nao remove notion https://www.notion.so/naolabs/My-Page-abc123
    """
    try:
        config_path = _find_config_path()
    except FileNotFoundError as e:
        UI.error(str(e))
        return

    data = _load_yaml(config_path)
    if data is None:
        UI.error("nao_config.yaml is empty.")
        return

    if "notion" not in data or data["notion"] is None:
        UI.error("No Notion configuration found.")
        return

    notion_config = data["notion"]
    if "pages" not in notion_config or not notion_config["pages"]:
        UI.error("No Notion pages configured.")
        return

    # Build a map of page_id -> index for existing pages
    existing_pages = list(notion_config["pages"])
    id_to_index: dict[str, int] = {}
    for i, page in enumerate(existing_pages):
        try:
            pid = extract_page_id(str(page))
            id_to_index[pid] = i
        except ValueError:
            pass

    removed: list[str] = []
    has_errors = False
    indices_to_remove: set[int] = set()

    for page in pages:
        try:
            page_id = extract_page_id(page)
        except ValueError:
            has_errors = True
            UI.error(f"Invalid Notion page URL or ID: {page}")
            continue

        if page_id in id_to_index:
            indices_to_remove.add(id_to_index[page_id])
            removed.append(page_id)
        else:
            UI.warn(f"Page {page_id} not found in configuration, skipping.")

    if not removed:
        if not has_errors:
            UI.info("No pages to remove.")
        return

    # Remove pages by index (reverse order to preserve indices)
    new_pages = [p for i, p in enumerate(existing_pages) if i not in indices_to_remove]
    notion_config["pages"] = new_pages

    try:
        _save_yaml(config_path, data)
    except OSError as e:
        UI.error(f"Failed to save config: {e}")
        return

    for page_id in removed:
        UI.success(f"Removed page {page_id}")

    UI.info(f"{len(removed)} page(s) removed from nao_config.yaml")
