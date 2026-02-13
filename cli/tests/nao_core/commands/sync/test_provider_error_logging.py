"""Test that template rendering errors are logged to CLI."""

from unittest.mock import MagicMock, patch

import pytest

from nao_core.commands.sync.providers.databases.provider import sync_database
from nao_core.config.databases.base import DatabaseAccessor


@pytest.fixture
def mock_progress():
    """Create a mock progress object."""
    mock = MagicMock()
    mock.add_task.return_value = "task_id"
    return mock


def create_mock_db_config(
    name="test_db",
    db_type="duckdb",
    database_name="test_database",
    schemas=None,
    tables=None,
):
    """Create a mock database config with customizable parameters."""
    schemas = schemas or ["test_schema"]
    tables = tables or ["test_table"]

    mock_config = MagicMock()
    mock_config.name = name
    mock_config.type = db_type
    mock_config.accessors = list(DatabaseAccessor)
    mock_conn = MagicMock()
    mock_config.connect.return_value = mock_conn
    mock_config.get_database_name.return_value = database_name
    mock_config.get_schemas.return_value = schemas
    mock_config.matches_pattern.return_value = True
    mock_conn.list_tables.return_value = tables

    return mock_config


def create_mock_engine(templates, render_behavior):
    """Create a mock template engine with customizable behavior."""
    mock = MagicMock()
    mock.list_templates.return_value = templates
    mock.render.side_effect = render_behavior
    return mock


def run_sync_with_mocks(db_config, engine, tmp_path, progress):
    """Run sync_database with patched console and engine, return state and console mock."""
    with patch("nao_core.commands.sync.providers.databases.provider.console") as mock_console:
        with patch(
            "nao_core.commands.sync.providers.databases.provider.get_template_engine",
            return_value=engine,
        ):
            state = sync_database(db_config, tmp_path, progress, None)
    return state, mock_console


class TestSyncDatabaseErrorLogging:
    """Test suite for error logging during database sync operations."""

    def test_sync_database_logs_template_errors_to_console(self, tmp_path, mock_progress):
        """Test that template rendering errors are logged to CLI console."""
        db_config = create_mock_db_config()
        engine = create_mock_engine(
            templates=["databases/preview.md.j2"],
            render_behavior=RuntimeError("Database connection failed!"),
        )

        _, mock_console = run_sync_with_mocks(db_config, engine, tmp_path, mock_progress)

        # Verify console was called with error
        mock_console.print.assert_called()
        error_msg = mock_console.print.call_args[0][0]
        assert "[bold red]✗[/bold red]" in error_msg
        assert "preview.md" in error_msg
        assert "test_schema.test_table" in error_msg
        assert "Database connection failed!" in error_msg

        # Verify file still written with error content
        preview_file = (
            tmp_path
            / "type=duckdb"
            / "database=test_database"
            / "schema=test_schema"
            / "table=test_table"
            / "preview.md"
        )
        assert preview_file.exists()
        content = preview_file.read_text()
        assert "Error generating content" in content
        assert "Database connection failed!" in content

    def test_sync_database_logs_context_method_errors_to_console(self, tmp_path, mock_progress):
        """Test that DatabaseContext method errors are logged to CLI console."""
        db_config = create_mock_db_config(
            db_type="postgres",
            database_name="analytics",
            schemas=["public"],
            tables=["users"],
        )
        engine = create_mock_engine(
            templates=["databases/columns.md.j2"],
            render_behavior=ValueError("Column metadata not available"),
        )

        _, mock_console = run_sync_with_mocks(db_config, engine, tmp_path, mock_progress)

        # Verify console was called with error
        mock_console.print.assert_called()
        error_msg = mock_console.print.call_args[0][0]
        assert "[bold red]✗[/bold red]" in error_msg
        assert "columns.md" in error_msg
        assert "public.users" in error_msg
        assert "Column metadata not available" in error_msg

        # Verify file still written with error content
        columns_file = (
            tmp_path / "type=postgres" / "database=analytics" / "schema=public" / "table=users" / "columns.md"
        )
        assert columns_file.exists()
        content = columns_file.read_text()
        assert "Error generating content" in content

    def test_sync_database_error_message_format(self, tmp_path, mock_progress):
        """Test that error messages contain all expected parts."""
        db_config = create_mock_db_config(
            name="prod_db",
            db_type="snowflake",
            database_name="PRODUCTION",
            schemas=["ANALYTICS"],
            tables=["CUSTOMERS"],
        )
        engine = create_mock_engine(
            templates=["databases/description.md.j2"],
            render_behavior=Exception("Test error message"),
        )

        _, mock_console = run_sync_with_mocks(db_config, engine, tmp_path, mock_progress)

        # Verify error message contains all expected parts
        mock_console.print.assert_called_once()
        error_msg = mock_console.print.call_args[0][0]

        # Should have bold red X marker
        assert "[bold red]✗[/bold red]" in error_msg
        # Should have template name
        assert "description.md" in error_msg
        # Should have schema.table identifier
        assert "ANALYTICS.CUSTOMERS" in error_msg
        # Should have the actual error message
        assert "Test error message" in error_msg
