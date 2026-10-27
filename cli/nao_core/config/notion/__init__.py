from pydantic import BaseModel, Field, model_validator

from nao_core.ui import UI, ask_text

DEFAULT_MAX_DEPTH = 3
DEFAULT_MAX_PAGES = 100
MAX_DEPTH_LIMIT = 10
MAX_PAGE_LIMIT = 250


class NotionConfig(BaseModel):
    """Notion configuration."""

    api_key: str = Field(description="The API key to use")
    pages: list[str] = Field(default_factory=list, description="The individual pages and databases to sync")
    page_trees: list[str] = Field(
        default_factory=list,
        description="Pages and databases whose descendants to sync recursively",
    )
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

    @model_validator(mode="after")
    def validate_pages(self) -> "NotionConfig":
        if not self.pages and not self.page_trees:
            raise ValueError("Notion needs at least one of 'pages' or 'page_trees' to sync")
        return self

    @classmethod
    def promptConfig(cls) -> "NotionConfig":
        """Interactively prompt the user for Notion configuration."""
        api_key = ask_text("Notion API key:", password=True, required_field=True)

        while True:
            UI.info("Enter individual Notion page or database URLs to sync (comma-separated, optional):")
            pages_input = ask_text("Pages:")
            UI.info("Enter Notion pages or databases whose descendants should also sync (comma-separated, optional):")
            page_trees_input = ask_text("Page trees:")
            pages: list[str] = [p.strip() for p in (pages_input or "").split(",") if p.strip()]
            page_trees: list[str] = [p.strip() for p in (page_trees_input or "").split(",") if p.strip()]
            if pages or page_trees:
                break
            UI.warn("Notion needs at least one of pages or page trees to sync.")

        max_depth = DEFAULT_MAX_DEPTH
        max_pages = DEFAULT_MAX_PAGES
        if page_trees:
            max_depth = ask_bounded_int("Maximum page depth:", DEFAULT_MAX_DEPTH, 0, MAX_DEPTH_LIMIT)
            max_pages = ask_bounded_int("Maximum pages:", DEFAULT_MAX_PAGES, 1, MAX_PAGE_LIMIT)

        return NotionConfig(
            api_key=api_key,  # type: ignore
            pages=pages,
            page_trees=page_trees,
            max_depth=max_depth,
            max_pages=max_pages,
        )


def ask_bounded_int(message: str, default: int, minimum: int, maximum: int) -> int:
    while True:
        value = ask_text(message, default=str(default)) or str(default)
        if value.isdigit() and minimum <= int(value) <= maximum:
            return int(value)
        UI.warn(f"Enter a number from {minimum} to {maximum}.")
