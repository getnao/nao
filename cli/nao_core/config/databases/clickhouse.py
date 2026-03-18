import fnmatch
import logging
import re
from typing import Any, Literal

import ibis
from ibis import BaseBackend
from pydantic import Field

from nao_core.config.exceptions import InitError
from nao_core.ui import ask_text

from .base import DatabaseAccessor, DatabaseConfig
from .context import DatabaseContext

logger = logging.getLogger(__name__)

# Stream-like engines (Kafka, RabbitMQ, FileLog) disallow direct SELECT by default (code 620)
_DIRECT_SELECT_DISALLOWED = ("620", "Direct select is not allowed", "stream_like_engine_allow_direct_select")


def _is_direct_select_disallowed(exc: BaseException) -> bool:
    """True if the exception is ClickHouse code 620 / direct select not allowed (e.g. Kafka/RabbitMQ/FileLog)."""
    msg = str(exc)
    return any(s in msg for s in _DIRECT_SELECT_DISALLOWED)


# AggregateFunction(type_str) -> first argument is the function name (uniq, sum, etc.)
_AGGREGATE_FUNCTION_PATTERN = re.compile(
    r"aggregatefunction\s*\(\s*(\w+)",
    re.IGNORECASE,
)


def _aggregate_function_name(dtype: Any) -> str | None:
    """If dtype is AggregateFunction(...), return the function name (e.g. uniq); else None."""
    type_str = str(dtype)
    m = _AGGREGATE_FUNCTION_PATTERN.search(type_str.lower())
    return m.group(1).lower() if m else None


def _normalize_row(row_dict: dict[str, Any]) -> dict[str, Any]:
    """Coerce non-JSON-serializable values to string for preview output."""
    out = dict(row_dict)
    for key, val in out.items():
        if val is not None and not isinstance(val, (str, int, float, bool, list, dict)):
            out[key] = str(val)
    return out


def _show_create(conn: BaseBackend, sql: str) -> str | None:
    """Execute a SHOW CREATE query and return the DDL string, or None on error."""
    try:
        cursor = conn.raw_sql(sql)  # type: ignore[union-attr]
        if hasattr(cursor, "fetchone"):
            row = cursor.fetchone()
        elif hasattr(cursor, "result_rows") and hasattr(cursor, "column_names"):
            rows = getattr(cursor, "result_rows", [])
            if not rows:
                return None
            row = rows[0]
        else:
            return None
        if row is not None and len(row) > 0:
            return str(row[0]).strip()
    except Exception:
        return None
    return None


def _show_create_table(conn: BaseBackend, database: str, table_name: str) -> str | None:
    """Execute a SHOW CREATE TABLE query and return the DDL string, or None on error."""
    return _show_create(conn, f"SHOW CREATE TABLE `{database}`.`{table_name}`")


def _show_create_dictionary(conn: BaseBackend, database: str, table_name: str) -> str | None:
    """Execute a SHOW CREATE DICTIONARY query and return the DDL string, or None on error."""
    return _show_create(conn, f"SHOW CREATE DICTIONARY `{database}`.`{table_name}`")


def _is_dictionary(conn: BaseBackend, database: str, table_name: str) -> bool:
    """Return True if the object is a dictionary.

    Dictionaries created via DDL are registered in system.dictionaries, not system.tables.
    """
    try:
        d = database.replace("\\", "\\\\").replace("'", "''")
        t = table_name.replace("\\", "\\\\").replace("'", "''")
        sql = f"SELECT 1 FROM system.dictionaries WHERE database = '{d}' AND name = '{t}' LIMIT 1"
        cursor = conn.raw_sql(sql)  # type: ignore[union-attr]
        rows = _raw_sql_to_rows(cursor)
        return bool(rows)
    except Exception:
        return False


def _format_key_expr(expr: Any) -> str | None:
    """Normalize ClickHouse key expressions from system tables."""
    if expr is None:
        return None
    text = str(expr).strip()
    return text or None


