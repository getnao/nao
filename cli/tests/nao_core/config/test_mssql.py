import sys
from types import SimpleNamespace
from typing import Any, cast

import pytest
from pydantic import ValidationError

from nao_core.config.databases import mssql as mssql_module
from nao_core.config.databases import parse_database_config
from nao_core.config.databases.fabric import FabricConfig
from nao_core.config.databases.mssql import MssqlAuthMode, MssqlConfig
from nao_core.config.databases.row_security_guard import enforce_row_security

AZURE_HOST = "myserver.database.windows.net"


def _service_principal_config(**kwargs) -> MssqlConfig:
    return MssqlConfig.model_validate(
        {
            "name": "azure-sql",
            "host": AZURE_HOST,
            "database": "sales",
            "auth_mode": MssqlAuthMode.AZURE_SERVICE_PRINCIPAL,
            "client_id": "my-client-id",
            "client_secret": "my-secret",
            "tenant_id": "my-tenant",
            **kwargs,
        }
    )


class FakeConnection:
    def __init__(self):
        self.schemas = {"dbo": ["orders"], "sys": ["objects"]}

    def list_databases(self) -> list[str]:
        return list(self.schemas)

    def list_tables(self, database: str) -> list[str]:
        return self.schemas[database]

    def disconnect(self) -> None:
        pass


def test_sql_password_remains_the_default_auth_mode():
    config = MssqlConfig(name="onprem", host="localhost", database="db", user="sa", password="secret", driver="FreeTDS")

    assert config.auth_mode == MssqlAuthMode.SQL_PASSWORD
    assert config.driver == "FreeTDS"


def test_sql_password_allows_empty_password():
    config = MssqlConfig(name="onprem", host="localhost", database="db", user="sa", password="")

    assert config.password == ""


def test_sql_password_requires_user_and_password():
    with pytest.raises(ValidationError, match="user and password are required"):
        MssqlConfig(name="onprem", host="localhost", database="db", password="secret")


def test_service_principal_requires_client_id_and_secret():
    with pytest.raises(ValidationError, match="client_id and client_secret are required"):
        MssqlConfig(
            name="azure-sql",
            host=AZURE_HOST,
            database="sales",
            auth_mode=MssqlAuthMode.AZURE_SERVICE_PRINCIPAL,
            client_id="my-client-id",
        )


@pytest.mark.parametrize("auth_mode", ["azure_cli", "azure_interactive"])
def test_token_based_entra_id_modes_need_no_credentials(auth_mode: str):
    config = MssqlConfig(name="azure-sql", host=AZURE_HOST, database="sales", auth_mode=auth_mode)  # type: ignore[arg-type]

    assert config.user is None
    assert config.client_id is None


