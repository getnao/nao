from unittest.mock import MagicMock

import pytest

from nao_core.config.databases.context import quote_sql_literal
from nao_core.config.databases.databricks import DatabricksDatabaseContext
from nao_core.config.databases.mysql import MysqlDatabaseContext
from nao_core.config.databases.postgres import PostgresDatabaseContext
from nao_core.config.databases.redshift import RedshiftDatabaseContext
from nao_core.config.databases.snowflake import SnowflakeDatabaseContext
from nao_core.config.databases.trino import TrinoDatabaseContext


def test_quote_sql_literal_doubles_single_quotes():
    assert quote_sql_literal("or'ders") == "or''ders"


def test_quote_identifier_escapes_the_delimiter():
    """Each dialect quotes identifiers with its own delimiter; none may be left unescaped."""
    assert PostgresDatabaseContext(MagicMock(), "public", "orders")._quote('or"ders') == '"or""ders"'
    assert MysqlDatabaseContext(MagicMock(), "public", "orders")._quote("or`ders") == "`or``ders`"


CONTEXTS = [
    MysqlDatabaseContext,
    DatabricksDatabaseContext,
    PostgresDatabaseContext,
    RedshiftDatabaseContext,
    SnowflakeDatabaseContext,
    TrinoDatabaseContext,
]


@pytest.mark.parametrize("context_cls", CONTEXTS, ids=lambda cls: cls.__name__)
def test_columns_escapes_quotes_in_identifiers(context_cls):
    """schema/table_name come from nao_config.yaml and land inside SQL literals."""
    conn = MagicMock()
    cursor = MagicMock()
    cursor.fetchall.return_value = []
    cursor.description = []
    conn.raw_sql.return_value = cursor
    conn.sql.return_value.execute.return_value = MagicMock(empty=True)

    context = context_cls(conn, "pub'lic", "or'ders")
    try:
        context.columns()
    except Exception:
        # Only the SQL text matters here; a mocked connection may fail afterwards.
        pass

    issued = " ".join(str(call[0][0]) for call in conn.raw_sql.call_args_list if call[0])
    issued += " ".join(str(call[0][0]) for call in conn.sql.call_args_list if call[0])
    assert issued, f"{context_cls.__name__} issued no metadata query"
    # Either escape is acceptable: a doubled quote inside a literal, or a quoted identifier.
    assert "pub''lic" in issued or '"pub\'lic"' in issued
    assert "or''ders" in issued or '"or\'ders"' in issued
    assert "'pub'lic'" not in issued
