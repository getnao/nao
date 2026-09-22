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

    seed = duckdb.connect(str(db_path))
    seed.execute("CREATE TABLE users AS SELECT 1 AS id, 'alice' AS name")
    seed.close()

    return DuckDBConfig(name="warehouse", path=str(db_path))


def test_connect_can_query_tables_inside_the_database(duckdb_config: DuckDBConfig) -> None:
    conn = cast(Any, duckdb_config.connect())
    try:
        rows = conn.raw_sql("SELECT name FROM users").fetchall()
        assert rows == [("alice",)]
    finally:
        conn.disconnect()


def test_connect_blocks_reading_local_files(duckdb_config: DuckDBConfig, tmp_path: Path) -> None:
    conn = cast(Any, duckdb_config.connect())
    try:
        with pytest.raises(Exception, match="file system operations are disabled|Permission Error"):
            conn.raw_sql(f"SELECT * FROM read_csv('{tmp_path / 'secret.csv'}')")
    finally:
        conn.disconnect()


def test_connect_blocks_network_reads(duckdb_config: DuckDBConfig) -> None:
    conn = cast(Any, duckdb_config.connect())
    try:
        with pytest.raises(Exception, match="file system operations are disabled|Permission Error|HTTP"):
            conn.raw_sql("SELECT * FROM read_csv('https://example.com/data.csv')")
    finally:
        conn.disconnect()


def test_connect_locks_configuration(duckdb_config: DuckDBConfig) -> None:
    conn = cast(Any, duckdb_config.connect())
    try:
        with pytest.raises(Exception, match="locked|Cannot change configuration"):
            conn.raw_sql("SET enable_external_access = true")
    finally:
        conn.disconnect()


def test_connect_blocks_attach(duckdb_config: DuckDBConfig, tmp_path: Path) -> None:
    other_db = tmp_path / "other.duckdb"
    seed = duckdb.connect(str(other_db))
    seed.execute("CREATE TABLE leaked AS SELECT 'secret' AS value")
    seed.close()

    conn = cast(Any, duckdb_config.connect())
    try:
        with pytest.raises(Exception, match="external access|Permission Error|Cannot access"):
            conn.raw_sql(f"ATTACH '{other_db}' AS other")
    finally:
        conn.disconnect()
