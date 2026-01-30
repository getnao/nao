from pydantic import BaseModel, Field

from nao_core.ui import UI, ask_text


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
