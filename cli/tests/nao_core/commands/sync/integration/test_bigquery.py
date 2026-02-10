"""Integration tests for the database sync pipeline against a real BigQuery project.

Connection is configured via environment variables:
    BIGQUERY_PROJECT_ID, BIGQUERY_DATASET_ID (default public),
    BIGQUERY_CREDENTIALS_JSON (JSON string of service account credentials).

The test suite is skipped entirely when BIGQUERY_PROJECT_ID is not set.
"""

import json
import os
from pathlib import Path

import ibis
import pytest
from google.cloud import bigquery
from google.oauth2 import service_account
from rich.progress import Progress

from nao_core.commands.sync.providers.databases.provider import sync_database
from nao_core.config.databases.bigquery import BigQueryConfig

BIGQUERY_PROJECT_ID = os.environ.get("BIGQUERY_PROJECT_ID")

pytestmark = pytest.mark.skipif(
    BIGQUERY_PROJECT_ID is None, reason="BIGQUERY_PROJECT_ID not set — skipping BigQuery integration tests"
)


@pytest.fixture(scope="module")
def temp_datasets():
    """Create or reuse test datasets with test data."""
    public_dataset_id = "nao_integration_tests_public"
    another_dataset_id = "nao_integration_tests_another"

    # Create BigQuery client for dataset management
    credentials_json_str = os.environ.get("BIGQUERY_CREDENTIALS_JSON")
    project_id = os.environ["BIGQUERY_PROJECT_ID"]

    credentials = None
    if credentials_json_str:
        credentials_json = json.loads(credentials_json_str)
        credentials = service_account.Credentials.from_service_account_info(
            credentials_json,
            scopes=["https://www.googleapis.com/auth/bigquery"],
        )

    bq_client = bigquery.Client(project=project_id, credentials=credentials)

    # Create ibis connection for data operations
    ibis_kwargs = {"project_id": project_id}
    if credentials_json_str:
        ibis_kwargs["credentials"] = credentials

    conn = ibis.bigquery.connect(**ibis_kwargs)

    try:
        # Delete existing test datasets from previous runs to start fresh
        bq_client.delete_dataset(f"{project_id}.{public_dataset_id}", delete_contents=True, not_found_ok=True)
        bq_client.delete_dataset(f"{project_id}.{another_dataset_id}", delete_contents=True, not_found_ok=True)

        # Clean up any old nao_unit_tests_ datasets from failed runs
        for dataset in bq_client.list_datasets():
            if dataset.dataset_id.startswith("nao_unit_tests_"):
                bq_client.delete_dataset(f"{project_id}.{dataset.dataset_id}", delete_contents=True, not_found_ok=True)

        # Create datasets using BigQuery client
        public_dataset = bigquery.Dataset(f"{project_id}.{public_dataset_id}")
        public_dataset.location = "US"
        bq_client.create_dataset(public_dataset)

        another_dataset = bigquery.Dataset(f"{project_id}.{another_dataset_id}")
        another_dataset.location = "US"
        bq_client.create_dataset(another_dataset)

        # Read and execute SQL script
        sql_file = Path(__file__).parent / "dml" / "bigquery.sql"
        sql_template = sql_file.read_text()

        # Inject dataset names into SQL
        sql_content = sql_template.format(
            public_dataset=public_dataset_id,
            another_dataset=another_dataset_id,
        )

        # Execute SQL statements using ibis
        for statement in sql_content.split(";"):
            statement = statement.strip()
            if statement:
                conn.raw_sql(statement)

        yield {"public": public_dataset_id, "another": another_dataset_id}

    finally:
        # Don't clean up datasets - keep them for reuse across test runs
        conn.disconnect()


@pytest.fixture(scope="module")
def bigquery_config(temp_datasets):
    """Build a BigQueryConfig from environment variables using the temporary dataset."""
    credentials_json_str = os.environ.get("BIGQUERY_CREDENTIALS_JSON")
    credentials_json = json.loads(credentials_json_str) if credentials_json_str else None

    return BigQueryConfig(
        name="test-bigquery",
        project_id=os.environ["BIGQUERY_PROJECT_ID"],
        dataset_id=temp_datasets["public"],
        credentials_json=credentials_json,
    )


@pytest.fixture(scope="module")
def synced(tmp_path_factory, bigquery_config):
    """Run sync once for the whole module and return (state, output_path, config)."""
    output = tmp_path_factory.mktemp("bigquery_sync")

    with Progress(transient=True) as progress:
        state = sync_database(bigquery_config, output, progress)

    return state, output, bigquery_config


