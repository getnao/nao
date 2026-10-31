"""Tests for syncing tables on one shared thread pool."""

import re
import threading
import time
from collections import defaultdict
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from unittest.mock import MagicMock, patch

import pytest

from nao_core.commands.sync.providers.base import SyncResult
from nao_core.commands.sync.providers.databases.provider import DatabaseSyncProvider
from nao_core.config.databases.base import DatabaseTemplate
from nao_core.config.databases.bigquery import BigQueryConfig

SCHEMA_TABLES = {
    "sales": ["orders", "customers", "refunds", "invoices"],
    "marketing": ["campaigns", "leads", "events"],
}
TABLE_COUNT = sum(len(tables) for tables in SCHEMA_TABLES.values())
RENDER_SECONDS = 0.05


class ConcurrencyRecorder:
    """Track the highest number of tables rendered at once, overall and per database."""

    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._active: dict[str, int] = defaultdict(int)
        self.max_active = 0
        self.max_active_by_database: dict[str, int] = defaultdict(int)

    def render(self, database: str) -> None:
        with self._lock:
            self._active[database] += 1
            self.max_active = max(self.max_active, sum(self._active.values()))
            self.max_active_by_database[database] = max(self.max_active_by_database[database], self._active[database])
        time.sleep(RENDER_SECONDS / 2)
        with self._lock:
            self._active[database] -= 1


class SyncRun:
    def __init__(self, project_path: Path, result: SyncResult, recorder: ConcurrencyRecorder, table_lines: list[str]):
        self.project_path = project_path
        self.result = result
        self.recorder = recorder
        self.table_lines = table_lines


def test_parallel_sync_matches_sequential_output(tmp_path: Path):
    databases = ["warehouse", "lake"]
    sequential = _run_sync(tmp_path / "sequential", _configs(databases), threads=1, failing_table="refunds")
    parallel = _run_sync(tmp_path / "parallel", _configs(databases), threads=4, failing_table="refunds")

    assert parallel.recorder.max_active > 1
    assert _read_tree(parallel.project_path) == _read_tree(sequential.project_path)
    assert parallel.result.details == sequential.result.details
    assert parallel.result.summary is not None and "2 files not generated" in parallel.result.summary
    assert parallel.table_lines == sequential.table_lines
    assert any("refunds" in line for line in parallel.table_lines)


def test_one_large_database_uses_the_whole_pool(tmp_path: Path):
    run = _run_sync(tmp_path, _configs(["warehouse"]), threads=TABLE_COUNT)

    assert run.recorder.max_active > 1
    assert run.result.items_synced == TABLE_COUNT


def test_duckdb_renders_one_table_at_a_time(tmp_path: Path):
    run = _run_sync(tmp_path, _configs(["local"], database_type="duckdb"), threads=TABLE_COUNT)

    assert run.recorder.max_active == 1
    assert run.result.items_synced == TABLE_COUNT


def test_small_parallel_databases_run_together(tmp_path: Path):
    configs = _configs([f"warehouse_{index}" for index in range(4)])
    for config in configs:
        config.get_schemas.return_value = ["sales"]
        config.connect.return_value.list_tables.side_effect = lambda database: ["orders"] if database == "sales" else []

    run = _run_sync(tmp_path, configs, threads=4)

    assert run.recorder.max_active == 4
    assert run.result.items_synced == 4


def test_databases_share_one_pool(tmp_path: Path):
    databases = ["warehouse", "events", "lake", "local"]

    run = _run_sync(tmp_path, _configs(databases), threads=4)

    assert 1 < run.recorder.max_active <= 4
    assert run.result.items_synced == TABLE_COUNT * len(databases)


def test_sequential_sync_renders_one_table_at_a_time(tmp_path: Path):
    run = _run_sync(tmp_path, _configs(["warehouse", "lake"]), threads=1)

    assert run.recorder.max_active == 1


