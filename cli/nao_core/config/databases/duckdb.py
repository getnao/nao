from typing import Literal

import ibis
from ibis import BaseBackend
from pydantic import Field

from .base import DatabaseConfig

class DuckDBConfig(DatabaseConfig):
    """DuckDB-specific configuration."""

    type: Literal["duckdb"] = "duckdb"
    path: str = Field(description="Path to the DuckDB database file", default=":memory:")

    def connect(self) -> BaseBackend:
        """Create an Ibis DuckDB connection."""
        return ibis.duckdb.connect(
			database=self.path,
			read_only=False if self.path == ":memory:" else True,
		)