import json
from pathlib import Path
from unittest.mock import MagicMock, patch

from nao_core.commands.sync.providers.databases.provider import sync_database
from nao_core.config.databases.column_catalog import (
    column_catalog_path,
    load_column_catalog,
    merge_column_catalog,
    write_column_catalog,
)


def test_sync_writes_unfiltered_columns_and_partial_sync_preserves_other_tables(tmp_path: Path):
    project_path = tmp_path / "project"
    output_path = project_path / "databases"
    config = _database_config()
    progress = MagicMock()
    progress.add_task.return_value = "task"
    engine = MagicMock()
    engine.list_templates.return_value = []

    config.connect.return_value.list_tables.return_value = ["users", "orders"]
    config.create_context.side_effect = [
        _context(
            [
                {"name": "id", "type": "INTEGER"},
                {"name": "email", "type": "VARCHAR"},
            ]
        ),
        _context([{"name": "id", "type": "INTEGER"}]),
    ]
    _sync(config, engine, output_path, project_path, progress)

    catalog_path = project_path / ".meta" / "databases" / "type=duckdb" / "database=analytics" / "columns.json"
    assert json.loads(catalog_path.read_text()) == {
        "version": 1,
        "schemas": {
            "main": {
                "users": [
                    {"name": "id", "type": "INTEGER"},
                    {"name": "email", "type": "VARCHAR"},
                ],
                "orders": [{"name": "id", "type": "INTEGER"}],
            }
        },
    }

    config.create_context.side_effect = [
        _context(
            [
                {"name": "id", "type": "BIGINT"},
                {"name": "email", "type": "VARCHAR"},
            ]
        )
    ]
    _sync(
        config,
        engine,
        output_path,
        project_path,
        progress,
        select=["main.users"],
    )

    assert json.loads(catalog_path.read_text())["schemas"] == {
        "main": {
            "users": [
                {"name": "id", "type": "BIGINT"},
                {"name": "email", "type": "VARCHAR"},
            ],
            "orders": [{"name": "id", "type": "INTEGER"}],
        }
    }

    config.connect.return_value.list_tables.return_value = ["users"]
    config.create_context.side_effect = [
        _context(
            [
                {"name": "id", "type": "BIGINT"},
                {"name": "email", "type": "VARCHAR"},
            ]
        )
    ]
    _sync(config, engine, output_path, project_path, progress)

    assert json.loads(catalog_path.read_text())["schemas"] == {
        "main": {
            "users": [
                {"name": "id", "type": "BIGINT"},
                {"name": "email", "type": "VARCHAR"},
            ]
        }
    }


def test_full_sync_preserves_catalog_for_schema_that_failed_to_list(tmp_path: Path):
    project_path = tmp_path / "project"
    output_path = project_path / "databases"
    config = _database_config()
    config.get_schemas.return_value = ["main", "archive"]
    progress = MagicMock()
    progress.add_task.return_value = "task"
    engine = MagicMock()
    engine.list_templates.return_value = []
    catalog_path = column_catalog_path(project_path, "duckdb", "database=analytics")
    write_column_catalog(
        catalog_path,
        {
            "main": {"users": [{"name": "id", "type": "INTEGER"}]},
            "archive": {"events": [{"name": "secret", "type": "VARCHAR"}]},
        },
    )

    config.connect.return_value.list_tables.side_effect = [["users"], RuntimeError("listing failed")]
    config.create_context.return_value = _context([{"name": "id", "type": "BIGINT"}])

    _sync(config, engine, output_path, project_path, progress)

    assert load_column_catalog(catalog_path) == {
        "main": {"users": [{"name": "id", "type": "BIGINT"}]},
        "archive": {"events": [{"name": "secret", "type": "VARCHAR"}]},
    }


