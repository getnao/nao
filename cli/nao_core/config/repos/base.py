from typing import Optional

from pydantic import BaseModel, Field, model_validator

from nao_core.ui import ask_text


class RepoConfig(BaseModel):
    """Repository configuration.

    Supports two source types:
    - Git repository: specify `url` (and optionally `branch`)
    - Local path: specify `local_path` (relative to nao_config.yaml or absolute)
    """

    name: str = Field(description="The name of the repository")
    url: Optional[str] = Field(default=None, description="The URL of the repository")
    branch: Optional[str] = Field(default=None, description="The branch of the repository")
    local_path: Optional[str] = Field(
        default=None, description="Local filesystem path (relative to nao_config.yaml or absolute)"
    )
    include: list[str] = Field(
        default_factory=list,
        description="Glob patterns for files to include (e.g. 'models/**/*.sql'). Empty means include all.",
    )
    exclude: list[str] = Field(default_factory=list, description="Glob patterns for files to exclude (e.g. '*.pyc')")

    @model_validator(mode="after")
    def validate_source(self) -> "RepoConfig":
        if not self.url and not self.local_path:
            raise ValueError("Either 'url' or 'local_path' must be specified")
        if self.url and self.local_path:
            raise ValueError("Only one of 'url' or 'local_path' can be specified, not both")
        if self.branch and self.local_path:
            raise ValueError("'branch' cannot be used with 'local_path'")
        return self

    @property
    def is_local(self) -> bool:
        return self.local_path is not None

    @classmethod
    def promptConfig(cls) -> "RepoConfig":
        """Interactively prompt the user for repository configuration."""
        name = ask_text("Repository name:", required_field=True)
        url = ask_text("Repository URL:", required_field=True)
        branch = ask_text("Branch (optional):")

        return RepoConfig(
            name=name,  # type: ignore
            url=url,
            branch=branch,
        )
