from datetime import datetime, timezone
from typing import Any, Literal

import ibis
from ibis import BaseBackend
from pydantic import Field

from nao_core.ui import ask_select, ask_text

from .base import DatabaseConfig
from .context import DatabaseContext


class AthenaDatabaseContext(DatabaseContext):
    def profiling(self) -> dict[str, Any] | None:
        try:
            cols = self.columns()
            if not cols:
                return None

            total_count = self.row_count()

            # Classify columns once
            classified = []
            for col in cols:
                col_name = col["name"]
                col_type = self._normalize_type(col["type"])
                is_numeric = any(
                    t in col_type.lower() for t in ("int", "float", "double", "decimal", "numeric", "real")
                )
                is_integer = self._is_integer_type(col_type)
                is_date = any(t in col_type.lower() for t in ("date", "timestamp", "time"))
                is_numeric_stats_column = is_numeric and not (
                    is_integer and col_name.lower().endswith("_id") and col_name.lower() != "id"
                )
                classified.append((col_name, col_type, is_numeric, is_integer, is_date, is_numeric_stats_column))

            # One single query for all column stats
            aggs = []
            for col_name, col_type, is_numeric, is_integer, is_date, is_numeric_stats_column in classified:
                aggs.append(f'COUNT(*) - COUNT("{col_name}") AS "{col_name}__null_count"')
                aggs.append(f'COUNT(DISTINCT "{col_name}") AS "{col_name}__distinct_count"')
                if is_numeric_stats_column:
                    aggs.append(f'MIN("{col_name}") AS "{col_name}__min"')
                    aggs.append(f'MAX("{col_name}") AS "{col_name}__max"')
                    aggs.append(f'AVG(CAST("{col_name}" AS DOUBLE)) AS "{col_name}__mean"')
                    aggs.append(f'STDDEV_POP(CAST("{col_name}" AS DOUBLE)) AS "{col_name}__stddev"')
                elif is_date:
                    aggs.append(f'MIN("{col_name}") AS "{col_name}__min"')
                    aggs.append(f'MAX("{col_name}") AS "{col_name}__max"')

            query = f'SELECT {", ".join(aggs)} FROM "{self._schema}"."{self._table_name}"'
            stats_row = self._conn.raw_sql(query).fetchone()  # type: ignore[union-attr]
            if not stats_row:
                return None

            # Parse results by position
            idx = 0
            stats: dict[str, dict] = {}
            for col_name, col_type, is_numeric, is_integer, is_date, is_numeric_stats_column in classified:
                s: dict[str, Any] = {}
                s["null_count"] = int(stats_row[idx] or 0)
                idx += 1
                s["distinct_count"] = int(stats_row[idx] or 0)
                idx += 1
                if is_numeric_stats_column:
                    s["min"] = stats_row[idx]
                    idx += 1
                    s["max"] = stats_row[idx]
                    idx += 1
                    s["mean"] = stats_row[idx]
                    idx += 1
                    s["stddev"] = stats_row[idx]
                    idx += 1
                elif is_date:
                    s["min"] = stats_row[idx]
                    idx += 1
                    s["max"] = stats_row[idx]
                    idx += 1
                stats[col_name] = s

            # top_values queries — still one per low-cardinality non-numeric column
            profiles = []
            for col_name, col_type, is_numeric, is_integer, is_date, is_numeric_stats_column in classified:
                s = stats[col_name]
                null_count = s["null_count"]
                distinct_count = s["distinct_count"]

                profile: dict[str, Any] = {
                    "column": col_name,
                    "type": col_type,
                    "total_count": total_count,
                    "null_count": null_count,
                    "null_percentage": round(null_count / total_count * 100, 2) if total_count else None,
                    "distinct_count": distinct_count,
                }

                if is_numeric_stats_column:
                    if s["min"] is not None:
                        profile["min"] = int(s["min"]) if is_integer else round(float(s["min"]), 4)
                    if s["max"] is not None:
                        profile["max"] = int(s["max"]) if is_integer else round(float(s["max"]), 4)
                    if s["mean"] is not None:
                        profile["mean"] = round(float(s["mean"]), 4)
                    if s["stddev"] is not None:
                        profile["stddev"] = round(float(s["stddev"]), 4)
                elif is_date:
                    if s["min"] is not None:
                        profile["min"] = str(s["min"])
                    if s["max"] is not None:
                        profile["max"] = str(s["max"])

                if distinct_count and distinct_count <= 50 and not is_numeric_stats_column and not is_date:
                    top_query = f"""
                        SELECT "{col_name}" AS value, COUNT(*) AS count
                        FROM "{self._schema}"."{self._table_name}"
                        GROUP BY 1
                        ORDER BY 2 DESC, 1 ASC
                        LIMIT 10
                    """
                    top_rows = self._conn.raw_sql(top_query).fetchall()  # type: ignore[union-attr]
                    profile["top_values"] = [
                        {"value": self._json_safe_value(r[0]), "count": int(r[1])} for r in top_rows if r[0] is not None
                    ]

                profiles.append(profile)

            return {
                "computed_at": datetime.now(timezone.utc).isoformat(),
                "columns": profiles,
            }

        except Exception:
            return None


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
