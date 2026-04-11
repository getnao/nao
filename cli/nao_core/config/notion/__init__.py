import re

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
    """
    stripped = page_url.strip()
    # Raw 32-char hex ID
    if re.fullmatch(r"[a-f0-9]{32}", stripped):
        return stripped
    match = NOTION_PAGE_ID_PATTERN.search(stripped)
    if match:
        return match.group(1)
    raise ValueError(f"Could not extract Notion page ID from: {page_url}")


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
