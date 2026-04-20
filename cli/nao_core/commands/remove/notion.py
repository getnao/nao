"""Remove Notion pages from nao configuration."""

from __future__ import annotations

from typing import Annotated

from cyclopts import Parameter

from nao_core.config.notion import (
    extract_page_id,
    find_config_path,
    load_yaml,
    run_notion_sync,
    save_yaml,
)
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
    *,
    sync: Annotated[
        bool,
        Parameter(
            name=["--sync"],
            help="Run sync after removing pages.",
        ),
    ] = True,
) -> None:
    """Remove Notion pages from nao configuration.

    Examples:
      nao remove notion abc123def456
      nao remove notion https://www.notion.so/naolabs/My-Page-abc123 --no-sync
    """
    try:
        config_path = find_config_path()
    except FileNotFoundError as e:
        UI.error(str(e))
        return

    data = load_yaml(config_path)
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

    # Build a map of page_id -> all indices for existing pages
    existing_pages = list(notion_config["pages"])
    id_to_indices: dict[str, list[int]] = {}
    for i, page in enumerate(existing_pages):
        try:
            pid = extract_page_id(str(page))
            id_to_indices.setdefault(pid, []).append(i)
        except ValueError:
            pass

    removed: list[str] = []
    seen_ids: set[str] = set()
    has_errors = False
    indices_to_remove: set[int] = set()

    for page in pages:
        try:
            page_id = extract_page_id(page)
        except ValueError:
            has_errors = True
            UI.error(f"Invalid Notion page URL or ID: {page}")
            continue

        if page_id in seen_ids:
            continue
        seen_ids.add(page_id)

        if page_id in id_to_indices:
            indices_to_remove.update(id_to_indices[page_id])
            removed.append(page_id)
        else:
            UI.warn(f"Page {page_id} not found in configuration, skipping.")

    if not removed:
        if not has_errors:
            UI.info("No pages to remove.")
        return

    # Remove pages by index
    new_pages = [p for i, p in enumerate(existing_pages) if i not in indices_to_remove]
    notion_config["pages"] = new_pages

    try:
        save_yaml(config_path, data)
    except OSError as e:
        UI.error(f"Failed to save config: {e}")
        return

    for page_id in removed:
        UI.success(f"Removed page {page_id}")

    UI.info(f"{len(removed)} page(s) removed from nao_config.yaml")

    if sync and removed:
        from nao_core.deps import _is_extra_installed

        if not _is_extra_installed("notion"):
            UI.warn("Notion extras not installed. Skipping sync.")
            UI.info("Install with: pip install 'nao-core[notion]'")
            return
        UI.print()
        run_notion_sync()
