from typing import Optional

from pydantic import BaseModel, Field

from nao_core.ui import ask_text


class RepoConfig(BaseModel):
    """Repository configuration."""

    name: str = Field(description="The name of the repository")
    url: str = Field(description="The URL of the repository")
    branch: Optional[str] = Field(default=None, description="The branch of the repository")

    @classmethod
    def promptConfig(cls) -> "RepoConfig":
        """Interactively prompt the user for repository configuration."""
        name = ask_text("Repository name:", required_field=True)
        url = ask_text("Repository URL:", required_field=True)
        branch = ask_text("Branch (optional):")

        return RepoConfig(
            name=name,  # type: ignore
            url=url,  # type: ignore
            branch=branch,
        )