def _table_indexes_from_system(conn: BaseBackend, database: str, table_name: str) -> str | None:
    """Build concise index/storage metadata from system tables/projections/indices."""
    try:
        d = database.replace("\\", "\\\\").replace("'", "''")
        t = table_name.replace("\\", "\\\\").replace("'", "''")

        base_sql = f"""
            SELECT engine, partition_key, primary_key, sorting_key, sampling_key
            FROM system.tables
            WHERE database = '{d}' AND name = '{t}'
            LIMIT 1
        """
        base_rows = _raw_sql_to_rows(conn.raw_sql(base_sql))  # type: ignore[union-attr]
        if not base_rows:
            return None

        row = base_rows[0]
        lines = [f"CREATE TABLE `{database}`.`{table_name}`"]

        engine = _format_key_expr(row.get("engine"))
        if engine:
            lines.append(f"ENGINE = {engine}")

        partition_key = _format_key_expr(row.get("partition_key"))
        if partition_key:
            lines.append(f"PARTITION BY {partition_key}")

        primary_key = _format_key_expr(row.get("primary_key"))
        if primary_key:
            lines.append(f"PRIMARY KEY {primary_key}")

        sorting_key = _format_key_expr(row.get("sorting_key"))
        if sorting_key:
            lines.append(f"ORDER BY {sorting_key}")

        sampling_key = _format_key_expr(row.get("sampling_key"))
        if sampling_key:
            lines.append(f"SAMPLE BY {sampling_key}")

        proj_sql = f"""
            SELECT name, type, sorting_key
            FROM system.projections
            WHERE database = '{d}' AND table = '{t}'
            ORDER BY name
        """
        proj_rows = _raw_sql_to_rows(conn.raw_sql(proj_sql))  # type: ignore[union-attr]
        if proj_rows:
            lines.append("PROJECTIONS:")
            for proj in proj_rows:
                name = str(proj.get("name", "")).strip()
                proj_type = str(proj.get("type", "")).strip()
                p_sort = proj.get("sorting_key")
                p_sort_str = ", ".join(map(str, p_sort)) if isinstance(p_sort, list) else str(p_sort or "").strip()
                suffix = f" ORDER BY {p_sort_str}" if p_sort_str else ""
                type_suffix = f" ({proj_type})" if proj_type else ""
                lines.append(f"  PROJECTION {name}{type_suffix}{suffix}")

        idx_sql = f"""
            SELECT name, type_full, expr, granularity
            FROM system.data_skipping_indices
            WHERE database = '{d}' AND table = '{t}'
            ORDER BY name
        """
        idx_rows = _raw_sql_to_rows(conn.raw_sql(idx_sql))  # type: ignore[union-attr]
        if idx_rows:
            lines.append("DATA SKIPPING INDICES:")
            for idx in idx_rows:
                name = str(idx.get("name", "")).strip()
                idx_type = str(idx.get("type_full", "")).strip()
                expr = str(idx.get("expr", "")).strip()
                granularity = idx.get("granularity")
                granularity_str = f" GRANULARITY {granularity}" if granularity is not None else ""
                expr_str = f" expr={expr}" if expr else ""
                lines.append(f"  INDEX {name} {idx_type}{expr_str}{granularity_str}".strip())

        return "\n".join(lines)
    except Exception:
        return None


def _dictionary_indexes_from_system(conn: BaseBackend, database: str, dictionary_name: str) -> str | None:
    """Build concise dictionary metadata from system.dictionaries.

    Returns None when crucial metadata (source/layout) is unavailable so callers can
    fall back to SHOW CREATE DICTIONARY.
    """
    try:
        d = database.replace("\\", "\\\\").replace("'", "''")
        t = dictionary_name.replace("\\", "\\\\").replace("'", "''")
        sql = f"""
            SELECT type, source, `key.names`, lifetime_min, lifetime_max
            FROM system.dictionaries
            WHERE database = '{d}' AND name = '{t}'
            LIMIT 1
        """
        rows = _raw_sql_to_rows(conn.raw_sql(sql))  # type: ignore[union-attr]
        if not rows:
            return None

        row = rows[0]
        source = str(row.get("source") or "").strip()
        layout = str(row.get("type") or "").strip()

        # If dictionary failed to load, system metadata often lacks source/layout.
        # In that case prefer SHOW CREATE fallback which still has DDL metadata.
        if not source or not layout:
            return None

        lines = [f"CREATE DICTIONARY `{database}`.`{dictionary_name}`"]
        key_names = row.get("key.names")
        if isinstance(key_names, list) and key_names:
            lines.append(f"PRIMARY KEY {', '.join(map(str, key_names))}")
        lines.append(f"SOURCE({source})")
        lines.append(f"LAYOUT({layout})")

        lifetime_min = row.get("lifetime_min")
        lifetime_max = row.get("lifetime_max")
        if lifetime_min is not None and lifetime_max is not None:
            lines.append(f"LIFETIME(MIN {lifetime_min} MAX {lifetime_max})")

        return "\n".join(lines)
    except Exception:
        return None


