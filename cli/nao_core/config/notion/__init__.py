import re
from pathlib import Path

from pydantic import BaseModel, Field

from nao_core.ui import UI, ask_text

# Notion page IDs are 32-character hex strings (UUID without dashes).
# Anchored: matches raw IDs, IDs at the end of Notion URLs, or IDs followed by query params.
NOTION_PAGE_ID_PATTERN = re.compile(r"(?:^|[-/])([a-f0-9]{32})(?:[?#]|$)")


def extract_page_id(page_url: str) -> str:
    """Extract Notion page ID from a URL or raw ID.

    Handles:
    - https://www.notion.so/naolabs/Page-Name-2bfc7a70bc0680978900d1e85ece83a0
    - https://www.notion.so/2bfc7a70bc0680978900d1e85ece83a0
    - https://www.notion.so/Page-2bfc7a70bc0680978900d1e85ece83a0?v=abc
    - 2bfc7a70bc0680978900d1e85ece83a0 (raw ID)
    - 2BFC7A70-BC06-8097-8900-D1E85ECE83A0 (dashed UUID, any case)
    """
    stripped = page_url.strip().lower()
    # Dashed UUID -> strip dashes
    nodash = stripped.replace("-", "")
    if re.fullmatch(r"[a-f0-9]{32}", nodash) and len(stripped) <= 36:
        return nodash
    match = NOTION_PAGE_ID_PATTERN.search(stripped)
    if match:
        return match.group(1)
    raise ValueError(f"Could not extract Notion page ID from: {page_url}")


def find_config_path() -> Path:
    """Find the nao_config.yaml file path, raising if missing."""
    import os

    default_path = os.environ.get("NAO_DEFAULT_PROJECT_PATH")
    project_dir = Path(default_path) if default_path else Path.cwd()
    config_path = project_dir / "nao_config.yaml"
    if not config_path.exists():
        raise FileNotFoundError("No nao_config.yaml found. Run `nao init` first.")
    return config_path


def load_yaml(config_path: Path):
    """Load YAML with ruamel for round-trip preservation."""
    from ruamel.yaml import YAML

    yaml = YAML()
    yaml.preserve_quotes = True
    with config_path.open() as f:
        data = yaml.load(f)
    if data is None:
        return {}
    if not isinstance(data, dict):
        UI.warning("nao_config.yaml does not contain a mapping at the top level; treating as empty.")
        return {}
    return data


def save_yaml(config_path: Path, data) -> None:
    """Write YAML back preserving comments and env var templates."""
    if data is None:
        return
    from ruamel.yaml import YAML

    yaml = YAML()
    yaml.preserve_quotes = True
    yaml.default_flow_style = False
    with config_path.open("w") as f:
        yaml.dump(data, f)


def get_existing_page_ids(pages: list) -> set[str]:
    """Extract normalized page IDs from the existing pages list."""
    ids: set[str] = set()
    for page in pages:
        try:
            ids.add(extract_page_id(str(page)))
        except ValueError:
            pass
    return ids


def run_notion_sync() -> None:
    """Run nao sync for notion provider only."""
    from nao_core.commands.sync import sync

    sync(provider=["notion"], render_templates=False)


def verify_page_accessible(page_id: str, api_key: str) -> bool:
    """Return True if the Notion page is reachable with the given API key."""
    try:
        from notion_client import Client

        client = Client(auth=api_key)
        client.pages.retrieve(page_id=page_id)
        return True
    except Exception:
        return False


class NotionConfig(BaseModel):
    """Notion configuration."""

    api_key: str = Field(description="The API key to use")
    pages: list[str] = Field(description="The pages to sync")

    @classmethod
    def promptConfig(cls) -> "NotionConfig":
        """Interactively prompt the user for Notion configuration."""
        api_key = ask_text("Notion API key:", password=True, required_field=True)

        UI.info("Enter Notion page IDs to sync (comma-separated):")
        pages_input = ask_text("Page IDs:", required_field=True)
        pages = [p.strip() for p in pages_input.split(",") if p.strip()]  # type: ignore

        return NotionConfig(
            api_key=api_key,  # type: ignore
            pages=pages,
        )
