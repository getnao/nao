from nao_core.config.databases.postgres import _postgres_connection_hint


def test_hint_no_valid_code():
    hint = _postgres_connection_hint("No valid code found")
    assert hint is not None
    assert "psycopg" in hint
    assert "OAuth" in hint or "identity-provider" in hint


def test_hint_jdbc_version():
    hint = _postgres_connection_hint("Driver org.postgresql.Driver version 42.2.5 conflicts with expected 42.2.3")
    assert hint is not None
    assert "psycopg" in hint
    assert "JDBC" in hint


def test_hint_none_for_generic():
    assert _postgres_connection_hint("connection refused") is None
