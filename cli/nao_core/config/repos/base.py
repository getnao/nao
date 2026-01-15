from typing import Optional

from pydantic import BaseModel, Field


class RepoConfig(BaseModel):
    """Repository configuration."""

    name: str = Field(description="The name of the repository")
    url: str = Field(description="The URL of the repository")
    branch: Optional[str] = Field(default=None, description="The branch of the repository")