@pytest.mark.parametrize("threads", [1, 4])
def test_table_failure_outside_templates_fails_only_its_database(tmp_path: Path, threads: int):
    configs = _configs(["warehouse", "events"])
    configs[0].create_context.side_effect = lambda _conn, _schema, table: _context(
        "warehouse", table, broken=table == "leads"
    )

    run = _run_sync(tmp_path, configs, threads=threads)

    assert run.result.error == "Failed to sync 1 database: warehouse: column lookup failed for leads"
    assert run.result.items_synced == TABLE_COUNT
    for config in configs:
        config.connect.return_value.disconnect.assert_called_once()


def test_bigquery_fetches_schema_metadata_once_across_threads():
    config = BigQueryConfig(name="warehouse", project_id="project")
    fetches: list[str] = []

    def fetch(_conn, _project_id, schema):
        fetches.append(schema)
        time.sleep(RENDER_SECONDS)
        return {}

    with (
        patch("nao_core.config.databases.bigquery._fetch_schema_partition_metadata", side_effect=fetch),
        ThreadPoolExecutor(max_workers=8) as executor,
    ):
        list(executor.map(lambda i: config.create_context(MagicMock(), f"schema_{i % 2}", f"table_{i}"), range(8)))

    assert sorted(fetches) == ["schema_0", "schema_1"]


def _run_sync(project_path: Path, configs: list[MagicMock], threads: int, failing_table: str | None = None) -> SyncRun:
    recorder = ConcurrencyRecorder()
    engine = MagicMock()
    engine.list_templates.return_value = ["databases/columns.md.j2", "databases/preview.md.j2"]
    engine.render.side_effect = lambda template, **kwargs: _render(recorder, template, failing_table, **kwargs)

    with (
        patch(
            "nao_core.commands.sync.providers.databases.provider.get_template_engine",
            return_value=engine,
        ),
        patch("nao_core.commands.sync.providers.databases.provider.UI._console") as console,
    ):
        result = DatabaseSyncProvider().sync(configs, project_path / "databases", project_path, threads=threads)

    printed = [str(call.args[0]) for call in console.print.call_args_list if call.args]
    table_lines = [re.sub(r"\d+(\.\d+)?m?s\b", "<duration>", line) for line in printed if line.startswith("    ")]
    return SyncRun(project_path, result, recorder, table_lines)


def _render(recorder: ConcurrencyRecorder, template: str, failing_table: str | None, **kwargs) -> str:
    table = kwargs["table_name"]
    database = kwargs["db"].database
    recorder.render(database)
    if table == failing_table and template.endswith("preview.md.j2"):
        raise RuntimeError(f"preview failed for {table}")
    return f"# {database}.{kwargs['dataset']}.{table}\n\n{template}\n"


def _configs(databases: list[str], database_type: str = "bigquery") -> list[MagicMock]:
    return [_database_config(name, database_type) for name in databases]


def _database_config(name: str, database_type: str) -> MagicMock:
    config = MagicMock()
    config.name = name
    config.type = database_type
    config.templates = [DatabaseTemplate.COLUMNS, DatabaseTemplate.PREVIEW]
    config.exclude_columns = []
    config.preview_max_value_length = 100
    config.get_database_name.return_value = name
    config.get_schemas.return_value = list(SCHEMA_TABLES)
    config.matches_pattern.return_value = True
    config.get_semantic_views.return_value = []
    config.connect.return_value.list_tables.side_effect = lambda database: SCHEMA_TABLES[database]
    config.create_context.side_effect = lambda _conn, _schema, table: _context(name, table)
    return config


def _context(database: str, table: str, broken: bool = False) -> MagicMock:
    context = MagicMock()
    context.database = database
    if broken:
        context.all_columns.side_effect = RuntimeError(f"column lookup failed for {table}")
    else:
        context.all_columns.return_value = [{"name": f"{table}_id", "type": "INT64"}]
    return context


def _read_tree(root: Path) -> dict[str, str]:
    return {str(path.relative_to(root)): path.read_text() for path in sorted(root.rglob("*")) if path.is_file()}