def test_entra_id_modes_default_to_microsoft_odbc_driver(monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setattr(mssql_module, "_detect_odbc_driver", lambda: "FreeTDS")
    monkeypatch.setattr(mssql_module, "_detect_fabric_driver", lambda: "ODBC Driver 18 for SQL Server")

    assert _service_principal_config().driver == "ODBC Driver 18 for SQL Server"
    assert _service_principal_config(driver="ODBC Driver 17 for SQL Server").driver == "ODBC Driver 17 for SQL Server"


def test_prompt_config_supports_entra_id_service_principal(monkeypatch: pytest.MonkeyPatch):
    answers = iter(["azure-sql", AZURE_HOST, "1433", "sales", "my-client-id", "my-secret", "", "", ""])
    monkeypatch.setattr(mssql_module, "ask_text", lambda *args, **kwargs: next(answers))
    monkeypatch.setattr(mssql_module, "ask_select", lambda *args, **kwargs: "Entra ID Service Principal (Azure SQL)")
    monkeypatch.setattr(mssql_module, "_detect_fabric_driver", lambda: "ODBC Driver 18 for SQL Server")

    config = MssqlConfig.promptConfig()

    assert config.auth_mode == MssqlAuthMode.AZURE_SERVICE_PRINCIPAL
    assert config.client_id == "my-client-id"
    assert config.client_secret == "my-secret"
    assert config.user is None
    assert config.driver == "ODBC Driver 18 for SQL Server"


def test_parses_entra_id_config_from_yaml_dict():
    config = parse_database_config(
        {
            "type": "mssql",
            "name": "azure-sql",
            "host": AZURE_HOST,
            "database": "sales",
            "auth_mode": "azure_service_principal",
            "client_id": "my-client-id",
            "client_secret": "my-secret",
        }
    )

    assert isinstance(config, MssqlConfig)
    assert config.auth_mode == MssqlAuthMode.AZURE_SERVICE_PRINCIPAL


def test_service_principal_reuses_fabric_entra_id_connection_string():
    config = _service_principal_config(driver="ODBC Driver 18 for SQL Server")
    odbc = config._to_entra_id_config().build_odbc_string()

    assert f"Server={AZURE_HOST},1433" in odbc
    assert "Database=sales" in odbc
    assert "Encrypt=yes" in odbc
    assert "Authentication=ActiveDirectoryServicePrincipal" in odbc
    assert "UID=my-client-id;" in odbc
    assert "my-tenant" not in odbc
    assert "PWD=my-secret" in odbc


def test_entra_id_connect_delegates_to_fabric_connection(monkeypatch: pytest.MonkeyPatch):
    connected: list[FabricConfig] = []
    monkeypatch.setattr("nao_core.deps.require_database_backend", lambda *args, **kwargs: None)
    monkeypatch.setattr(FabricConfig, "connect", lambda self: connected.append(self) or "connection")

    config = _service_principal_config(tenant_id=None, driver="ODBC Driver 18 for SQL Server")

    assert config.connect() == "connection"
    assert connected[0].auth_mode == MssqlAuthMode.AZURE_SERVICE_PRINCIPAL
    assert connected[0].driver == "ODBC Driver 18 for SQL Server"


def test_service_principal_with_tenant_injects_tenant_scoped_token(monkeypatch: pytest.MonkeyPatch):
    import azure.identity

    injected: list[tuple[FabricConfig, Any]] = []
    monkeypatch.setattr("nao_core.deps.require_database_backend", lambda *args, **kwargs: None)
    monkeypatch.setattr(azure.identity, "ClientSecretCredential", lambda *args: ("credential", *args))
    monkeypatch.setattr(
        FabricConfig,
        "_connect_via_aad_token_injection",
        lambda self, credential, message: injected.append((self, credential)) or "connection",
    )

    assert _service_principal_config().connect() == "connection"
    fabric_config, credential = injected[0]
    assert credential == ("credential", "my-tenant", "my-client-id", "my-secret")
    assert fabric_config.tenant_id is None


def test_sql_password_connect_uses_ibis_mssql_backend(monkeypatch: pytest.MonkeyPatch):
    calls: list[dict] = []
    fake_ibis = SimpleNamespace(mssql=SimpleNamespace(connect=lambda **kwargs: calls.append(kwargs) or "connection"))
    monkeypatch.setattr("nao_core.deps.require_database_backend", lambda *args, **kwargs: None)
    monkeypatch.setitem(sys.modules, "ibis", fake_ibis)
    config = MssqlConfig(name="onprem", host="localhost", database="db", user="sa", password="secret", driver="FreeTDS")

    assert config.connect() == "connection"
    assert calls == [
        {"host": "localhost", "port": 1433, "database": "db", "user": "sa", "password": "secret", "driver": "FreeTDS"}
    ]


def test_row_security_predicate_is_injected_for_entra_id_connections():
    sql = enforce_row_security(
        "SELECT TOP 10 id FROM dbo.orders",
        cast(Any, _service_principal_config()),
        {
            ("dbo", "orders"): {
                "access": "predicate",
                "constraint_columns": ["company_id"],
                "predicate": "company_id = 7",
            }
        },
        conn=FakeConnection(),
    )

    assert sql == "SELECT TOP 10 id FROM dbo.orders WHERE orders.company_id = 7"
