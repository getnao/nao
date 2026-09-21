"""Native (TCP) protocol backend for ClickHouse.

Ibis ships an ``ibis.clickhouse`` backend that talks to ClickHouse over HTTP via
``clickhouse-connect``. Some deployments only expose the native TCP protocol
(port 9000 / 9440 by default), so we need a small shim around
``clickhouse-driver`` that mimics the slice of the Ibis backend that ``nao``
actually uses:

* ``conn.list_databases()``
* ``conn.list_tables(database=...)``
* ``conn.raw_sql(sql)`` returning a result with ``result_rows`` / ``column_names``
* ``conn.table(name, database=...).schema()`` / ``.count().execute()``
* ``conn.disconnect()``

The shim is intentionally minimal — it is only used by
``ClickHouseDatabaseContext`` and ``ClickHouseConfig`` (sync pipeline), not by
arbitrary Ibis expressions.
"""

from __future__ import annotations

import logging
from typing import TYPE_CHECKING, Any

if TYPE_CHECKING:
    from clickhouse_driver import Client

logger = logging.getLogger(__name__)


def _quote_identifier(value: str) -> str:
    """Quote a ClickHouse identifier, escaping embedded backticks by doubling."""
    escaped = value.replace("`", "``")
    return f"`{escaped}`"


class _NativeColumnType:
    """Lightweight stand-in for an ``ibis.DataType``.

    Only exposes the two attributes ``ClickHouseDatabaseContext`` reads:
    ``str(dtype)`` (the native ClickHouse type, e.g. ``UInt32`` /
    ``Nullable(String)``) and ``.nullable``.
    """

    __slots__ = ("_clickhouse_type", "nullable")

    def __init__(self, clickhouse_type: str):
        self._clickhouse_type = clickhouse_type
        self.nullable = "Nullable(" in clickhouse_type

    def __str__(self) -> str:
        return self._clickhouse_type

    def __repr__(self) -> str:
        return f"_NativeColumnType({self._clickhouse_type!r})"


class _NativeSchema:
    """Dict-like stand-in for ``ibis.Schema`` exposing ``items``/``values``/iter."""

    def __init__(self, columns: list[tuple[str, str]]):
        self._cols: list[tuple[str, _NativeColumnType]] = [(name, _NativeColumnType(t)) for name, t in columns]

    def items(self):
        return iter(self._cols)

    def values(self):
        return (dtype for _, dtype in self._cols)

    def keys(self):
        return (name for name, _ in self._cols)

    def __iter__(self):
        return self.keys()

    def __len__(self) -> int:
        return len(self._cols)


class _NativeRawSQLResult:
    """Mimics ``clickhouse_connect`` ``QueryResult``.

    Exposes ``result_rows`` and ``column_names`` so the existing
    ``_raw_sql_to_rows`` helper picks the right branch, and also provides a
    minimal DB-API style ``fetchone`` / ``fetchall`` / ``description`` for
    callers that prefer that shape (e.g. the shared profiling code).
    """

    def __init__(self, rows: list[tuple], columns: list[tuple[str, str]]):
        self.result_rows: list[tuple] = [tuple(row) for row in rows]
        self.column_names: list[str] = [c[0] for c in columns]
        # DB-API style description: 7-tuple per column, only ``name`` and ``type_code`` matter here.
        self.description: list[tuple] = [(c[0], c[1], None, None, None, None, None) for c in columns]
        self._cursor: int = 0

    def fetchone(self) -> tuple | None:
        if self._cursor >= len(self.result_rows):
            return None
        row = self.result_rows[self._cursor]
        self._cursor += 1
        return row

    def fetchall(self) -> list[tuple]:
        remaining = self.result_rows[self._cursor :]
        self._cursor = len(self.result_rows)
        return remaining


class _NativeCountExpr:
    """Represents a ``count()`` query that is materialised via ``.execute()``."""

    def __init__(self, client: "Client", quoted_table: str):
        self._client = client
        self._quoted_table = quoted_table

    def execute(self) -> int:
        rows = self._client.execute(f"SELECT count() FROM {self._quoted_table}")
        return int(rows[0][0]) if rows else 0


class _NativeTable:
    """Stand-in for the ``ibis.Table`` returned by ``ibis.BaseBackend.table``."""

    def __init__(self, client: "Client", database: str, name: str):
        self._client = client
        self._database = database
        self._name = name

    def schema(self) -> _NativeSchema:
        rows, _ = self._client.execute(
            f"DESCRIBE TABLE {self._qualified_name()}",
            with_column_types=True,
        )
        # DESCRIBE returns: name, type, default_type, default_expression, comment, codec_expression, ttl_expression
        return _NativeSchema([(row[0], row[1]) for row in rows])

    def count(self) -> _NativeCountExpr:
        return _NativeCountExpr(self._client, self._qualified_name())

    def _qualified_name(self) -> str:
        return f"{_quote_identifier(self._database)}.{_quote_identifier(self._name)}"


class NativeClickHouseBackend:
    """Drop-in replacement for an Ibis ClickHouse backend that uses native TCP.

    Only implements the slice of the Ibis API that nao's ClickHouse sync code
    actually uses (see module docstring).
    """

    def __init__(
        self,
        *,
        host: str,
        port: int | None,
        database: str,
        user: str,
        password: str,
        secure: bool,
        connect_timeout: int | None = None,
        send_receive_timeout: int | None = None,
        verify: bool = True,
    ):
        from clickhouse_driver import Client

        kwargs: dict[str, Any] = {
            "host": host,
            "database": database,
            "user": user,
            "password": password,
            "secure": secure,
            "verify": verify,
        }
        if port is not None:
            kwargs["port"] = port
        if connect_timeout is not None:
            kwargs["connect_timeout"] = connect_timeout
        if send_receive_timeout is not None:
            kwargs["send_receive_timeout"] = send_receive_timeout

        self._database = database
        self._client: Client = Client(**kwargs)

    # ─── Ibis-compatible surface ──────────────────────────────────────────────

    def list_databases(self) -> list[str]:
        rows = self._client.execute("SELECT name FROM system.databases ORDER BY name")
        return [row[0] for row in rows]

    def list_tables(self, database: str | None = None) -> list[str]:
        db = database or self._database
        rows = self._client.execute(
            "SELECT name FROM system.tables WHERE database = %(db)s ORDER BY name",
            {"db": db},
        )
        return [row[0] for row in rows]

    def raw_sql(self, sql: str) -> _NativeRawSQLResult:
        """Execute ``sql`` and return a clickhouse-connect-like result."""
        try:
            rows, columns = self._client.execute(sql, with_column_types=True)
        except TypeError:
            # Some statements (e.g. SET, OPTIMIZE) return None for columns; fall back to plain execute.
            self._client.execute(sql)
            return _NativeRawSQLResult([], [])
        if columns is None:
            columns = []
            rows = rows or []
        return _NativeRawSQLResult(rows or [], columns)

    def table(self, name: str, database: str | None = None) -> _NativeTable:
        return _NativeTable(self._client, database or self._database, name)

    def disconnect(self) -> None:
        try:
            self._client.disconnect()
        except Exception as e:
            logger.debug("Error disconnecting ClickHouse native client: %s", e)
