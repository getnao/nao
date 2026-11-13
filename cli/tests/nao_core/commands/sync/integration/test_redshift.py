"""Integration tests for the database sync pipeline against a real Redshift cluster.

Connection is configured via environment variables:
    REDSHIFT_HOST, REDSHIFT_PORT (default 5439), REDSHIFT_DATABASE,
    REDSHIFT_USER, REDSHIFT_PASSWORD, REDSHIFT_SCHEMA (default public),
    REDSHIFT_SSLMODE (default require).

The test suite is skipped entirely when REDSHIFT_HOST is not set.

Datashare discovery is checked against an existing consumer setup when
REDSHIFT_DATASHARE_SCHEMA is set: a schema of REDSHIFT_DATABASE that exposes
datashare tables (e.g. an external schema created FROM REDSHIFT DATABASE on a
database created FROM DATASHARE). Those tests are skipped otherwise.
"""

import os
import uuid

import ibis
import pytest

from nao_core.config.databases.redshift import RedshiftConfig

from .base import BaseSyncIntegrationTests, SyncTestSpec, dml_statements

REDSHIFT_HOST = os.environ.get("REDSHIFT_HOST")

pytestmark = pytest.mark.skipif(
    REDSHIFT_HOST is None, reason="REDSHIFT_HOST not set — skipping Redshift integration tests"
)


@pytest.fixture(scope="module")
def temp_database():
    """Create a temporary database and populate it with test data, then clean up."""
    db_name = f"nao_unit_tests_{uuid.uuid4().hex[:8]}"

    # Connect to default database to create temp database
    conn = ibis.postgres.connect(
        host=os.environ["REDSHIFT_HOST"],
        port=int(os.environ.get("REDSHIFT_PORT", "5439")),
        database=os.environ.get("REDSHIFT_DATABASE", "dev"),
        user=os.environ["REDSHIFT_USER"],
        password=os.environ["REDSHIFT_PASSWORD"],
        client_encoding="utf8",
        sslmode=os.environ.get("REDSHIFT_SSLMODE", "require"),
    )

    try:
        # Create temporary database
        conn.raw_sql(f"CREATE DATABASE {db_name}")

        # Connect to the new database and run setup script
        test_conn = ibis.postgres.connect(
            host=os.environ["REDSHIFT_HOST"],
            port=int(os.environ.get("REDSHIFT_PORT", "5439")),
            database=db_name,
            user=os.environ["REDSHIFT_USER"],
            password=os.environ["REDSHIFT_PASSWORD"],
            client_encoding="utf8",
            sslmode=os.environ.get("REDSHIFT_SSLMODE", "require"),
        )

        for statement in dml_statements("redshift.sql", database=db_name):
            test_conn.raw_sql(statement)

        test_conn.disconnect()

        yield db_name

    finally:
        # Clean up: drop the temporary database (Redshift doesn't support IF EXISTS)
        try:
            conn.raw_sql(f"DROP DATABASE {db_name}")
        except Exception:
            pass  # Database might not exist if setup failed
        conn.disconnect()


@pytest.fixture(scope="module")
def db_config(temp_database):
    """Build a RedshiftConfig from environment variables using the temporary database."""
    return RedshiftConfig(
        name="test-redshift",
        host=os.environ["REDSHIFT_HOST"],
        port=int(os.environ.get("REDSHIFT_PORT", "5439")),
        database=temp_database,
        user=os.environ["REDSHIFT_USER"],
        password=os.environ["REDSHIFT_PASSWORD"],
        schema_name=os.environ.get("REDSHIFT_SCHEMA", "public"),
        sslmode=os.environ.get("REDSHIFT_SSLMODE", "require"),
    )


@pytest.fixture(scope="module")
def spec():
    return SyncTestSpec(
        db_type="redshift",
        primary_schema="public",
        users_column_assertions=(
            "# users",
            "**Dataset:** `public`",
            "## Columns (4)",
            "- id (int32 NOT NULL)",
            "- name (string NOT NULL)",
            '- email (string, "User email address")',
            "- active (boolean)",
        ),
        orders_column_assertions=(
            "# orders",
            "**Dataset:** `public`",
            "## Columns (3)",
            "- id (int32 NOT NULL)",
            "- user_id (int32 NOT NULL)",
            "- amount (float64 NOT NULL)",
        ),
        users_table_description="Registered user accounts",
        schema_field="schema_name",
        another_schema="another",
        another_table="whatever",
    )


class TestRedshiftSyncIntegration(BaseSyncIntegrationTests):
    """Verify the sync pipeline produces correct output against a live Redshift cluster."""


REDSHIFT_DATASHARE_SCHEMA = os.environ.get("REDSHIFT_DATASHARE_SCHEMA")


@pytest.mark.skipif(
    REDSHIFT_DATASHARE_SCHEMA is None,
    reason="REDSHIFT_DATASHARE_SCHEMA not set - skipping Redshift datashare tests",
)
class TestRedshiftDatashareDiscovery:
    """Tables and columns of a datashare schema are discovered, though local catalogs don't list them."""

    @pytest.fixture(scope="class")
    def datashare_conn(self):
        config = RedshiftConfig(
            name="test-redshift-datashare",
            host=os.environ["REDSHIFT_HOST"],
            port=int(os.environ.get("REDSHIFT_PORT", "5439")),
            database=os.environ.get("REDSHIFT_DATABASE", "dev"),
            user=os.environ["REDSHIFT_USER"],
            password=os.environ["REDSHIFT_PASSWORD"],
            schema_name=REDSHIFT_DATASHARE_SCHEMA,
            sslmode=os.environ.get("REDSHIFT_SSLMODE", "require"),
        )
        conn = config.connect()
        yield config, conn
        conn.disconnect()

    def test_lists_datashare_tables_and_columns(self, datashare_conn):
        config, conn = datashare_conn
        schema = str(REDSHIFT_DATASHARE_SCHEMA)

        tables = conn.list_tables(database=schema)

        assert tables, f"no tables listed in datashare schema {schema}"
        context = config.create_context(conn, schema, tables[0])
        assert context.columns(), f"no columns read for {schema}.{tables[0]}"
        assert conn.list_live_columns(tables[0], database=schema)
