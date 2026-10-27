from pydantic import BaseModel, Field

from nao_core.ui import UI, ask_text

DEFAULT_MAX_DEPTH = 1
DEFAULT_MAX_PAGES = 100
MAX_DEPTH_LIMIT = 10
MAX_PAGE_LIMIT = 250


class NotionConfig(BaseModel):
    """Notion configuration."""

    api_key: str = Field(description="The API key to use")
    pages: list[str] = Field(description="The pages and databases to sync, as URLs or IDs")
    max_depth: int = Field(
        default=DEFAULT_MAX_DEPTH,
        ge=0,
        le=MAX_DEPTH_LIMIT,
        description="Maximum descendant depth for recursive sync",
    )
    max_pages: int = Field(
        default=DEFAULT_MAX_PAGES,
        ge=1,
        le=MAX_PAGE_LIMIT,
        description="Maximum objects discovered by recursive sync",
    )

    @classmethod
    def promptConfig(cls) -> "NotionConfig":
        """Interactively prompt the user for Notion configuration."""
        api_key = ask_text("Notion API key:", password=True, required_field=True)

        UI.info("Enter Notion page or database URLs to sync (comma-separated):")
        pages_input = ask_text("Pages:", required_field=True)
        pages: list[str] = [page.strip() for page in (pages_input or "").split(",") if page.strip()]
        max_depth = ask_bounded_int("Maximum page depth:", DEFAULT_MAX_DEPTH, 0, MAX_DEPTH_LIMIT)
        max_pages = ask_bounded_int("Maximum discovered pages:", DEFAULT_MAX_PAGES, 1, MAX_PAGE_LIMIT)

        return NotionConfig(
            api_key=api_key,  # type: ignore
            pages=pages,
            max_depth=max_depth,
            max_pages=max_pages,
        )


def ask_bounded_int(message: str, default: int, minimum: int, maximum: int) -> int:
    while True:
        value = ask_text(message, default=str(default)) or str(default)
        if value.isdigit() and minimum <= int(value) <= maximum:
            return int(value)
        UI.warn(f"Enter a number from {minimum} to {maximum}.")
