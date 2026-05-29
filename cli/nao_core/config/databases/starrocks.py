from __future__ import annotations

import fnmatch
import re
from typing import TYPE_CHECKING, Any, Literal

from pydantic import Field

from nao_core.config.exceptions import InitError
from nao_core.deps import require_dependency
from nao_core.ui import ask_text

if TYPE_CHECKING:
    from mysql.connector import MySQLConnection

from .base import DatabaseConfig
from .context import DatabaseContext

DEFAULT_CATALOG = "default_catalog"
SYSTEM_SCHEMAS = ("information_schema", "sys", "_statistics_")


def _quote_identifier(value: str) -> str:
    escaped = value.replace("`", "``")
    return f"`{escaped}`"


def _quote_literal(value: str) -> str:
    escaped = value.replace("\\", "\\\\").replace("'", "''")
    return f"'{escaped}'"


def _extract_table_comment_from_ddl(ddl: str) -> str | None:
    match = re.search(
        r'^\s*COMMENT\s*(?:\(\s*)?"((?:\\.|[^"\\])*)"(?:\s*\))?\s*,?\s*$',
        ddl,
        re.IGNORECASE | re.MULTILINE,
    )
    if not match:
        return None
    unescaped = match.group(1).replace('\\"', '"').replace("\\\\", "\\")
    return unescaped.strip() or None


def _split_schema_identifier(identifier: str, default_catalog: str = DEFAULT_CATALOG) -> tuple[str, str]:
    if "." in identifier:
        catalog, schema = identifier.split(".", 1)
        return catalog, schema
    return default_catalog, identifier


class StarRocksBackend:
    """Lightweight backend adapter over mysql-connector for StarRocks."""

    def __init__(self, conn: MySQLConnection, default_catalog: str) -> None:
        self._conn = conn
        self._default_catalog = default_catalog

    def raw_sql(self, sql: str):
        cursor = self._conn.cursor()
        cursor.execute(sql)
        return cursor

    def list_catalogs(self) -> list[str]:
        rows = self.raw_sql("SHOW CATALOGS").fetchall()
        catalogs = [str(row[0]) for row in rows if row and row[0]]
        return sorted(set(catalogs))

    def list_databases(self, catalog: str) -> list[str]:
        rows = self.raw_sql(f"SHOW DATABASES FROM {_quote_identifier(catalog)}").fetchall()
        return [str(row[0]) for row in rows if row and row[0]]

    def list_tables(self, database: str) -> list[str]:
        catalog, schema = _split_schema_identifier(database, default_catalog=self._default_catalog)
        rows = self.raw_sql(f"SHOW TABLES FROM {_quote_identifier(catalog)}.{_quote_identifier(schema)}").fetchall()
        return [str(row[0]) for row in rows if row and row[0]]

    def disconnect(self) -> None:
        self._conn.close()


