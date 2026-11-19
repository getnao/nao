from pathlib import PurePosixPath
from typing import Optional

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from nao_core.ui import ask_text

RESERVED_TARGET_FOLDERS = ("repos", "databases")


class RepoTarget(BaseModel):
    """A folder of the repository synced to its own folder of the project instead of `repos/<name>/`."""

    model_config = ConfigDict(extra="forbid")

    source: str = Field(description="Folder inside the repository, e.g. 'nao/tests'")
    target: str = Field(
        description="Folder of the project it is synced to, e.g. 'tests/analytics'. Replaced on every sync."
    )

    @field_validator("source")
    @classmethod
    def validate_source(cls, value: str) -> str:
        return normalize_relative_path(value, "source")

    @field_validator("target")
    @classmethod
    def validate_target(cls, value: str) -> str:
        target = normalize_relative_path(value, "target")
        parts = PurePosixPath(target).parts
        if len(parts) < 2:
            raise ValueError(f"target '{target}' must be a subfolder such as '{target}/<repo name>', not a top folder")
        if parts[0] in RESERVED_TARGET_FOLDERS:
            raise ValueError(f"target '{target}' cannot be inside '{parts[0]}/', which nao sync manages")
        return target


class RepoConfig(BaseModel):
    """Repository configuration.

    Supports two source types:
    - Git repository: specify `url` (and optionally `branch`)
    - Local path: specify `local_path` (relative to nao_config.yaml or absolute)
    """

    model_config = ConfigDict(extra="forbid")

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
    targets: list[RepoTarget] = Field(
        default_factory=list,
        description="Folders of the repository synced outside `repos/<name>/`, e.g. its tests into `tests/<name>`",
    )

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


def normalize_relative_path(value: str, field_name: str) -> str:
    """Returns the path in POSIX form, refusing one that could leave the folder it is relative to."""
    path = PurePosixPath(value.strip())
    if "\\" in value or path.is_absolute() or ".." in path.parts or not path.parts:
        raise ValueError(f"{field_name} '{value}' must be a relative path with forward slashes and no '..'")
    return path.as_posix()


def find_overlapping_targets(repos: list[RepoConfig]) -> tuple[str, str] | None:
    """The first two targets of which one holds the other, as each target is replaced whole on every sync."""
    targets = [PurePosixPath(target.target) for repo in repos for target in repo.targets]
    for index, target in enumerate(targets):
        for other in targets[index + 1 :]:
            if target == other or target.is_relative_to(other) or other.is_relative_to(target):
                return target.as_posix(), other.as_posix()
    return None
