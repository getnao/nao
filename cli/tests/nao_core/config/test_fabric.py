import struct
from typing import Any

import pytest
from pydantic import ValidationError

from nao_core.config.databases.fabric import (
    FABRIC_SYSTEM_SCHEMAS,
    FabricAuthMode,
    FabricConfig,
    _encode_access_token,
    _odbc_escape,
)

# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------

HOST = "abc.datawarehouse.fabric.microsoft.com"
DRIVER = "ODBC Driver 18 for SQL Server"


def _fabric_config(auth_mode: FabricAuthMode, **overrides: Any) -> FabricConfig:
    fields: dict[str, Any] = {"name": "test", "host": HOST, "database": "mydb", "auth_mode": auth_mode, **overrides}
    return FabricConfig(**fields)


def _service_principal_config(**fields) -> FabricConfig:
    return _fabric_config(
        FabricAuthMode.AZURE_SERVICE_PRINCIPAL, client_id="my-client-id", client_secret="my-secret", **fields
    )


_BASE_SQL_CONFIG = _fabric_config(FabricAuthMode.SQL_PASSWORD, user="myuser", password="mypassword", driver=DRIVER)


def _sql_config(**kwargs) -> FabricConfig:
    return _BASE_SQL_CONFIG.model_copy(update=kwargs)


def _fake_conn(schemas: list[str]):
    class FakeConn:
        def list_databases(self):
            return schemas

    return FakeConn()


# ---------------------------------------------------------------------------
# Construction & validation
# ---------------------------------------------------------------------------


def test_sql_auth_valid():
    config = _fabric_config(FabricAuthMode.SQL_PASSWORD, user="myuser", password="mypassword")
    assert config.auth_mode == FabricAuthMode.SQL_PASSWORD
    assert config.user == "myuser"
    assert config.password == "mypassword"


@pytest.mark.parametrize(
    ("auth_mode", "credentials", "message"),
    [
        pytest.param(
            FabricAuthMode.SQL_PASSWORD, {"password": "secret"}, "user and password are required", id="sql_missing_user"
        ),
        pytest.param(
            FabricAuthMode.SQL_PASSWORD, {"user": "myuser"}, "user and password are required", id="sql_missing_password"
        ),
        pytest.param(
            FabricAuthMode.AZURE_SERVICE_PRINCIPAL,
            {"client_secret": "my-secret"},
            "client_id and client_secret are required",
            id="service_principal_missing_client_id",
        ),
        pytest.param(
            FabricAuthMode.AZURE_SERVICE_PRINCIPAL,
            {"client_id": "my-client-id"},
            "client_id and client_secret are required",
            id="service_principal_missing_client_secret",
        ),
    ],
)
def test_missing_credentials_raise(auth_mode, credentials, message):
    with pytest.raises(ValidationError, match=message):
        _fabric_config(auth_mode, **credentials)


def test_azure_interactive_requires_no_credentials():
    config = _fabric_config(FabricAuthMode.AZURE_INTERACTIVE)
    assert config.auth_mode == FabricAuthMode.AZURE_INTERACTIVE
    assert config.user is None
    assert config.password is None
    assert config.client_id is None


def test_azure_cli_requires_no_credentials():
    config = _fabric_config(FabricAuthMode.AZURE_CLI)
    assert config.auth_mode == FabricAuthMode.AZURE_CLI
    assert config.user is None
    assert config.client_id is None


def test_service_principal_valid():
    config = _service_principal_config()
    assert config.auth_mode == FabricAuthMode.AZURE_SERVICE_PRINCIPAL
    assert config.tenant_id is None


def test_service_principal_with_tenant_id():
    config = _service_principal_config(tenant_id="my-tenant")
    assert config.tenant_id == "my-tenant"


# ---------------------------------------------------------------------------
# Access token encoding
# ---------------------------------------------------------------------------


def test_encode_access_token_produces_bytes():
    result = _encode_access_token("mytoken")
    assert isinstance(result, bytes)


def test_encode_access_token_utf16le_with_length_prefix():
    token = "hello"
    result = _encode_access_token(token)
    token_bytes = token.encode("utf-16-le")
    # First 4 bytes are a little-endian uint32 length prefix.
    expected_length = struct.unpack("<I", result[:4])[0]
    assert expected_length == len(token_bytes)
    assert result[4:] == token_bytes


# ---------------------------------------------------------------------------
# ODBC value escaping
# ---------------------------------------------------------------------------


@pytest.mark.parametrize(
    ("value", "escaped"),
    [
        pytest.param("mypassword", "mypassword", id="plain_value_unchanged"),
        pytest.param("pass;word", "{pass;word}", id="semicolon"),
        pytest.param("key=value", "{key=value}", id="equals"),
        pytest.param("val{ue", "{val{ue}", id="opening_brace"),
        pytest.param("val}ue", "{val}}ue}", id="closing_brace_doubled"),
        pytest.param("a}b}c", "{a}}b}}c}", id="multiple_closing_braces"),
        pytest.param("", "", id="empty_string"),
    ],
)
def test_odbc_escape(value, escaped):
    assert _odbc_escape(value) == escaped


# ---------------------------------------------------------------------------
# ODBC connection string building
# ---------------------------------------------------------------------------