class StarRocksDatabaseContext(DatabaseContext):
    """StarRocks context using information_schema metadata queries."""

    def __init__(self, conn, schema: str, table_name: str, default_catalog: str = DEFAULT_CATALOG):
        catalog, db_schema = _split_schema_identifier(schema, default_catalog=default_catalog)
        self._catalog = catalog
        super().__init__(conn, db_schema, table_name)

    def _quote(self, name: str) -> str:
        return _quote_identifier(name)

    def _qualified_table_sql(self) -> str:
        return ".".join((self._quote(self._catalog), self._quote(self._schema), self._quote(self._table_name)))

    def _show_create_table_sql(self) -> str:
        return f"SHOW CREATE TABLE {self._qualified_table_sql()}"

    def _description_from_information_schema(self) -> str | None:
        query = f"""
            SELECT TABLE_COMMENT
            FROM information_schema.TABLES
            WHERE TABLE_CATALOG = {_quote_literal(self._catalog)}
              AND TABLE_SCHEMA = {_quote_literal(self._schema)}
              AND TABLE_NAME = {_quote_literal(self._table_name)}
            LIMIT 1
        """
        row = self._conn.raw_sql(query).fetchone()  # type: ignore[union-attr]
        if row and row[0]:
            return str(row[0]).strip() or None
        return None

    def _description_from_show_create(self) -> str | None:
        row = self._conn.raw_sql(self._show_create_table_sql()).fetchone()  # type: ignore[union-attr]
        if not row:
            return None
        ddl = str(row[-1]).strip() if row[-1] else ""
        if not ddl:
            return None
        return _extract_table_comment_from_ddl(ddl)

    def description(self) -> str | None:
        try:
            if desc := self._description_from_information_schema():
                return desc
        except Exception:
            pass
        try:
            if desc := self._description_from_show_create():
                return desc
        except Exception:
            pass
        return None

    def _columns_from_information_schema(self) -> list[dict[str, Any]]:
        query = f"""
            SELECT COLUMN_NAME, DATA_TYPE, IS_NULLABLE, COLUMN_COMMENT
            FROM information_schema.COLUMNS
            WHERE TABLE_CATALOG = {_quote_literal(self._catalog)}
              AND TABLE_SCHEMA = {_quote_literal(self._schema)}
              AND TABLE_NAME = {_quote_literal(self._table_name)}
            ORDER BY ORDINAL_POSITION
        """
        rows = self._conn.raw_sql(query).fetchall()  # type: ignore[union-attr]
        return [
            {
                "name": str(row[0]),
                "type": str(row[1]),
                "nullable": str(row[2]).upper() == "YES",
                "description": str(row[3]).strip() if row[3] else None,
            }
            for row in rows
        ]

    def _columns_from_show_full_columns(self) -> list[dict[str, Any]]:
        cursor = self._conn.raw_sql(f"SHOW FULL COLUMNS FROM {self._qualified_table_sql()}")  # type: ignore[union-attr]
        rows = cursor.fetchall()
        description = getattr(cursor, "description", None) or []
        columns = {str(desc[0]).lower(): idx for idx, desc in enumerate(description) if desc and desc[0]}

        nullable_idx = columns.get("null", 3)
        comment_idx = columns.get("comment", len(rows[0]) - 1 if rows else -1)

        return [
            {
                "name": str(row[0]),
                "type": str(row[1]),
                "nullable": str(row[nullable_idx]).upper() == "YES",
                "description": str(row[comment_idx]).strip() if comment_idx >= 0 and row[comment_idx] else None,
            }
            for row in rows
            if row and row[0]
        ]

    def columns(self) -> list[dict[str, Any]]:
        try:
            columns = self._columns_from_information_schema()
            if columns:
                return columns
        except Exception:
            pass
        try:
            return self._columns_from_show_full_columns()
        except Exception:
            return []

    def row_count(self) -> int:
        try:
            row = self._conn.raw_sql(f"SELECT COUNT(*) FROM {self._qualified_table_sql()}").fetchone()  # type: ignore[union-attr]
            return int(row[0]) if row and row[0] is not None else 0
        except Exception:
            return 0

    def preview(self, limit: int = 10) -> list[dict[str, Any]]:
        safe_limit = max(0, int(limit))
        cursor = self._conn.raw_sql(f"SELECT * FROM {self._qualified_table_sql()} LIMIT {safe_limit}")  # type: ignore[union-attr]
        rows = cursor.fetchall()
        columns = [desc[0] for desc in cursor.description] if cursor.description else []
        out: list[dict[str, Any]] = []
        for row in rows:
            record = dict(zip(columns, row, strict=False))
            for key, value in record.items():
                if value is not None and not isinstance(value, (str, int, float, bool, list, dict)):
                    record[key] = str(value)
            out.append(record)
        return out

    def _build_profiling_query(self, col: dict) -> str:
        col_sql = self._quote(col["name"])
        table_sql = self._qualified_table_sql()
        partition_filter = self._partition_filter()
        where_clause = f"WHERE {partition_filter}" if partition_filter else ""
        frags = self._numeric_agg_fragments(col_sql, col)
        extra_aggs = "".join(f"\n    , {expr} AS {alias}" for alias, expr in frags)
        return f"""
            SELECT
                {self._null_count_sql(col_sql)} AS null_count,
                {self._distinct_count_sql(col_sql)} AS distinct_count{extra_aggs}
            FROM {table_sql}
            {where_clause}
        """.strip()

    def _build_top_values_query(self, col: dict) -> str:
        col_sql = self._quote(col["name"])
        table_sql = self._qualified_table_sql()
        partition_filter = self._partition_filter()
        where_clause = f"WHERE {partition_filter}" if partition_filter else ""
        return f"""
            SELECT {col_sql} AS value, COUNT(*) AS cnt
            FROM {table_sql}
            {where_clause}
            GROUP BY {col_sql}
            ORDER BY cnt DESC, {col_sql} ASC
            LIMIT 10
        """.strip()

    def _cast_complex_to_string(self, col_sql: str) -> str:
        return f"CAST({col_sql} AS STRING)"


