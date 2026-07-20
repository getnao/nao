from pydantic import BaseModel, Field

from nao_core.ui import UI, ask_text


class ObsidianConfig(BaseModel):
    """Obsidian configuration."""

    path: str = Field(description="The local path to the Obsidian vault")

    @classmethod
    def promptConfig(cls) -> "ObsidianConfig":
        """Interactively prompt the user for Obsidian configuration."""
        UI.info("Enter the local path to your Obsidian vault:")
        path = ask_text("Vault path:", required_field=True)
        return ObsidianConfig(path=path)  # type: ignore[arg-type]