def test_full_sync_preserves_failed_table_and_refreshes_other_column_results(tmp_path: Path):
    project_path = tmp_path / "project"
    output_path = project_path / "databases"
    config = _database_config()
    progress = MagicMock()
    progress.add_task.return_value = "task"
    engine = MagicMock()
    engine.list_templates.return_value = []
    catalog_path = column_catalog_path(project_path, "duckdb", "database=analytics")
    write_column_catalog(
        catalog_path,
        {
            "main": {
                "failed": [{"name": "secret", "type": "VARCHAR"}],
                "empty": [{"name": "old", "type": "INTEGER"}],
                "refreshed": [{"name": "id", "type": "INTEGER"}],
                "removed": [{"name": "legacy", "type": "VARCHAR"}],
            }
        },
    )
    config.connect.return_value.list_tables.return_value = ["failed", "empty", "refreshed"]
    config.create_context.side_effect = [
        _context(None),
        _context([]),
        _context([{"name": "id", "type": "BIGINT"}]),
    ]

    _sync(config, engine, output_path, project_path, progress)

    assert load_column_catalog(catalog_path) == {
        "main": {
            "failed": [{"name": "secret", "type": "VARCHAR"}],
            "empty": [],
            "refreshed": [{"name": "id", "type": "BIGINT"}],
        }
    }


def test_merge_column_catalog_preserves_selected_schemas_on_full_sync():
    existing = {
        "synced": {"old": [{"name": "old_id", "type": "INTEGER"}]},
        "failed": {"events": [{"name": "secret", "type": "VARCHAR"}]},
        "removed": {"logs": [{"name": "message", "type": "VARCHAR"}]},
    }
    synced = {
        "synced": {"users": [{"name": "id", "type": "BIGINT"}]},
    }

    assert merge_column_catalog(existing, synced, partial=False, preserved_schemas={"failed"}) == {
        "synced": {"users": [{"name": "id", "type": "BIGINT"}]},
        "failed": {"events": [{"name": "secret", "type": "VARCHAR"}]},
    }


def test_merge_column_catalog_preserves_selected_tables_on_full_sync():
    existing = {
        "main": {
            "failed": [{"name": "secret", "type": "VARCHAR"}],
            "removed": [{"name": "legacy", "type": "INTEGER"}],
        },
        "archive": {"removed": [{"name": "event", "type": "VARCHAR"}]},
    }
    synced = {
        "main": {"users": [{"name": "id", "type": "BIGINT"}]},
    }

    assert merge_column_catalog(existing, synced, partial=False, preserved_tables={("main", "failed")}) == {
        "main": {
            "failed": [{"name": "secret", "type": "VARCHAR"}],
            "users": [{"name": "id", "type": "BIGINT"}],
        }
    }


def test_load_column_catalog_returns_empty_for_invalid_utf8(tmp_path: Path):
    catalog_path = tmp_path / "columns.json"
    catalog_path.write_bytes(b"\xff\xfe")

    assert load_column_catalog(catalog_path) == {}


def _database_config() -> MagicMock:
    config = MagicMock()
    config.name = "test-db"
    config.type = "duckdb"
    config.templates = []
    config.exclude_columns = ["*.email"]
    config.get_database_name.return_value = "analytics"
    config.get_schemas.return_value = ["main"]
    config.matches_pattern.return_value = True
    config.get_semantic_views.return_value = []
    return config


def _context(columns: list[dict[str, str]] | None) -> MagicMock:
    context = MagicMock()
    context.all_columns.return_value = columns
    return context


def _sync(
    config: MagicMock,
    engine: MagicMock,
    output_path: Path,
    project_path: Path,
    progress: MagicMock,
    select: list[str] | None = None,
) -> None:
    with (
        patch(
            "nao_core.commands.sync.providers.databases.provider.get_template_engine",
            return_value=engine,
        ),
        patch("nao_core.commands.sync.providers.databases.provider.console"),
    ):
        sync_database(
            config,
            output_path,
            progress,
            project_path=project_path,
            select=select,
        )
