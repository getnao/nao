import os
import re
from pathlib import Path

import dotenv
import yaml
from ibis import BaseBackend
from pydantic import BaseModel, Field, model_validator

from .databases import AnyDatabaseConfig, parse_database_config
from .llm import LLMConfig
from .notion import NotionConfig
from .repos import RepoConfig
from .slack import SlackConfig

dotenv.load_dotenv()


class NaoConfig(BaseModel):
    """nao project configuration."""

    project_name: str = Field(description="The name of the nao project")
    databases: list[AnyDatabaseConfig] = Field(default_factory=list, description="The databases to use")
    repos: list[RepoConfig] = Field(default_factory=list, description="The repositories to use")
    notion: NotionConfig | None = Field(default=None, description="The Notion configurations")
    llm: LLMConfig | None = Field(default=None, description="The LLM configuration")
    slack: SlackConfig | None = Field(default=None, description="The Slack configuration")

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
        content = config_file.read_text()
        content = cls._process_env_vars(content)
        data = yaml.safe_load(content)
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
            path: Directory containing nao_config.yaml. Defaults to NAO_DEFAULT_PROJECT_PATH
                  environment variable if set, otherwise current directory.
        """
        if path is None:
            default_path = os.environ.get("NAO_DEFAULT_PROJECT_PATH")
            path = Path(default_path) if default_path else Path.cwd()
        try:
            os.chdir(path)
            return cls.load(path)
        except (FileNotFoundError, ValueError, yaml.YAMLError):
            return None

    @classmethod
    def json_schema(cls) -> dict:
        """Generate JSON schema for the configuration."""
        return cls.model_json_schema()

    @staticmethod
    def _process_env_vars(content: str) -> str:
        # Support both ${{ env('VAR') }} and {{ env('VAR') }} formats
        regex = re.compile(r"\$?\{\{\s*env\(['\"]([^'\"]+)['\"]\)\s*\}\}")

        def replacer(match: re.Match[str]) -> str:
            env_var = match.group(1)
            return os.environ.get(env_var, "")

        return regex.sub(replacer, content)