class TestBigQuerySyncIntegration:
    """Verify the sync pipeline produces correct output against a live BigQuery project."""

    def test_creates_expected_directory_tree(self, synced, temp_datasets):
        state, output, config = synced

        base = output / "type=bigquery" / f"database={config.project_id}" / f"schema={config.dataset_id}"

        # Schema directory
        assert base.is_dir()

        # Each table should have exactly the 3 default template outputs
        for table in ("orders", "users"):
            assert (base / f"table={table}").is_dir()
            table_dir = base / f"table={table}"
            files = sorted(f.name for f in table_dir.iterdir())
            assert files == ["columns.md", "description.md", "preview.md"]

        # Verify that the "another" dataset was NOT synced
        another_dataset_dir = (
            output / "type=bigquery" / f"database={config.project_id}" / f"schema={temp_datasets['another']}"
        )
        assert not another_dataset_dir.exists()

    def test_columns_md_users(self, synced):
        state, output, config = synced

        content = (
            output
            / "type=bigquery"
            / f"database={config.project_id}"
            / f"schema={config.dataset_id}"
            / "table=users"
            / "columns.md"
        ).read_text()

        # BigQuery uses int64, string, bool types
        assert "# users" in content
        assert f"**Dataset:** `{config.dataset_id}`" in content
        assert "## Columns (4)" in content
        assert "- id (int64 NOT NULL)" in content
        assert "- name (string NOT NULL)" in content
        assert "- email (string)" in content
        assert "- active (boolean)" in content

    def test_columns_md_orders(self, synced):
        state, output, config = synced

        content = (
            output
            / "type=bigquery"
            / f"database={config.project_id}"
            / f"schema={config.dataset_id}"
            / "table=orders"
            / "columns.md"
        ).read_text()

        assert "# orders" in content
        assert f"**Dataset:** `{config.dataset_id}`" in content
        assert "## Columns (3)" in content
        assert "- id (int64 NOT NULL)" in content
        assert "- user_id (int64 NOT NULL)" in content
        assert "- amount (float64 NOT NULL)" in content

    def test_description_md_users(self, synced):
        state, output, config = synced

        content = (
            output
            / "type=bigquery"
            / f"database={config.project_id}"
            / f"schema={config.dataset_id}"
            / "table=users"
            / "description.md"
        ).read_text()

        assert "# users" in content
        assert f"**Dataset:** `{config.dataset_id}`" in content
        assert "## Table Metadata" in content
        assert "| **Row Count** | 3 |" in content
        assert "| **Column Count** | 4 |" in content

    def test_description_md_orders(self, synced):
        state, output, config = synced

        content = (
            output
            / "type=bigquery"
            / f"database={config.project_id}"
            / f"schema={config.dataset_id}"
            / "table=orders"
            / "description.md"
        ).read_text()

        assert "| **Row Count** | 2 |" in content
        assert "| **Column Count** | 3 |" in content

    def test_preview_md_users(self, synced):
        state, output, config = synced

        content = (
            output
            / "type=bigquery"
            / f"database={config.project_id}"
            / f"schema={config.dataset_id}"
            / "table=users"
            / "preview.md"
        ).read_text()

        assert "# users - Preview" in content
        assert f"**Dataset:** `{config.dataset_id}`" in content
        assert "## Rows (3)" in content

        # Parse the JSONL rows from the markdown
        lines = [line for line in content.splitlines() if line.startswith("- {")]
        rows = [json.loads(line[2:]) for line in lines]

        assert len(rows) == 3
        # Sort by id since BigQuery doesn't guarantee order
        rows_sorted = sorted(rows, key=lambda r: r["id"])
        assert rows_sorted[0] == {"id": 1, "name": "Alice", "email": "alice@example.com", "active": True}
        assert rows_sorted[1] == {"id": 2, "name": "Bob", "email": None, "active": False}
        assert rows_sorted[2] == {"id": 3, "name": "Charlie", "email": "charlie@example.com", "active": True}

    def test_preview_md_orders(self, synced):
        state, output, config = synced

        content = (
            output
            / "type=bigquery"
            / f"database={config.project_id}"
            / f"schema={config.dataset_id}"
            / "table=orders"
            / "preview.md"
        ).read_text()

        lines = [line for line in content.splitlines() if line.startswith("- {")]
        rows = [json.loads(line[2:]) for line in lines]

        assert len(rows) == 2
        # Sort by id since BigQuery doesn't guarantee order
        rows_sorted = sorted(rows, key=lambda r: r["id"])
        assert rows_sorted[0] == {"id": 1, "user_id": 1, "amount": 99.99}
        assert rows_sorted[1] == {"id": 2, "user_id": 1, "amount": 24.5}

    def test_sync_state_tracks_schemas_and_tables(self, synced):
        state, output, config = synced

        assert state.schemas_synced == 1
        assert state.tables_synced == 2
        assert config.dataset_id in state.synced_schemas
        assert "users" in state.synced_tables[config.dataset_id]
        assert "orders" in state.synced_tables[config.dataset_id]

    def test_include_filter(self, tmp_path_factory, bigquery_config):
        """Only tables matching include patterns should be synced."""
        config = BigQueryConfig(
            name=bigquery_config.name,
            project_id=bigquery_config.project_id,
            dataset_id=bigquery_config.dataset_id,
            credentials_json=bigquery_config.credentials_json,
            include=[f"{bigquery_config.dataset_id}.users"],
        )

        output = tmp_path_factory.mktemp("bigquery_include")
        with Progress(transient=True) as progress:
            state = sync_database(config, output, progress)

        base = output / "type=bigquery" / f"database={config.project_id}" / f"schema={config.dataset_id}"
        assert (base / "table=users").is_dir()
        assert not (base / "table=orders").exists()
        assert state.tables_synced == 1

    def test_exclude_filter(self, tmp_path_factory, bigquery_config):
        """Tables matching exclude patterns should be skipped."""
        config = BigQueryConfig(
            name=bigquery_config.name,
            project_id=bigquery_config.project_id,
            dataset_id=bigquery_config.dataset_id,
            credentials_json=bigquery_config.credentials_json,
            exclude=[f"{bigquery_config.dataset_id}.orders"],
        )

        output = tmp_path_factory.mktemp("bigquery_exclude")
        with Progress(transient=True) as progress:
            state = sync_database(config, output, progress)

        base = output / "type=bigquery" / f"database={config.project_id}" / f"schema={config.dataset_id}"
        assert (base / "table=users").is_dir()
        assert not (base / "table=orders").exists()
        assert state.tables_synced == 1

    def test_sync_all_schemas_when_dataset_id_not_specified(self, tmp_path_factory, bigquery_config, temp_datasets):
        """When dataset_id is not provided, all datasets should be synced."""
        public_dataset = temp_datasets["public"]
        another_dataset = temp_datasets["another"]

        config = BigQueryConfig(
            name=bigquery_config.name,
            project_id=bigquery_config.project_id,
            dataset_id=None,
            credentials_json=bigquery_config.credentials_json,
        )

        output = tmp_path_factory.mktemp("bigquery_all_schemas")
        with Progress(transient=True) as progress:
            state = sync_database(config, output, progress)

        # Verify public dataset tables
        assert (output / "type=bigquery" / f"database={config.project_id}" / f"schema={public_dataset}").is_dir()
        assert (
            output / "type=bigquery" / f"database={config.project_id}" / f"schema={public_dataset}" / "table=users"
        ).is_dir()
        assert (
            output / "type=bigquery" / f"database={config.project_id}" / f"schema={public_dataset}" / "table=orders"
        ).is_dir()

        # Verify public.users files
        files = sorted(
            f.name
            for f in (
                output / "type=bigquery" / f"database={config.project_id}" / f"schema={public_dataset}" / "table=users"
            ).iterdir()
        )
        assert files == ["columns.md", "description.md", "preview.md"]

        # Verify public.orders files
        files = sorted(
            f.name
            for f in (
                output / "type=bigquery" / f"database={config.project_id}" / f"schema={public_dataset}" / "table=orders"
            ).iterdir()
        )
        assert files == ["columns.md", "description.md", "preview.md"]

        # Verify another dataset table
        assert (output / "type=bigquery" / f"database={config.project_id}" / f"schema={another_dataset}").is_dir()
        assert (
            output / "type=bigquery" / f"database={config.project_id}" / f"schema={another_dataset}" / "table=whatever"
        ).is_dir()

        # Verify another.whatever files
        files = sorted(
            f.name
            for f in (
                output
                / "type=bigquery"
                / f"database={config.project_id}"
                / f"schema={another_dataset}"
                / "table=whatever"
            ).iterdir()
        )
        assert files == ["columns.md", "description.md", "preview.md"]

        # Verify state
        assert state.schemas_synced == 2
        assert state.tables_synced == 3
        assert public_dataset in state.synced_schemas
        assert another_dataset in state.synced_schemas
        assert "users" in state.synced_tables[public_dataset]
        assert "orders" in state.synced_tables[public_dataset]
        assert "whatever" in state.synced_tables[another_dataset]
