"""Unit tests for Trino database config."""

from unittest.mock import MagicMock, patch

import ibis
import pytest
from trino.auth import BasicAuthentication, JWTAuthentication

from nao_core.config.databases.trino import TrinoConfig, TrinoDatabaseContext


@pytest.fixture
def base_config() -> TrinoConfig:
    return TrinoConfig(
        name="t",
        host="trino.example",
        port=8080,
        catalog="hive",
        user="alice",
        password=None,
        schema_name=None,
    )


def test_create_context_returns_trino_context(base_config: TrinoConfig) -> None:
    mock_conn = MagicMock()
    ctx = base_config.create_context(mock_conn, "analytics", "orders")
    assert isinstance(ctx, TrinoDatabaseContext)


def test_description_reads_table_comment_from_system_metadata() -> None:
    conn = MagicMock()
    conn.current_catalog = "hive"
    conn.raw_sql.return_value.fetchone.return_value = ("Revenue facts",)

    ctx = TrinoDatabaseContext(conn, "dev_gold", "observed_interest_rates")
    assert ctx.description() == "Revenue facts"

    sql = conn.raw_sql.call_args[0][0]
    assert "system.metadata.table_comments" in sql
    assert "catalog_name" in sql and "schema_name" in sql and "table_name" in sql
    assert "hive" in sql and "dev_gold" in sql and "observed_interest_rates" in sql


def test_description_returns_none_when_query_raises() -> None:
    conn = MagicMock()
    conn.current_catalog = "hive"
    conn.raw_sql.side_effect = RuntimeError("no metadata")

    ctx = TrinoDatabaseContext(conn, "s", "t")
    assert ctx.description() is None


def test_description_returns_none_when_comment_empty() -> None:
    conn = MagicMock()
    conn.current_catalog = "hive"
    conn.raw_sql.return_value.fetchone.return_value = ("   ",)

    ctx = TrinoDatabaseContext(conn, "s", "t")
    assert ctx.description() is None


def test_columns_merge_comment_from_describe_output() -> None:
    """DESCRIBE rows: Column | Type | Extra | Comment | ... (comment at index 3)."""
    conn = _conn_with_schema({"id": "int64", "name": "string"})

    describe_rows = [
        ("id", "bigint", "", "primary key", None),
        ("name", "varchar", "", "display name", None),
    ]
    conn.raw_sql.return_value.fetchall.return_value = describe_rows

    ctx = TrinoDatabaseContext(conn, "dev", "users")
    cols = ctx.columns()

    sql = conn.raw_sql.call_args[0][0]
    assert sql.strip().startswith("DESCRIBE")
    assert '"dev"."users"' in sql

    by_name = {c["name"]: c.get("description") for c in cols}
    assert by_name["id"] == "primary key"
    assert by_name["name"] == "display name"


def test_columns_case_insensitive_comment_match() -> None:
    conn = _conn_with_schema({"UserId": "int64"})

    conn.raw_sql.return_value.fetchall.return_value = [("userid", "bigint", "", "from metastore", None)]

    ctx = TrinoDatabaseContext(conn, "s", "t")
    cols = ctx.columns()
    assert cols[0]["name"] == "UserId"
    assert cols[0]["description"] == "from metastore"


def test_columns_skips_short_rows_and_empty_comment() -> None:
    conn = _conn_with_schema({"a": "int64", "b": "int64"})

    conn.raw_sql.return_value.fetchall.return_value = [
        ("a", "int", ""),  # too few columns
        ("b", "int", "", "", None),  # comment empty
        ("b", "int", "", "ok", None),
    ]

    ctx = TrinoDatabaseContext(conn, "s", "t")
    cols = ctx.columns()
    by_name = {c["name"]: c.get("description") for c in cols}
    assert by_name.get("a") is None
    assert by_name["b"] == "ok"


def test_columns_unchanged_when_describe_raises() -> None:
    conn = _conn_with_schema({"x": "int64"})
    conn.raw_sql.side_effect = RuntimeError("permission denied")

    ctx = TrinoDatabaseContext(conn, "s", "t")
    cols = ctx.columns()
    assert len(cols) == 1
    assert cols[0]["name"] == "x"
    assert cols[0].get("description") is None


def test_connect_passes_user_without_password(base_config: TrinoConfig) -> None:
    call_kw = _connect_kwargs(base_config)
    assert call_kw["host"] == "trino.example"
    assert call_kw["port"] == 8080
    assert call_kw["user"] == "alice"
    assert call_kw["database"] == "hive"
    assert "auth" not in call_kw


