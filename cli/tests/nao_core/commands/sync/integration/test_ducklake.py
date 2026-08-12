"""Integration tests for DuckLake against a live catalog + object store.

Requires the stack from docker-compose.ducklake.yml:
    docker compose -f docker-compose.ducklake.yml up -d
"""

from __future__ import annotations

import socket

import pytest

from nao_core.config.databases import parse_database_config
from nao_core.config.databases.ducklake import DuckLakeConfig

CATALOG_PORT = 5455
STORAGE_PORT = 9010


def _port_is_open(port: int) -> bool:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as probe:
        probe.settimeout(0.5)
        return probe.connect_ex(("127.0.0.1", port)) == 0


pytestmark = pytest.mark.skipif(
    not (_port_is_open(CATALOG_PORT) and _port_is_open(STORAGE_PORT)),
    reason="DuckLake stack is not running — start docker-compose.ducklake.yml",
)


def _lake_config(name: str = "lake", **overrides: object) -> DuckLakeConfig:
    payload: dict[str, object] = {
        "type": "ducklake",
        "name": name,
        "catalog": {
            "type": "postgres",
            "host": "localhost",
            "port": CATALOG_PORT,
            "database": "ducklake_catalog",
            "user": "ducklake",
            "password": "ducklake",
        },
        "data_path": "s3://ducklake/it/",
        "storage": {
            "type": "s3",
            "key_id": "naoducklake",
            "secret": "naoducklake",
            "endpoint": f"localhost:{STORAGE_PORT}",
            "url_style": "path",
            "use_ssl": False,
        },
    }
    payload.update(overrides)
    return parse_database_config(payload)  # type: ignore[return-value]


def _writable_connection(config: DuckLakeConfig):
    """Open the same lake with writes allowed, to seed fixtures."""
    import ibis

    conn = ibis.duckdb.connect(database=":memory:", read_only=False)
    for statement in config.connection_statements():
        conn.raw_sql(statement.replace(", READ_ONLY)", ")"))
    return conn


@pytest.fixture(scope="module")
def seeded() -> None:
    config = _lake_config()
    conn = _writable_connection(config)
    try:
        conn.raw_sql('CREATE SCHEMA IF NOT EXISTS "lake".finance')
        conn.raw_sql(
            'CREATE OR REPLACE TABLE "lake".main.sales AS SELECT i AS id, i * 10 AS amount FROM range(100) t(i)'
        )
        conn.raw_sql('CREATE OR REPLACE TABLE "lake".finance.invoices AS SELECT i AS id FROM range(10) t(i)')
    finally:
        conn.disconnect()


def test_check_connection_succeeds(seeded: None) -> None:
    ok, message = _lake_config().check_connection()
    assert ok, message


def test_reads_live_data(seeded: None) -> None:
    df = _lake_config().execute_sql('SELECT count(*) AS n FROM "lake".main.sales')
    assert df.iloc[0]["n"] == 100


def test_writes_are_rejected(seeded: None) -> None:
    with pytest.raises(Exception, match="read-only"):
        _lake_config().execute_sql('INSERT INTO "lake".main.sales VALUES (999, 999)')


def test_discovers_every_lake_schema(seeded: None) -> None:
    config = _lake_config()
    conn = config.connect()
    try:
        assert config.get_schemas(conn) == ["lake.finance", "lake.main"]
    finally:
        conn.disconnect()


def test_schema_name_restricts_discovery(seeded: None) -> None:
    config = _lake_config(schema_name="finance")
    conn = config.connect()
    try:
        assert config.get_schemas(conn) == ["lake.finance"]
    finally:
        conn.disconnect()


def test_qualified_schemas_actually_list_tables(seeded: None) -> None:
    """Guards the silent-failure mode: bare schema names return [] without raising."""
    config = _lake_config()
    conn = config.connect()
    try:
        discovered = {schema: conn.list_tables(database=schema) for schema in config.get_schemas(conn)}
        assert discovered == {"lake.main": ["sales"], "lake.finance": ["invoices"]}
        assert conn.list_tables(database="main") == []
    finally:
        conn.disconnect()


def test_sees_committed_writes(seeded: None) -> None:
    """The claim that closes issue #1264: no re-snapshot needed."""
    config = _lake_config()
    reader = config.connect()
    try:
        before = reader.raw_sql('SELECT count(*) FROM "lake".main.sales').fetchall()[0][0]

        writer = _writable_connection(config)
        try:
            writer.raw_sql('INSERT INTO "lake".main.sales SELECT 5000 + i, 1 FROM range(7) t(i)')
        finally:
            writer.disconnect()

        after = reader.raw_sql('SELECT count(*) FROM "lake".main.sales').fetchall()[0][0]
        assert after == before + 7
    finally:
        reader.disconnect()


def test_file_catalog_lock_produces_an_actionable_error(tmp_path) -> None:
    """A file-based catalog allows one connection; nao must say so clearly."""
    catalog = tmp_path / "catalog.ducklake"
    data_path = tmp_path / "data"
    data_path.mkdir()

    config = parse_database_config(
        {
            "type": "ducklake",
            "name": "filelake",
            "catalog": {"type": "duckdb", "path": str(catalog)},
            "data_path": f"{data_path}/",
        }
    )

    seeder = _writable_connection(config)
    try:
        seeder.raw_sql('CREATE OR REPLACE TABLE "filelake".main.t AS SELECT 1 AS id')
    finally:
        seeder.disconnect()

    holder = _writable_connection(config)
    try:
        ok, message = config.check_connection()
        assert not ok
        assert "locked by another process" in message
        assert "postgres or mysql catalog" in message
    finally:
        holder.disconnect()


def test_file_catalog_lock_across_processes(tmp_path) -> None:
    """DuckDB reports a different error across processes than within one."""
    import subprocess
    import sys
    import textwrap

    catalog = tmp_path / "catalog.ducklake"
    data_path = tmp_path / "data"
    data_path.mkdir()

    config = parse_database_config(
        {
            "type": "ducklake",
            "name": "filelake",
            "catalog": {"type": "duckdb", "path": str(catalog)},
            "data_path": f"{data_path}/",
        }
    )

    seeder = _writable_connection(config)
    try:
        seeder.raw_sql('CREATE OR REPLACE TABLE "filelake".main.t AS SELECT 1 AS id')
    finally:
        seeder.disconnect()

    holder_script = textwrap.dedent(
        f"""
        import duckdb, sys, time
        con = duckdb.connect(":memory:")
        for extension in ("ducklake",):
            con.execute(f"INSTALL {{extension}}")
            con.execute(f"LOAD {{extension}}")
        con.execute("ATTACH 'ducklake:{catalog}' AS filelake (DATA_PATH '{data_path}/')")
        print("READY", flush=True)
        time.sleep(20)
        """
    )

    holder = subprocess.Popen([sys.executable, "-c", holder_script], stdout=subprocess.PIPE, text=True)
    try:
        assert holder.stdout is not None
        assert holder.stdout.readline().strip() == "READY"

        ok, message = config.check_connection()
        assert not ok
        assert "locked by another process" in message
        assert "postgres or mysql catalog" in message
    finally:
        holder.kill()
        holder.wait(timeout=10)
