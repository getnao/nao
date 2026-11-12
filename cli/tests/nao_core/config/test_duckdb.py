import threading
from collections.abc import Iterator
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from typing import Any, cast

import duckdb
import pytest

from nao_core.config.databases.duckdb import DuckDBConfig


@pytest.fixture
def duckdb_config(tmp_path: Path) -> DuckDBConfig:
    db_path = tmp_path / "warehouse.duckdb"
    secret_csv = tmp_path / "secret.csv"
    secret_csv.write_text("password\nhunter2\n")

    _seed_database(db_path, "CREATE TABLE users AS SELECT 1 AS id, 'alice' AS name")
    return DuckDBConfig(name="warehouse", path=str(db_path))


@pytest.fixture
def connection(duckdb_config: DuckDBConfig) -> Iterator[Any]:
    conn = cast(Any, duckdb_config.connect())
    yield conn
    conn.disconnect()


def test_connect_can_query_tables_inside_the_database(connection: Any) -> None:
    rows = connection.raw_sql("SELECT name FROM users").fetchall()
    assert rows == [("alice",)]


def test_connect_blocks_reading_local_files(connection: Any, tmp_path: Path) -> None:
    with pytest.raises(Exception, match="file system operations are disabled|Permission Error"):
        connection.raw_sql(f"SELECT * FROM read_csv('{tmp_path / 'secret.csv'}')")


def test_connect_blocks_network_reads(connection: Any) -> None:
    with pytest.raises(Exception, match="file system operations are disabled|Permission Error|HTTP"):
        connection.raw_sql("SELECT * FROM read_csv('https://example.com/data.csv')")


def test_connect_locks_configuration(connection: Any) -> None:
    with pytest.raises(Exception, match="locked|Cannot change configuration"):
        connection.raw_sql("SET enable_external_access = true")


def test_connect_blocks_attach(connection: Any, tmp_path: Path) -> None:
    other_db = tmp_path / "other.duckdb"
    _seed_database(other_db, "CREATE TABLE leaked AS SELECT 'secret' AS value")

    with pytest.raises(Exception, match="external access|Permission Error|Cannot access"):
        connection.raw_sql(f"ATTACH '{other_db}' AS other")


def test_connect_supports_concurrent_connections_to_the_same_file(duckdb_config: DuckDBConfig) -> None:
    first = cast(Any, duckdb_config.connect())
    second = cast(Any, duckdb_config.connect())
    try:
        assert second.raw_sql("SELECT name FROM users").fetchall() == [("alice",)]
        assert second.raw_sql("SELECT current_setting('TimeZone')").fetchone() == ("UTC",)
        with pytest.raises(Exception, match="locked|Cannot change configuration"):
            second.raw_sql("SET enable_external_access = true")
    finally:
        first.disconnect()
        second.disconnect()


def test_connect_supports_overlapping_queries_from_parallel_threads(duckdb_config: DuckDBConfig) -> None:
    worker_count = 8
    all_connected = threading.Barrier(worker_count, timeout=10)

    def query_users_once_all_connected(_: int) -> list[tuple]:
        conn = cast(Any, duckdb_config.connect())
        try:
            all_connected.wait()
            return conn.raw_sql("SELECT name FROM users").fetchall()
        finally:
            conn.disconnect()

    with ThreadPoolExecutor(max_workers=worker_count) as executor:
        results = list(executor.map(query_users_once_all_connected, range(worker_count)))

    assert results == [[("alice",)]] * worker_count


def test_disconnect_releases_the_file_for_other_writers(duckdb_config: DuckDBConfig) -> None:
    conn = cast(Any, duckdb_config.connect())
    conn.disconnect()

    writer = duckdb.connect(duckdb_config.path)
    writer.execute("INSERT INTO users VALUES (2, 'bob')")
    writer.close()


def _seed_database(path: Path, statement: str) -> None:
    seed = duckdb.connect(str(path))
    seed.execute(statement)
    seed.close()
