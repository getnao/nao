import json
from pathlib import Path
from unittest.mock import MagicMock, patch

from nao_core.commands.sync.providers.databases.provider import sync_database


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


def _context(columns: list[dict[str, str]]) -> MagicMock:
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