def _summarize_table_ddl(ddl: str) -> str:
    """Return a concise table metadata summary extracted from SHOW CREATE TABLE."""

    def _lines_with_depth(sql: str) -> list[tuple[str, str, int]]:
        depth = 0
        out: list[tuple[str, str, int]] = []
        for raw in sql.splitlines():
            line = raw.strip().rstrip(",")
            if not line:
                continue
            out.append((line, line.upper(), depth))
            depth += raw.count("(") - raw.count(")")
            if depth < 0:
                depth = 0
        return out

    lines = _lines_with_depth(ddl)
    summary: list[str] = []

    # Keep object header line for context (table name).
    for line, upper, depth in lines:
        if depth == 0 and upper.startswith("CREATE TABLE"):
            summary.append(line)
            break

    for prefix in ("ENGINE =", "PARTITION BY", "PRIMARY KEY", "ORDER BY", "SAMPLE BY", "TTL", "SETTINGS"):
        for line, upper, depth in lines:
            if depth == 0 and upper.startswith(prefix):
                summary.append(line)
                break

    projections = [line for line, upper, _ in lines if upper.startswith("PROJECTION ")]
    if projections:
        summary.append("PROJECTIONS:")
        summary.extend(f"  {line}" for line in projections)

    # If parsing misses everything (unexpected format), fall back to raw DDL.
    return "\n".join(summary) if summary else ddl


def _summarize_dictionary_ddl(ddl: str) -> str:
    """Return a concise dictionary metadata summary extracted from SHOW CREATE DICTIONARY."""
    lines = [line.strip().rstrip(",") for line in ddl.splitlines() if line.strip()]
    upper_lines = [line.upper() for line in lines]
    summary: list[str] = []

    for line, upper in zip(lines, upper_lines, strict=False):
        if upper.startswith("CREATE DICTIONARY"):
            summary.append(line)
            break

    for prefix in ("PRIMARY KEY", "SOURCE(", "LIFETIME(", "LAYOUT("):
        for line, upper in zip(lines, upper_lines, strict=False):
            if upper.startswith(prefix):
                summary.append(line)
                break

    return "\n".join(summary) if summary else ddl


def _raw_sql_to_rows(cursor: Any) -> list[dict[str, Any]]:
    """Convert raw_sql cursor result to list of dicts (column name -> value)."""
    if hasattr(cursor, "result_rows") and hasattr(cursor, "column_names"):
        columns = list(cursor.column_names)
        raw_rows = cursor.result_rows
        return [dict(zip(columns, row)) for row in raw_rows]
    if hasattr(cursor, "fetchall") and hasattr(cursor, "description"):
        columns = [desc[0] for desc in cursor.description]
        return [dict(zip(columns, row)) for row in cursor.fetchall()]
    return []


def _get_table_comment(conn: BaseBackend, database: str, table_name: str) -> str | None:
    """Return the table comment from system.tables, or None if missing or on error."""
    try:
        # Prevent SQL injection by escaping single quotes
        d = database.replace("\\", "\\\\").replace("'", "''")
        t = table_name.replace("\\", "\\\\").replace("'", "''")
        sql = f"SELECT comment FROM system.tables WHERE database = '{d}' AND name = '{t}'"
        cursor = conn.raw_sql(sql)  # type: ignore[union-attr]
        rows = _raw_sql_to_rows(cursor)
        if not rows:
            return None
        comment = rows[0].get("comment")
        if not comment:
            return None
        return str(comment).strip() or None
    except Exception:
        return None


def _columns_from_system(conn: BaseBackend, database: str, table_name: str) -> list[dict[str, Any]]:
    """Return column metadata from system.columns (does not SELECT from the table)."""
    try:
        # Escape single quotes for safe SQL (identifiers from config)
        d = database.replace("\\", "\\\\").replace("'", "''")
        t = table_name.replace("\\", "\\\\").replace("'", "''")
        sql = (
            "SELECT name, type, default_kind, default_expression "
            f"FROM system.columns WHERE database = '{d}' AND table = '{t}' ORDER BY position"
        )
        cursor = conn.raw_sql(sql)  # type: ignore[union-attr]
        rows = _raw_sql_to_rows(cursor)
        return [
            {
                "name": r["name"],
                "type": str(r.get("type", "")),
                "nullable": "Nullable" in str(r.get("type", "")),
                "description": None,
                "default_kind": str(r.get("default_kind", "")).strip() or None,
                "default_expression": str(r.get("default_expression", "")).strip() or None,
            }
            for r in rows
        ]
    except Exception:
        return []