class StarRocksConfig(DatabaseConfig):
    """StarRocks-specific configuration using mysql-connector-python."""

    type: Literal["starrocks"] = "starrocks"
    host: str = Field(description="StarRocks FE host")
    port: int = Field(default=9030, description="StarRocks MySQL protocol port")
    user: str = Field(description="Username")
    password: str = Field(default="", description="Password")
    catalog: str | None = Field(default=None, description="Catalog name (optional, defaults to all catalogs)")
    database: str | None = Field(default=None, description="Default database name (optional)")
    schema_name: str | None = Field(default=None, description="Specific schema to sync (optional)")

    @classmethod
    def promptConfig(cls) -> "StarRocksConfig":
        name = ask_text("Connection name:", default="starrocks-prod") or "starrocks-prod"
        host = ask_text("Host:", default="localhost") or "localhost"
        port_str = ask_text("Port:", default="9030") or "9030"
        if not port_str.isdigit():
            raise InitError("Port must be a valid integer.")

        user = ask_text("Username:", required_field=True)
        password = ask_text("Password:", password=True) or ""
        catalog = ask_text("Catalog (optional, e.g. default_catalog):") or None
        database = ask_text("Default database (optional):") or None
        schema_name = ask_text("Schema to sync (optional):") or None

        return StarRocksConfig(
            name=name,
            host=host,
            port=int(port_str),
            user=user,  # type: ignore[arg-type]
            password=password,
            catalog=catalog,
            database=database,
            schema_name=schema_name,
        )

    def connect(self):
        require_dependency("mysql.connector", "starrocks", "to connect to StarRocks databases")
        import mysql.connector

        conn_kwargs: dict[str, Any] = {
            "host": self.host,
            "port": self.port,
            "user": self.user,
            "password": self.password,
            "autocommit": True,
        }
        if self.database:
            catalog = self.catalog or DEFAULT_CATALOG
            conn_kwargs["database"] = f"{catalog}.{self.database}"

        conn = mysql.connector.connect(**conn_kwargs)
        return StarRocksBackend(conn, default_catalog=self.catalog or DEFAULT_CATALOG)  # type: ignore[invalid-argument-type]

    def get_database_name(self) -> str:
        if self.catalog and self.database:
            return f"{self.catalog}.{self.database}"
        if not self.catalog and self.database:
            return self.database
        if self.catalog and not self.database:
            return self.catalog
        return "starrocks"

    def get_schemas(self, conn) -> list[str]:
        if self.schema_name:
            catalog = self.catalog or DEFAULT_CATALOG
            return [f"{catalog}.{self.schema_name}"]

        catalogs = [self.catalog] if self.catalog else conn.list_catalogs()
        schemas: list[str] = []
        for catalog in catalogs:
            try:
                for schema in conn.list_databases(catalog):
                    if schema.lower() in SYSTEM_SCHEMAS:
                        continue
                    schemas.append(f"{catalog}.{schema}")
            except Exception:
                continue
        return sorted(set(schemas))

    def create_context(self, conn, schema: str, table_name: str):
        return StarRocksDatabaseContext(conn, schema, table_name, default_catalog=self.catalog or DEFAULT_CATALOG)

    def check_connection(self) -> tuple[bool, str]:
        conn = None
        try:
            conn = self.connect()
            schemas = self.get_schemas(conn)
            return True, f"Connected successfully ({len(schemas)} schemas found)"
        except Exception as e:
            return False, str(e)
        finally:
            if conn is not None:
                conn.disconnect()

    def matches_pattern(self, schema: str, table: str) -> bool:
        catalog, schema_name = _split_schema_identifier(schema, default_catalog=self.catalog or DEFAULT_CATALOG)
        full_names = (f"{catalog}.{schema_name}.{table}", f"{schema_name}.{table}")

        if self.include and not any(fnmatch.fnmatch(name, pattern) for pattern in self.include for name in full_names):
            return False
        if self.exclude and any(fnmatch.fnmatch(name, pattern) for pattern in self.exclude for name in full_names):
            return False
        return True
