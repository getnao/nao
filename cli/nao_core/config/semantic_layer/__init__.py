"""Semantic layer configuration module."""

from enum import Enum
from pathlib import Path

from pydantic import BaseModel, Field


class SemanticLayerType(str, Enum):
    """Supported semantic layer engines."""

    METRICFLOW = "metricflow"


class SemanticLayerConfig(BaseModel):
    """Semantic layer configuration.

    Declares a semantic layer the agent can query through `execute_semantic_query`.
    The definitions are compiled to SQL locally and executed through the configured
    database connection, so no dbt Cloud plan is required.
    """

    type: SemanticLayerType = Field(
        default=SemanticLayerType.METRICFLOW,
        description="The semantic layer engine. Only `metricflow` (dbt Semantic Layer) is supported today.",
    )
    manifest_path: str = Field(
        description=(
            "Path to the `semantic_manifest.json` produced by `dbt parse` (relative to nao_config.yaml or absolute)."
        ),
    )
    database: str | None = Field(
        default=None,
        description=(
            "Name of the configured database that executes the compiled SQL. "
            "Optional when a single database is configured."
        ),
    )

    def resolve_manifest_path(self, project_path: Path) -> Path:
        """Resolve `manifest_path` against the project folder."""
        path = Path(self.manifest_path).expanduser()
        if path.is_absolute():
            return path
        return (project_path / path).resolve()


__all__ = ["SemanticLayerConfig", "SemanticLayerType"]