def test_connect_uses_basic_auth_when_password_set(base_config: TrinoConfig) -> None:
    cfg = base_config.model_copy(update={"password": "secret"})
    call_kw = _connect_kwargs(cfg)
    assert call_kw["user"] == "alice"
    assert "password" not in call_kw
    auth = call_kw.get("auth")
    assert isinstance(auth, BasicAuthentication)


def test_connect_includes_schema_when_set(base_config: TrinoConfig) -> None:
    cfg = base_config.model_copy(update={"schema_name": "analytics"})
    call_kw = _connect_kwargs(cfg)
    assert call_kw["schema"] == "analytics"


def test_connect_defaults_to_http_scheme_without_verify(base_config: TrinoConfig) -> None:
    """Default scheme is http (backwards-compatible); verify must not be forwarded."""
    call_kw = _connect_kwargs(base_config)
    assert call_kw["http_scheme"] == "http"
    assert "verify" not in call_kw


def test_connect_https_forwards_verify_true_by_default(base_config: TrinoConfig) -> None:
    cfg = base_config.model_copy(update={"http_scheme": "https"})
    call_kw = _connect_kwargs(cfg)
    assert call_kw["http_scheme"] == "https"
    assert call_kw["verify"] is True


def test_connect_https_with_custom_ca_bundle_path(base_config: TrinoConfig) -> None:
    cfg = base_config.model_copy(update={"http_scheme": "https", "verify": "/etc/ssl/internal-ca.pem"})
    call_kw = _connect_kwargs(cfg)
    assert call_kw["verify"] == "/etc/ssl/internal-ca.pem"


def test_connect_https_with_verify_disabled(base_config: TrinoConfig) -> None:
    cfg = base_config.model_copy(update={"http_scheme": "https", "verify": False})
    call_kw = _connect_kwargs(cfg)
    assert call_kw["verify"] is False


def test_connect_http_ignores_verify_field(base_config: TrinoConfig) -> None:
    """Setting `verify` while scheme stays 'http' must not leak it into the connect call."""
    cfg = base_config.model_copy(update={"verify": False})
    call_kw = _connect_kwargs(cfg)
    assert call_kw["http_scheme"] == "http"
    assert "verify" not in call_kw


def test_connect_jwt_uses_jwt_auth_and_forces_https(base_config: TrinoConfig) -> None:
    cfg = base_config.model_copy(update={"jwt_token": "eyJhbGciOi.payload.sig"})
    call_kw = _connect_kwargs(cfg)
    assert call_kw["http_scheme"] == "https"  # forced even though base_config is http
    assert isinstance(call_kw.get("auth"), JWTAuthentication)


def test_connect_blank_jwt_token_is_ignored(base_config: TrinoConfig) -> None:
    """A whitespace-only inline jwt_token must not force https, enable JWT auth,
    or block the password fallback."""
    cfg = base_config.model_copy(update={"jwt_token": "   \n", "password": "secret"})
    call_kw = _connect_kwargs(cfg)
    assert call_kw["http_scheme"] == "http"  # not forced to https by a blank token
    assert isinstance(call_kw.get("auth"), BasicAuthentication)  # password fallback intact


def test_connect_jwt_takes_precedence_over_password(base_config: TrinoConfig) -> None:
    cfg = base_config.model_copy(update={"jwt_token": "tok", "password": "secret"})
    call_kw = _connect_kwargs(cfg)
    assert isinstance(call_kw.get("auth"), JWTAuthentication)


def test_connect_jwt_token_file_is_read_fresh(base_config: TrinoConfig, tmp_path) -> None:
    token_file = tmp_path / "trino-token"
    token_file.write_text("file-token-123")
    cfg = base_config.model_copy(update={"jwt_token_file": str(token_file)})
    first_auth = _connect_kwargs(cfg).get("auth")
    assert isinstance(first_auth, JWTAuthentication)
    assert first_auth.token == "file-token-123"

    # Rotating the file must be picked up on the next connect — assert the
    # bearer token actually changed, so a "read once and cache" bug fails.
    token_file.write_text("rotated-token-456")
    second_auth = _connect_kwargs(cfg).get("auth")
    assert isinstance(second_auth, JWTAuthentication)
    assert second_auth.token == "rotated-token-456"


def _connect_kwargs(config: TrinoConfig) -> dict:
    mock_connect = MagicMock()
    with (
        patch("nao_core.deps.require_database_backend"),
        patch("ibis.trino.connect", mock_connect),
    ):
        config.connect()
    mock_connect.assert_called_once()
    return dict(mock_connect.call_args.kwargs)


def _conn_with_schema(columns: dict[str, str]) -> MagicMock:
    conn = MagicMock()
    conn.table.return_value.schema.return_value = ibis.schema(columns)
    return conn