def _get_table_engine(conn: BaseBackend, database: str, table_name: str) -> str | None:
    """Return the table engine from system.tables, or None on error."""
    try:
        d = database.replace("\\", "\\\\").replace("'", "''")
        t = table_name.replace("\\", "\\\\").replace("'", "''")
        sql = f"SELECT engine FROM system.tables WHERE database = '{d}' AND name = '{t}'"
        cursor = conn.raw_sql(sql)  # type: ignore[union-attr]
        rows = _raw_sql_to_rows(cursor)
        if not rows:
            return None
        engine = rows[0].get("engine")
        if not engine:
            return None
        return str(engine).strip() or None
    except Exception:
        return None


class ClickHouseDatabaseContext(DatabaseContext):
    """ClickHouse context that uses SHOW CREATE TABLE and schema to know how to query.

    We use the table definition (from schema, which reflects SHOW CREATE TABLE)
    to build the right SELECT: plain columns as-is, AggregateFunction columns
    via -Merge (e.g. uniqMerge(column)) so preview works for all table types.

    Stream-like engines (Kafka, RabbitMQ, FileLog) disallow direct SELECT (code 620).
    When we detect that error for a table, we set _direct_select_disallowed and automatically
    use the no-SELECT path (SHOW CREATE TABLE + system.columns) for all later operations on that table.
    """

    def __init__(self, conn: BaseBackend, schema: str, table_name: str):
        super().__init__(conn, schema, table_name)
        self._direct_select_disallowed: bool = False
        self._is_dictionary_obj: bool | None = None

    @staticmethod
    def _format_type(dtype: Any) -> str:
        raw = str(dtype)
        return raw[1:] + " NOT NULL" if raw.startswith("!") else raw

    @property
    def is_dictionary(self) -> bool:
        if self._is_dictionary_obj is None:
            self._is_dictionary_obj = _is_dictionary(self._conn, self._schema, self._table_name)
        return self._is_dictionary_obj

    def description(self) -> str | None:
        return _get_table_comment(self._conn, self._schema, self._table_name)

    def indexes(self) -> str | None:
        """Return concise index/storage metadata, preferring system tables over DDL parsing."""
        if self.is_dictionary:
            system_summary = _dictionary_indexes_from_system(self._conn, self._schema, self._table_name)
            if system_summary:
                return system_summary
            ddl = _show_create_dictionary(self._conn, self._schema, self._table_name)
            return _summarize_dictionary_ddl(ddl) if ddl else None
        system_summary = _table_indexes_from_system(self._conn, self._schema, self._table_name)
        if system_summary:
            return system_summary
        ddl = _show_create_table(self._conn, self._schema, self._table_name)
        return _summarize_table_ddl(ddl) if ddl else None

    def row_count(self) -> int:
        """Return row count; for stream-like engines (Kafka/RabbitMQ/FileLog) direct SELECT is disallowed, return 0."""
        if self.is_dictionary:
            # Dictionary reads can fail when SOURCE credentials differ from sync credentials.
            # Try a normal count first, then degrade gracefully.
            try:
                return self.table.count().execute()
            except Exception as e:
                logger.debug(
                    "ClickHouse dictionary row_count failed for %s.%s: %s; returning 0",
                    self._schema,
                    self._table_name,
                    e,
                )
                return 0
        if self._direct_select_disallowed:
            return 0
        try:
            return self.table.count().execute()
        except Exception as e:
            if _is_direct_select_disallowed(e):
                self._direct_select_disallowed = True
                logger.debug(
                    "ClickHouse: direct select not allowed for %s.%s; using no-SELECT path for this table",
                    self._schema,
                    self._table_name,
                )
                return 0
            raise

    def column_count(self) -> int:
        """Return column count; for stream-like engines use system.columns if table.schema() is disallowed."""
        if self._direct_select_disallowed:
            return len(_columns_from_system(self._conn, self._schema, self._table_name))
        try:
            return len(self.table.schema())
        except Exception:
            return len(_columns_from_system(self._conn, self._schema, self._table_name))

    def columns(self) -> list[dict[str, Any]]:
        """Return column metadata; for stream-like engines use system.columns (no SELECT from table)."""
        if self._direct_select_disallowed:
            return _columns_from_system(self._conn, self._schema, self._table_name)
        try:
            schema = self.table.schema()
            cols = [
                {
                    "name": name,
                    "type": self._format_type(dtype),
                    "nullable": getattr(dtype, "nullable", True),
                    "description": None,
                }
                for name, dtype in schema.items()
            ]
            system_columns = _columns_from_system(self._conn, self._schema, self._table_name)
            system_types = {
                col["name"]: col["type"]
                for col in system_columns
                if isinstance(col.get("name"), str) and isinstance(col.get("type"), str) and col["type"]
            }
            defaults = {
                col["name"]: {
                    "default_kind": col.get("default_kind"),
                    "default_expression": col.get("default_expression"),
                }
                for col in system_columns
                if isinstance(col.get("name"), str)
            }
            for col in cols:
                name = col.get("name")
                if not isinstance(name, str):
                    continue
                # Preserve native ClickHouse type details (e.g. LowCardinality, Decimal params),
                # then add explicit NOT NULL for consistency with existing markdown output.
                if native_type := system_types.get(name):
                    if col.get("nullable") is False and "Nullable(" not in native_type:
                        col["type"] = f"{native_type} NOT NULL"
                    else:
                        col["type"] = native_type
                if meta := defaults.get(name):
                    col.update(meta)
            return cols
        except Exception:
            return _columns_from_system(self._conn, self._schema, self._table_name)

    def _fetchone(self, result) -> tuple | None:
        """Normalise clickhouse-connect QueryResult objects for profiling queries."""
        if hasattr(result, "result_rows"):
            rows = result.result_rows
            return tuple(rows[0]) if rows else None
        return super()._fetchone(result)

    def _fetchall(self, result) -> list[tuple]:
        """Normalise clickhouse-connect QueryResult objects for top-values queries."""
        if hasattr(result, "result_rows"):
            return [tuple(row) for row in result.result_rows]
        return super()._fetchall(result)

    def preview(self, limit: int = 10) -> list[dict[str, Any]]:
        """Return preview rows by building SELECT from table definition.

        Uses the table schema (same info as SHOW CREATE TABLE) to figure out
        how to query. For stream-like engines (Kafka/RabbitMQ/FileLog) we
        automatically use the no-SELECT path (DDL only) once 620 is detected.
        """
        if self._direct_select_disallowed:
            return []

        # Aggregating engines can require FINAL or custom aggregation and can be
        # expensive to query for preview. Skip preview entirely for them.
        try:
            engine = _get_table_engine(self._conn, self._schema, self._table_name)
            if engine and "aggregatingmergetree" in engine.lower():
                logger.debug(
                    "ClickHouse preview skipped for AggregatingMergeTree engine on %s.%s",
                    self._schema,
                    self._table_name,
                )
                return []
        except Exception:
            pass

        schema = self.table.schema()

        # For tables defined with AggregateFunction columns, preview queries can be
        # both expensive and tricky to express correctly. In this case we skip the
        # preview entirely and return an empty list.
        if any(_aggregate_function_name(dtype) for dtype in schema.values()):
            logger.debug(
                "ClickHouse preview skipped for AggregateFunction table %s.%s",
                self._schema,
                self._table_name,
            )
            return []

        # AggregateFunction tables are skipped above; plain column selection is sufficient here.
        select_parts = [f"`{name}`" for name in schema]
        quoted_table = f"`{self._schema}`.`{self._table_name}`"
        sql = f"SELECT {', '.join(select_parts)} FROM {quoted_table} LIMIT {limit}"

        try:
            cursor = self._conn.raw_sql(sql)  # type: ignore[union-attr]
            rows = _raw_sql_to_rows(cursor)
            return [_normalize_row(r) for r in rows]
        except Exception as e:
            logger.debug(
                "ClickHouse preview query failed for %s.%s: %s; returning empty list",
                self._schema,
                self._table_name,
                e,
            )
            return []


