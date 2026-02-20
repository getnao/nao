from typing import Literal

import ibis
from ibis import BaseBackend
from pydantic import Field

from nao_core.ui import ask_select, ask_text

from .base import DatabaseConfig


class AthenaConfig(DatabaseConfig):
    """Athena-specific configuration."""

    type: Literal["athena"] = "athena"
    s3_staging_dir: str = Field(description="S3 staging directory for query results")
    region_name: str = Field(description="AWS region name")
    aws_access_key_id: str | None = Field(default=None, description="AWS access key ID")
    aws_secret_access_key: str | None = Field(default=None, description="AWS secret access key")
    aws_session_token: str | None = Field(default=None, description="AWS session token")
    profile_name: str | None = Field(default=None, description="AWS profile name")
    schema_name: str | None = Field(default=None, description="Athena schema name")
    work_group: str | None = Field(default="primary", description="Athena workgroup")

    @classmethod
    def promptConfig(cls) -> "AthenaConfig":
        """Interactively prompt the user for Athena configuration."""
        name = ask_text("Connection name:", default="athena-prod") or "athena-prod"
        region_name = ask_text("AWS Region:", default="us-east-1") or "us-east-1"
        s3_staging_dir = ask_text("S3 Staging Directory (s3://...):", required_field=True) or ""
        schema_name = ask_text("Default schema (optional):") or None
        work_group = ask_text("Workgroup (optional):", default="primary")

        auth_method = ask_select(
            "Authentication method:",
            choices=["AWS Profile", "Access Keys"],
        )

        profile_name = None
        aws_access_key_id = None
        aws_secret_access_key = None
        aws_session_token = None

        if auth_method == "AWS Profile":
            profile_name = ask_text("AWS Profile Name:", default="default")
        elif auth_method == "Access Keys":
            aws_access_key_id = ask_text("AWS Access Key ID:", required_field=True)
            aws_secret_access_key = ask_text("AWS Secret Access Key:", password=True, required_field=True)
            aws_session_token = ask_text("AWS Session Token (optional):", password=True) or None

        return AthenaConfig(
            name=name,
            region_name=region_name,
            s3_staging_dir=s3_staging_dir,
            schema_name=schema_name,
            work_group=work_group,
            aws_access_key_id=aws_access_key_id,
            aws_secret_access_key=aws_secret_access_key,
            aws_session_token=aws_session_token,
            profile_name=profile_name,
        )

    def connect(self) -> BaseBackend:
        """Create an Ibis Athena connection."""
        kwargs = {
            "s3_staging_dir": self.s3_staging_dir,
            "region_name": self.region_name,
            "schema_name": self.schema_name or "default",
        }

        if self.work_group:
            kwargs["work_group"] = self.work_group

        if self.profile_name:
            kwargs["profile_name"] = self.profile_name
        elif self.aws_access_key_id and self.aws_secret_access_key:
            kwargs["aws_access_key_id"] = self.aws_access_key_id
            kwargs["aws_secret_access_key"] = self.aws_secret_access_key
            if self.aws_session_token:
                kwargs["aws_session_token"] = self.aws_session_token

        return ibis.athena.connect(**kwargs)

    def get_database_name(self) -> str:
        return self.schema_name or "default"

    def get_schemas(self, conn: BaseBackend) -> list[str]:
        """Return the list of schemas to sync."""
        if self.schema_name:
            return [self.schema_name]

        list_databases = getattr(conn, "list_databases", None)
        if list_databases:
            return list_databases()
        return []

    def check_connection(self) -> tuple[bool, str]:
        """Test connectivity to Athena"""
        try:
            conn = self.connect()

            if self.schema_name:
                tables = conn.list_tables(database=self.schema_name)
                return True, f"Connected successfully ({len(tables)} tables found in {self.schema_name})"

            if list_databases := getattr(conn, "list_databases", None):
                schemas = list_databases()
                return True, f"Connected successfully ({len(schemas)} schemas found)"

            return True, "Connected successfully"
        except Exception as e:
            return False, f"Connection failed: {str(e)}"
