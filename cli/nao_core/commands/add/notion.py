"""Add Notion pages to nao configuration without hand-editing YAML."""

from __future__ import annotations

from typing import Annotated

from cyclopts import Parameter

from nao_core.config.notion import (
    extract_page_id,
    find_config_path,
    get_existing_page_ids,
    load_yaml,
    run_notion_sync,
    save_yaml,
    verify_page_accessible,
)
from nao_core.tracking import track_command
from nao_core.ui import UI, ask_text


def _resolve_api_key(notion_config, explicit_key: str | None) -> str | None:
    """Resolve the actual API key value for accessibility checks."""
    import os

    if explicit_key:
        return explicit_key
    raw_key = notion_config.get("api_key", "")
    if "${{" in str(raw_key):
        return os.environ.get("NOTION_API_KEY")
    return str(raw_key) if raw_key else None


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
        config_path = find_config_path()
    except FileNotFoundError as e:
        UI.error(str(e))
        return

    data = load_yaml(config_path)

    # Ensure notion section exists
    if "notion" not in data or data["notion"] is None:
        key = api_key or ask_text("Notion API key:", password=True, required_field=True)
        if not key:
            UI.error("API key is required to set up Notion.")
            return
        data["notion"] = {"api_key": key, "pages": []}

    notion_config = data["notion"]

    # Persist explicit api_key so sync uses the same credential as verification
    if api_key and notion_config.get("api_key") != api_key:
        notion_config["api_key"] = api_key

    if "pages" not in notion_config or notion_config["pages"] is None:
        notion_config["pages"] = []

    existing_ids = get_existing_page_ids(notion_config["pages"])
    added: list[str] = []
    has_errors = False

    # Resolve API key for accessibility verification
    from nao_core.deps import _is_extra_installed

    can_verify = _is_extra_installed("notion")
    resolved_key = _resolve_api_key(notion_config, api_key) if can_verify else None

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

        if resolved_key and not verify_page_accessible(page_id, resolved_key):
            has_errors = True
            UI.error(f"Page {page_id} is not accessible. Make sure the page is shared with your Notion integration.")
            continue

        notion_config["pages"].append(page_id)
        existing_ids.add(page_id)
        added.append(page_id)

    if not added:
        if not has_errors:
            UI.info("No new pages to add.")
        return

    try:
        save_yaml(config_path, data)
    except OSError as e:
        UI.error(f"Failed to save config: {e}")
        return

    for page_id in added:
        UI.success(f"Added page {page_id}")

    UI.info(f"{len(added)} page(s) added to nao_config.yaml")

    if sync and added:
        if not can_verify:
            UI.warn("Notion extras not installed. Skipping sync.")
            UI.info("Install with: pip install 'nao-core[notion]'")
            return
        UI.print()
        run_notion_sync()