class ClickHouseConfig(DatabaseConfig):
    """ClickHouse-specific configuration."""

    type: Literal["clickhouse"] = "clickhouse"
    host: str = Field(description="ClickHouse server host")
    port: int | None = Field(default=None, description="HTTP port (8123 plain, 8443 secure)")
    database: str = Field(description="Database name")
    user: str = Field(description="Username")
    password: str = Field(default="", description="Password")
    secure: bool = Field(default=False, description="Use HTTPS")
    connect_timeout: int | None = Field(
        default=None,
        description="Connection timeout in seconds (passed to ibis.clickhouse.connect).",
    )
    send_receive_timeout: int | None = Field(
        default=None,
        description="Send/receive timeout in seconds (passed to ibis.clickhouse.connect).",
    )
    # System databases are skipped by default unless explicitly included.
    _SYSTEM_DATABASES = frozenset(("INFORMATION_SCHEMA", "information_schema", "system"))
    accessors: list[DatabaseAccessor] = Field(
        default_factory=lambda: list(DatabaseAccessor),
        description="Which default templates to render per table. Defaults to all.",
    )

    @classmethod
    def promptConfig(cls) -> "ClickHouseConfig":
        """Interactively prompt the user for ClickHouse configuration."""
        name = ask_text("Connection name:", default="clickhouse-prod") or "clickhouse-prod"
        host = ask_text("Host:", default="localhost") or "localhost"
        port_str = ask_text(
            "Port (empty = default 8123/8443):",
            default="8123",
        )
        if port_str and not port_str.isdigit():
            raise InitError("Port must be a valid integer or empty.")
        port = int(port_str) if port_str and port_str.isdigit() else None
        database = ask_text("Database name:", default="default") or "default"
        user = ask_text("Username:", default="default") or "default"
        password = ask_text("Password:", password=True) or ""
        secure_str = ask_text("Use HTTPS (y/n):", default="n")
        secure = bool(secure_str and str(secure_str).lower().startswith("y"))
        if port is None:
            port = 8443 if secure else 8123

        return ClickHouseConfig(
            name=name,
            host=host,
            port=port,
            database=database,
            user=user,
            password=password,
            secure=secure,
        )

    def connect(self) -> BaseBackend:
        """Create an Ibis ClickHouse connection."""
        kwargs: dict = {
            "host": self.host,
            "database": self.database,
            "user": self.user,
            "password": self.password,
            "secure": self.secure,
        }
        if self.port is not None:
            kwargs["port"] = self.port
        if self.connect_timeout is not None:
            kwargs["connect_timeout"] = self.connect_timeout
        if self.send_receive_timeout is not None:
            kwargs["send_receive_timeout"] = self.send_receive_timeout
        return ibis.clickhouse.connect(**kwargs)

    def get_database_name(self) -> str:
        """Get the database name for ClickHouse."""
        return self.database

    def get_schemas(self, conn: BaseBackend) -> list[str]:
        list_databases = getattr(conn, "list_databases", None)
        if not list_databases:
            return []

        # include/exclude are schema.table globs; reduce them to schema globs for pre-filtering.
        include_schema_patterns = [p.split(".", 1)[0] if "." in p else p for p in self.include]
        exclude_schema_patterns = [
            p.split(".", 1)[0] if "." in p else p
            # Only schema-wide excludes should drop a schema up front.
            for p in self.exclude
            if "." not in p or p.endswith(".*")
        ]

        schemas: list[str] = []
        for schema in list_databases():
            # Keep system schemas off by default unless explicitly re-included (e.g. "system.*").
            if schema in self._SYSTEM_DATABASES and not any(
                fnmatch.fnmatch(schema, pattern) for pattern in include_schema_patterns
            ):
                continue
            # Apply schema-level excludes before table listing for efficiency.
            if exclude_schema_patterns and any(fnmatch.fnmatch(schema, pattern) for pattern in exclude_schema_patterns):
                continue
            schemas.append(schema)

        return schemas

    def create_context(self, conn: BaseBackend, schema: str, table_name: str) -> ClickHouseDatabaseContext:
        """Use ClickHouse-specific context for resilient preview."""
        return ClickHouseDatabaseContext(conn, schema, table_name)

    def check_connection(self) -> tuple[bool, str]:
        """Test connectivity to ClickHouse."""
        conn = None
        try:
            conn = self.connect()
            if list_databases := getattr(conn, "list_databases", None):
                schemas = list_databases()
                return True, f"Connected successfully ({len(schemas)} databases found)"
            return True, "Connected successfully"
        except Exception as e:
            return False, str(e)
        finally:
            if conn is not None:
                conn.disconnect()
