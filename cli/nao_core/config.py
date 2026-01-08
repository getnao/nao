from enum import Enum
from pathlib import Path
from typing import Literal

import ibis
import yaml
from ibis import BaseBackend
from pydantic import BaseModel, Field, model_validator


class LLMProvider(str, Enum):
    """Supported LLM providers."""

    OPENAI = "openai"


class DatabaseType(str, Enum):
    """Supported database types."""

    BIGQUERY = "bigquery"


class BigQueryConfig(BaseModel):
    """BigQuery-specific configuration."""

    type: Literal["bigquery"] = "bigquery"
    name: str = Field(description="A friendly name for this connection")
    project_id: str = Field(description="GCP project ID")
    dataset_id: str | None = Field(default=None, description="Default BigQuery dataset")
    credentials_path: str | None = Field(
        default=None,
        description="Path to service account JSON file. If not provided, uses Application Default Credentials (ADC)",
    )

    def connect(self) -> BaseBackend:
        """Create an Ibis BigQuery connection."""
        kwargs: dict = {"project_id": self.project_id}

        if self.dataset_id:
            kwargs["dataset_id"] = self.dataset_id

        if self.credentials_path:
            from google.oauth2 import service_account

            credentials = service_account.Credentials.from_service_account_file(
                self.credentials_path,
                scopes=["https://www.googleapis.com/auth/bigquery"],
            )
            kwargs["credentials"] = credentials

        return ibis.bigquery.connect(**kwargs)


DatabaseConfig = BigQueryConfig


def parse_database_config(data: dict) -> DatabaseConfig:
    """Parse a database config dict into the appropriate type."""
    db_type = data.get("type")
    if db_type == "bigquery":
        return BigQueryConfig.model_validate(data)
    else:
        raise ValueError(f"Unknown database type: {db_type}")


class LLMConfig(BaseModel):
    """LLM configuration."""

    provider: LLMProvider = Field(description="The LLM provider to use")
    api_key: str = Field(description="The API key to use")


class NaoConfig(BaseModel):
    """nao project configuration."""

    project_name: str = Field(description="The name of the nao project")
    databases: list[BigQueryConfig] = Field(description="The databases to use")
    llm: LLMConfig | None = Field(default=None, description="The LLM configuration")

    @model_validator(mode="before")
    @classmethod
    def parse_databases(cls, data: dict) -> dict:
        """Parse database configs into their specific types."""
        if "databases" in data and isinstance(data["databases"], list):
            data["databases"] = [parse_database_config(db) if isinstance(db, dict) else db for db in data["databases"]]
        return data

    def save(self, path: Path) -> None:
        """Save the configuration to a YAML file."""
        config_file = path / "nao_config.yaml"
        with config_file.open("w") as f:
            yaml.dump(
                self.model_dump(mode="json", by_alias=True),
                f,
                default_flow_style=False,
                sort_keys=False,
                allow_unicode=True,
            )

    @classmethod
    def load(cls, path: Path) -> "NaoConfig":
        """Load the configuration from a YAML file."""
        config_file = path / "nao_config.yaml"
        with config_file.open() as f:
            data = yaml.safe_load(f)
        return cls.model_validate(data)

    def get_connection(self, name: str) -> BaseBackend:
        """Get an Ibis connection by database name."""
        for db in self.databases:
            if db.name == name:
                return db.connect()
        raise ValueError(f"Database '{name}' not found in configuration")

    def get_all_connections(self) -> dict[str, BaseBackend]:
        """Get all Ibis connections as a dict keyed by name."""
        return {db.name: db.connect() for db in self.databases}

    @classmethod
    def try_load(cls, path: Path | None = None) -> "NaoConfig | None":
        """Try to load config from path, returns None if not found or invalid.

        Args:
                path: Directory containing nao_config.yaml. Defaults to current directory.
        """
        if path is None:
            path = Path.cwd()
        try:
            return cls.load(path)
        except (FileNotFoundError, ValueError, yaml.YAMLError):
            return None

    @classmethod
    def json_schema(cls) -> dict:
        """Generate JSON schema for the configuration."""
        return cls.model_json_schema()
