"""
Proposed implementation: Redshift IAM authentication support for nao.

This file shows the changes needed to cli/nao_core/config/databases/redshift.py
to add IAM (temporary credentials) authentication alongside the existing
username/password and SSH-tunnel flows.

How it works:
  When `password` is omitted and `region` is provided, connect() calls
  boto3 redshift.get_cluster_credentials() to get short-lived credentials,
  then passes them straight to the existing ibis.postgres.connect() call.

  Three IAM credential sources are supported (same pattern as AthenaConfig):
    1. Named AWS profile   (aws_profile)
    2. Explicit access keys (aws_access_key_id / aws_secret_access_key / aws_session_token)
    3. Default chain       (env vars, ~/.aws/credentials, EC2 instance role, …)
"""

from pathlib import Path
from typing import Any, Literal

import ibis
from ibis import BaseBackend
from pydantic import BaseModel, Field, model_validator
from sshtunnel import SSHTunnelForwarder

from nao_core.config.exceptions import InitError
from nao_core.ui import ask_confirm, ask_select, ask_text

from .base import DatabaseConfig
from .context import DatabaseContext


# ──────────────────────────────────────────────────────────────────────────────
# Unchanged: RedshiftDatabaseContext
# ──────────────────────────────────────────────────────────────────────────────

class RedshiftDatabaseContext(DatabaseContext):
    """Redshift-specific context that bypasses Ibis's problematic pg_enum queries."""

    def columns(self) -> list[dict[str, Any]]:
        """Return column metadata by querying information_schema directly."""
        col_descs = self._fetch_column_descriptions()

        query = f"""
            SELECT 
                column_name,
                data_type,
                is_nullable,
                character_maximum_length,
                numeric_precision,
                numeric_scale
            FROM information_schema.columns
            WHERE table_schema = '{self._schema}'
              AND table_name = '{self._table_name}'
            ORDER BY ordinal_position
        """
        result = self._conn.raw_sql(query).fetchall()  # type: ignore[union-attr]

        columns = []
        for row in result:
            col_name = row[0]
            data_type = row[1]
            is_nullable = row[2] == "YES"
            char_length = row[3]
            num_precision = row[4]
            num_scale = row[5]

            formatted_type = self._format_redshift_type(data_type, is_nullable, char_length, num_precision, num_scale)

            columns.append(
                {
                    "name": col_name,
                    "type": formatted_type,
                    "nullable": is_nullable,
                    "description": col_descs.get(col_name),
                }
            )

        return columns

    @staticmethod
    def _format_redshift_type(
        data_type: str,
        is_nullable: bool,
        char_length: int | None,
        num_precision: int | None,
        num_scale: int | None,
    ) -> str:
        """Convert Redshift SQL type to Ibis-like format."""
        type_map = {
            "integer": "int32",
            "bigint": "int64",
            "smallint": "int16",
            "boolean": "boolean",
            "real": "float32",
            "double precision": "float64",
            "character varying": "string",
            "character": "string",
            "text": "string",
            "date": "date",
            "timestamp without time zone": "timestamp",
            "timestamp with time zone": "timestamp",
        }

        ibis_type = type_map.get(data_type, "string")

        if not is_nullable:
            return f"{ibis_type} NOT NULL"
        return ibis_type

    def preview(self, limit: int = 10) -> list[dict[str, Any]]:
        """Return the first N rows as a list of dictionaries."""
        query = f'SELECT * FROM "{self._schema}"."{self._table_name}" LIMIT {limit}'
        result = self._conn.raw_sql(query).fetchall()  # type: ignore[union-attr]

        columns = self.columns()
        col_names = [col["name"] for col in columns]

        rows = []
        for row in result:
            row_dict = {}
            for i, col_name in enumerate(col_names):
                val = row[i] if i < len(row) else None
                if val is not None and not isinstance(val, (str, int, float, bool, list, dict)):
                    row_dict[col_name] = str(val)
                else:
                    row_dict[col_name] = val
            rows.append(row_dict)
        return rows

    def row_count(self) -> int:
        """Return the total number of rows in the table."""
        query = f'SELECT COUNT(*) FROM "{self._schema}"."{self._table_name}"'
        result = self._conn.raw_sql(query).fetchone()  # type: ignore[union-attr]
        return result[0] if result else 0

    def column_count(self) -> int:
        """Return the number of columns in the table."""
        return len(self.columns())

    def _fetch_column_descriptions(self) -> dict[str, str]:
        """Fetch column descriptions from pg_catalog."""
        try:
            query = f"""
                SELECT a.attname, d.description
                FROM pg_catalog.pg_description d
                JOIN pg_catalog.pg_class c ON c.oid = d.objoid
                JOIN pg_catalog.pg_attribute a ON a.attrelid = c.oid AND a.attnum = d.objsubid
                JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
                WHERE n.nspname = '{self._schema}' AND c.relname = '{self._table_name}' AND d.objsubid > 0
            """
            rows = self._conn.raw_sql(query).fetchall()  # type: ignore[union-attr]
            return {row[0]: str(row[1]) for row in rows if row[1]}
        except Exception:
            return {}

    def description(self) -> str | None:
        """Return the table description from pg_catalog."""
        try:
            query = f"""
                SELECT d.description
                FROM pg_catalog.pg_description d
                JOIN pg_catalog.pg_class c ON c.oid = d.objoid
                JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
                WHERE n.nspname = '{self._schema}' AND c.relname = '{self._table_name}' AND d.objsubid = 0
            """
            row = self._conn.raw_sql(query).fetchone()  # type: ignore[union-attr]
            if row and row[0]:
                return str(row[0]).strip() or None
        except Exception:
            pass
        return None


