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

from nao_core.config.databases.bigquery import BigQueryConfig

from .base import BaseSyncIntegrationTests, SyncTestSpec

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
def db_config(temp_datasets):
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
def spec(db_config, temp_datasets):
    return SyncTestSpec(
        db_type="bigquery",
        primary_schema=db_config.dataset_id,
        users_column_assertions=(
            "# users",
            f"**Dataset:** `{db_config.dataset_id}`",
            "## Columns (4)",
            "- id (int64 NOT NULL)",
            "- name (string NOT NULL)",
            '- email (string, "User email address")',
            "- active (boolean)",
        ),
        orders_column_assertions=(
            "# orders",
            f"**Dataset:** `{db_config.dataset_id}`",
            "## Columns (3)",
            "- id (int64 NOT NULL)",
            "- user_id (int64 NOT NULL)",
            "- amount (float64 NOT NULL)",
        ),
        users_table_description="Registered user accounts",
        users_preview_rows=[
            {"id": 1, "name": "Alice", "email": "alice@example.com", "active": True},
            {"id": 2, "name": "Bob", "email": None, "active": False},
            {"id": 3, "name": "Charlie", "email": "charlie@example.com", "active": True},
        ],
        orders_preview_rows=[
            {"id": 1, "user_id": 1, "amount": 99.99},
            {"id": 2, "user_id": 1, "amount": 24.5},
        ],
        sort_rows=True,
        schema_field="dataset_id",
        another_schema=temp_datasets["another"],
        another_table="whatever",
    )


class TestBigQuerySyncIntegration(BaseSyncIntegrationTests):
    """Verify the sync pipeline produces correct output against a live BigQuery project."""
