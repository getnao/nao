"""Integration tests for the database sync pipeline against a real BigQuery project.

Connection is configured via environment variables:
    BIGQUERY_PROJECT_ID, BIGQUERY_DATASET_ID (default public),
    BIGQUERY_CREDENTIALS_JSON (JSON string of service account credentials).

The test suite is skipped entirely when BIGQUERY_PROJECT_ID is not set.
"""

import json
import os
from contextlib import contextmanager
from typing import Any

import ibis
import pytest
from google.cloud import bigquery
from google.oauth2 import service_account

from nao_core.config.databases.bigquery import BigQueryConfig

from .base import (
    ORDERS_PROFILING_ROWS,
    USERS_PROFILING_ROWS,
    BaseSyncIntegrationTests,
    SyncTestSpec,
    dml_statements,
    with_column_types,
)

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
    ibis_kwargs: dict[str, Any] = {"project_id": project_id}
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

        statements = dml_statements(
            "bigquery.sql", public_dataset=public_dataset_id, another_dataset=another_dataset_id
        )
        for statement in statements:
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
        primary_table_count=3,
        users_column_assertions=(
            "# users",
            f"**Dataset:** `{db_config.dataset_id}`",
            "## Columns (4)",
            "- id (INT64 NOT NULL)",
            "- name (STRING NOT NULL)",
            '- email (STRING, "User email address")',
            "- active (BOOL)",
        ),
        orders_column_assertions=(
            "# orders",
            f"**Dataset:** `{db_config.dataset_id}`",
            "## Columns (3)",
            "- id (INT64 NOT NULL)",
            "- user_id (INT64 NOT NULL)",
            "- amount (FLOAT64 NOT NULL)",
        ),
        users_table_description="Registered user accounts",
        users_profiling_rows=with_column_types(
            USERS_PROFILING_ROWS, {"id": "INT64", "name": "STRING", "email": "STRING", "active": "BOOL"}
        ),
        orders_profiling_rows=with_column_types(
            ORDERS_PROFILING_ROWS, {"id": "INT64", "user_id": "INT64", "amount": "FLOAT64"}
        ),
        sort_rows=True,
        schema_field="dataset_id",
        another_schema=temp_datasets["another"],
        another_table="whatever",
    )


class TestBigQuerySyncIntegration(BaseSyncIntegrationTests):
    """Verify the sync pipeline produces correct output against a live BigQuery project."""


class TestBigQueryPartitionFilter:
    """Verify preview and row_count work on tables that require a partition filter."""

    def test_preview_returns_rows_on_partition_required_table(self, db_config, temp_datasets):
        with _table_context(db_config, temp_datasets["public"], "events") as ctx:
            rows = ctx.preview()
            assert len(rows) == 2
            assert all(r["event_date"] == "2026-01-15" for r in rows)

    def test_row_count_returns_total_on_partition_required_table(self, db_config, temp_datasets):
        with _table_context(db_config, temp_datasets["public"], "events") as ctx:
            assert ctx.row_count() == 2

    def test_custom_partition_filter_overrides_auto_detection(self, db_config, temp_datasets):
        config = db_config.model_copy(update={"partition_filters": {"events": "event_date = DATE('2026-01-15')"}})
        with _table_context(config, temp_datasets["public"], "events") as ctx:
            rows = ctx.preview()
            assert len(rows) == 2

    def test_is_partitioned_and_requires_filter_flags_are_set(self, db_config, temp_datasets):
        with _table_context(db_config, temp_datasets["public"], "events") as ctx:
            assert ctx.is_partitioned() is True
            assert ctx.requires_partition_filter() is True
            assert ctx.active_partition_filter() is not None

    def test_non_partitioned_table_flags_are_false(self, db_config, temp_datasets):
        with _table_context(db_config, temp_datasets["public"], "users") as ctx:
            assert ctx.is_partitioned() is False
            assert ctx.requires_partition_filter() is False
            assert ctx.active_partition_filter() is None


@contextmanager
def _table_context(config, dataset, table):
    conn = config.connect()
    try:
        yield config.create_context(conn, dataset, table)
    finally:
        conn.disconnect()