def test_sql_auth_odbc_string_contains_required_parts():
    odbc = _sql_config().build_odbc_string()
    assert "Driver={ODBC Driver 18 for SQL Server}" in odbc
    assert "Server=abc.datawarehouse.fabric.microsoft.com,1433" in odbc
    assert "Database=mydb" in odbc
    assert "UID=myuser" in odbc
    assert "PWD=mypassword" in odbc
    assert "Encrypt=yes" in odbc
    assert "TrustServerCertificate=no" in odbc


def test_sql_auth_odbc_string_has_no_authentication_key():
    odbc = _sql_config().build_odbc_string()
    assert "Authentication=" not in odbc


def test_azure_interactive_odbc_string_has_no_credentials():
    # azure_interactive uses InteractiveBrowserCredential to obtain a token and injects it
    # via SQL_COPT_SS_ACCESS_TOKEN — it does not embed credentials in the ODBC string.
    odbc = _fabric_config(FabricAuthMode.AZURE_INTERACTIVE, driver=DRIVER).build_odbc_string()
    assert "Authentication=" not in odbc
    assert "UID=" not in odbc
    assert "PWD=" not in odbc


def test_service_principal_odbc_string_without_tenant():
    odbc = _service_principal_config(driver=DRIVER).build_odbc_string()
    assert "Authentication=ActiveDirectoryServicePrincipal" in odbc
    # Without tenant_id, UID must be the bare client_id (no @ suffix).
    assert "UID=my-client-id;" in odbc
    assert "PWD=my-secret" in odbc


def test_service_principal_odbc_string_with_tenant():
    odbc = _service_principal_config(tenant_id="my-tenant", driver=DRIVER).build_odbc_string()
    assert "UID=my-client-id@my-tenant" in odbc


def test_custom_port_in_odbc_string():
    odbc = _sql_config(port=1434).build_odbc_string()
    assert "Server=abc.datawarehouse.fabric.microsoft.com,1434" in odbc


@pytest.mark.parametrize(
    ("overrides", "fragment"),
    [
        pytest.param({"password": "pass;word"}, "PWD={pass;word}", id="password_with_semicolon"),
        pytest.param({"password": "p}ss"}, "PWD={p}}ss}", id="password_with_closing_brace"),
        pytest.param({"user": "user=name"}, "UID={user=name}", id="username_with_special_chars"),
        pytest.param({"database": "my;db"}, "Database={my;db}", id="database_with_special_chars"),
    ],
)
def test_sql_auth_special_characters_are_escaped(overrides, fragment):
    odbc = _sql_config(**overrides).build_odbc_string()
    assert fragment in odbc


def test_service_principal_secret_with_special_chars_is_escaped():
    config = _fabric_config(
        FabricAuthMode.AZURE_SERVICE_PRINCIPAL, client_id="my-client-id", client_secret="sec;ret=val", driver=DRIVER
    )
    odbc = config.build_odbc_string()
    assert "PWD={sec;ret=val}" in odbc


# ---------------------------------------------------------------------------
# Schema filtering
# ---------------------------------------------------------------------------


def test_system_schemas_excluded_from_get_schemas():
    config = _sql_config()
    schemas = config.get_schemas(_fake_conn(["dbo", "analytics", "sys", "INFORMATION_SCHEMA", "guest"]))
    assert "sys" not in schemas
    assert "INFORMATION_SCHEMA" not in schemas
    assert "guest" not in schemas
    assert "dbo" in schemas
    assert "analytics" in schemas


def test_explicit_schema_name_bypasses_system_filter():
    config = _sql_config(schema_name="analytics")
    schemas = config.get_schemas(None)  # type: ignore
    assert schemas == ["analytics"]


def test_fabric_system_schemas_constant_contains_expected_values():
    assert "sys" in FABRIC_SYSTEM_SCHEMAS
    assert "INFORMATION_SCHEMA" in FABRIC_SYSTEM_SCHEMAS
    assert "guest" in FABRIC_SYSTEM_SCHEMAS


# ---------------------------------------------------------------------------
# Metadata helpers
# ---------------------------------------------------------------------------


def test_get_database_name():
    config = _fabric_config(FabricAuthMode.AZURE_INTERACTIVE, database="my_warehouse")
    assert config.get_database_name() == "my_warehouse"


def test_default_port_is_1433():
    assert _sql_config().port == 1433


# ---------------------------------------------------------------------------
# Pattern matching (inherited from DatabaseConfig)
# ---------------------------------------------------------------------------


def test_include_pattern_matches():
    config = _sql_config(include=["analytics.*"])
    assert config.matches_pattern("analytics", "sales") is True
    assert config.matches_pattern("staging", "tmp") is False


def test_exclude_pattern_filters_out():
    config = _sql_config(exclude=["staging.*"])
    assert config.matches_pattern("analytics", "sales") is True
    assert config.matches_pattern("staging", "tmp") is False


# ---------------------------------------------------------------------------
# Serialisation round-trip
# ---------------------------------------------------------------------------


@pytest.mark.parametrize(
    "config",
    [
        pytest.param(_sql_config(), id="sql_auth"),
        pytest.param(_fabric_config(FabricAuthMode.AZURE_INTERACTIVE), id="azure_interactive"),
        pytest.param(
            _fabric_config(
                FabricAuthMode.AZURE_SERVICE_PRINCIPAL, client_id="cid", client_secret="cs", tenant_id="tid"
            ),
            id="service_principal",
        ),
    ],
)
def test_round_trip(config):
    assert FabricConfig.model_validate(config.model_dump()) == config