# ──────────────────────────────────────────────────────────────────────────────
# Unchanged: RedshiftSSHTunnelConfig
# ──────────────────────────────────────────────────────────────────────────────

class RedshiftSSHTunnelConfig(BaseModel):
    """SSH tunnel configuration for Redshift connection."""

    ssh_host: str = Field(description="SSH host")
    ssh_port: int = Field(default=22, description="SSH port")
    ssh_username: str = Field(description="SSH username")
    ssh_private_key_path: str = Field(description="Path to SSH private key file")
    ssh_private_key_passphrase: str | None = Field(default=None, description="SSH private key passphrase (optional)")


# ──────────────────────────────────────────────────────────────────────────────
# Modified: RedshiftConfig  ← IAM fields + updated connect() / promptConfig()
# ──────────────────────────────────────────────────────────────────────────────

class RedshiftConfig(DatabaseConfig):
    """Amazon Redshift-specific configuration."""

    type: Literal["redshift"] = "redshift"
    host: str = Field(description="Redshift cluster endpoint")
    port: int = Field(default=5439, description="Redshift port")
    database: str = Field(description="Database name")
    user: str = Field(description="Database username (or IAM DB user for IAM auth)")

    # password is now optional — omit it to use IAM auth
    password: str | None = Field(default=None, description="Password (omit to use IAM authentication)")

    schema_name: str | None = Field(default=None, description="Default schema (optional, uses 'public' if not set)")
    sslmode: str = Field(default="require", description="SSL mode for the connection")
    ssh_tunnel: RedshiftSSHTunnelConfig | None = Field(default=None, description="SSH tunnel configuration (optional)")

    # ── IAM auth fields ──────────────────────────────────────────────────────
    cluster_id: str | None = Field(
        default=None,
        description=(
            "Cluster identifier used by get_cluster_credentials (e.g. 'my-cluster'). "
            "Defaults to the first segment of `host` when not provided."
        ),
    )
    region: str | None = Field(
        default=None,
        description="AWS region for IAM authentication (e.g. 'us-east-1'). Required when password is omitted.",
    )
    aws_access_key_id: str | None = Field(default=None, description="AWS access key ID")
    aws_secret_access_key: str | None = Field(default=None, description="AWS secret access key")
    aws_session_token: str | None = Field(
        default=None,
        description="AWS session token (for temporary / assumed-role credentials)",
    )
    iam_profile: str | None = Field(
        default=None,
        description="AWS named profile (~/.aws/credentials) to use for IAM auth",
    )

    # ── Validation ───────────────────────────────────────────────────────────

    @model_validator(mode="after")
    def _check_auth_fields(self) -> "RedshiftConfig":
        """Require either a password or a region (for IAM auth)."""
        if not self.password and not self.region:
            raise ValueError(
                "Either 'password' or 'region' (for IAM authentication) must be provided."
            )
        return self

    # ── IAM credential helper ────────────────────────────────────────────────

    def _get_iam_credentials(self) -> tuple[str, str]:
        """Call boto3 redshift.get_cluster_credentials() and return (db_user, db_password).

        The returned db_user has the form ``IAM:<username>`` as required by Redshift
        when connecting with temporary credentials.
        """
        try:
            import boto3
        except ImportError as exc:
            raise ImportError(
                "boto3 is required for Redshift IAM authentication. "
                "Install it with: pip install boto3"
            ) from exc

        # Derive cluster identifier from host when not explicitly set
        cluster_id = self.cluster_id or self.host.split(".")[0]

        if self.iam_profile:
            session = boto3.Session(profile_name=self.iam_profile, region_name=self.region)
        elif self.aws_access_key_id and self.aws_secret_access_key:
            session = boto3.Session(
                aws_access_key_id=self.aws_access_key_id,
                aws_secret_access_key=self.aws_secret_access_key,
                aws_session_token=self.aws_session_token,
                region_name=self.region,
            )
        else:
            # Fall back to the default credential chain:
            # env vars → ~/.aws/credentials → EC2 instance profile / ECS task role / …
            session = boto3.Session(region_name=self.region)

        client = session.client("redshift", region_name=self.region)
        response = client.get_cluster_credentials(
            DbUser=self.user,
            DbName=self.database,
            ClusterIdentifier=cluster_id,
            AutoCreate=False,
        )

        return response["DbUser"], response["DbPassword"]

    # ── promptConfig ─────────────────────────────────────────────────────────

    @classmethod
    def promptConfig(cls) -> "RedshiftConfig":
        """Interactively prompt the user for Redshift configuration."""
        name = ask_text("Connection name:", default="redshift-prod") or "redshift-prod"
        host = ask_text("Cluster endpoint (e.g., your-cluster.region.redshift.amazonaws.com):", required_field=True)
        port_str = ask_text("Port:", default="5439") or "5439"

        if not port_str.isdigit():
            raise InitError("Port must be a valid integer.")

        database = ask_text("Database name:", required_field=True)
        user = ask_text("Username:", required_field=True)
        sslmode = ask_text("SSL mode:", default="require") or "require"
        schema_name = ask_text("Default schema (uses 'public' if empty):")

        # ── auth selection ────────────────────────────────────────────────────
        auth_method = ask_select(
            "Authentication method:",
            choices=["Username / Password", "IAM (temporary credentials via AWS)"],
        )

        password: str | None = None
        cluster_identifier: str | None = None
        region: str | None = None
        aws_access_key_id: str | None = None
        aws_secret_access_key: str | None = None
        aws_session_token: str | None = None
        aws_profile: str | None = None

        if auth_method == "Username / Password":
            password = ask_text("Password:", password=True, required_field=True)
        else:
            # IAM flow
            cluster_identifier = (
                ask_text("Cluster identifier (leave empty to derive from endpoint):") or None
            )
            region = ask_text("AWS region (e.g., us-east-1):", required_field=True) or ""

            iam_source = ask_select(
                "IAM credential source:",
                choices=[
                    "AWS Profile",
                    "Access Keys",
                    "Default credential chain (env vars / instance role)",
                ],
            )

            if iam_source == "AWS Profile":
                aws_profile = ask_text("AWS profile name:", required_field=True)
            elif iam_source == "Access Keys":
                aws_access_key_id = ask_text("AWS access key ID:", required_field=True)
                aws_secret_access_key = ask_text("AWS secret access key:", password=True, required_field=True)
                aws_session_token = ask_text("AWS session token (optional):") or None
            # else: default chain — no extra inputs needed

        # ── SSH tunnel (unchanged) ────────────────────────────────────────────
        use_ssh = ask_confirm("Use SSH tunnel?", default=False)
        ssh_tunnel = None

        if use_ssh:
            ssh_host = ask_text("SSH host:", required_field=True)
            ssh_port_str = ask_text("SSH port:", default="22") or "22"

            if not ssh_port_str.isdigit():
                raise InitError("SSH port must be a valid integer.")

            ssh_username = ask_text("SSH username:", required_field=True)
            ssh_private_key_path = ask_text("Path to SSH private key:", required_field=True)
            ssh_private_key_passphrase = ask_text("SSH private key passphrase (optional):", password=True)

            ssh_tunnel = RedshiftSSHTunnelConfig(
                ssh_host=ssh_host or "",
                ssh_port=int(ssh_port_str),
                ssh_username=ssh_username or "",
                ssh_private_key_path=ssh_private_key_path or "",
                ssh_private_key_passphrase=ssh_private_key_passphrase or None,
            )

        return RedshiftConfig(
            name=name,
            host=host or "",
            port=int(port_str),
            database=database or "",
            user=user or "",
            password=password,
            schema_name=schema_name,
            sslmode=sslmode,
            ssh_tunnel=ssh_tunnel,
            cluster_id=cluster_id,
            region=region,
            aws_access_key_id=aws_access_key_id,
            aws_secret_access_key=aws_secret_access_key,
            aws_session_token=aws_session_token,
            iam_profile=iam_profile,
        )

    # ── connect ───────────────────────────────────────────────────────────────

    def connect(self) -> BaseBackend:
        """Create an Ibis Redshift connection.

        When ``password`` is set the connection is made with plain
        username/password credentials (original behaviour).

        When ``password`` is ``None`` the method calls AWS to exchange IAM
        credentials for a short-lived Redshift username + password pair, then
        uses those with the same ``ibis.postgres.connect()`` call.
        """
        # Resolve credentials
        if self.password:
            db_user = self.user
            db_password = self.password
        else:
            db_user, db_password = self._get_iam_credentials()

        # Determine connection host/port (may be overridden by SSH tunnel below)
        connect_host = self.host
        connect_port = self.port

        if self.ssh_tunnel:
            ssh_pkey_path = Path(self.ssh_tunnel.ssh_private_key_path).expanduser()

            tunnel = SSHTunnelForwarder(
                (self.ssh_tunnel.ssh_host, self.ssh_tunnel.ssh_port),
                ssh_username=self.ssh_tunnel.ssh_username,
                ssh_pkey=str(ssh_pkey_path),
                ssh_private_key_password=self.ssh_tunnel.ssh_private_key_passphrase,
                remote_bind_address=(self.host, self.port),
                local_bind_address=("127.0.0.1", 0),
            )
            tunnel.start()

            connect_host = "127.0.0.1"
            connect_port = tunnel.local_bind_port

        kwargs: dict = {
            "host": connect_host,
            "port": connect_port,
            "database": self.database,
            "user": db_user,
            "password": db_password,
            "client_encoding": "utf8",
            "sslmode": self.sslmode,
        }

        if self.schema_name:
            kwargs["schema"] = self.schema_name

        return ibis.postgres.connect(**kwargs)

    # ── unchanged helpers ─────────────────────────────────────────────────────

    def get_database_name(self) -> str:
        """Get the database name for Redshift."""
        return self.database

    def get_schemas(self, conn: BaseBackend) -> list[str]:
        """Get all schemas in the current database."""
        if self.schema_name:
            return [self.schema_name]

        query = """
            SELECT nspname 
            FROM pg_catalog.pg_namespace
            WHERE nspname NOT LIKE 'pg_%' 
              AND nspname != 'information_schema'
            ORDER BY nspname
        """
        try:
            result = conn.raw_sql(query).fetchall()  # type: ignore[union-attr]
            schemas = [row[0] for row in result]
            return schemas
        except Exception:
            list_databases = getattr(conn, "list_databases", None)
            return list_databases() if list_databases else ["public"]

    def create_context(self, conn: BaseBackend, schema: str, table_name: str) -> RedshiftDatabaseContext:
        """Create a Redshift-specific database context that avoids pg_enum queries."""
        return RedshiftDatabaseContext(conn, schema, table_name)

    def check_connection(self) -> tuple[bool, str]:
        """Test connectivity to Redshift."""
        conn = None
        try:
            conn = self.connect()

            if self.schema_name:
                tables = conn.list_tables(database=self.schema_name)
                return True, f"Connected successfully ({len(tables)} tables found)"

            if self.database:
                schemas = self.get_schemas(conn)

                tables = []
                for schema in schemas:
                    tables.extend(conn.list_tables(database=schema))
                return True, f"Connected successfully ({len(tables)} tables found)"

            return True, "Connected successfully"
        except Exception as e:
            return False, str(e)
        finally:
            if conn is not None:
                conn.disconnect()
