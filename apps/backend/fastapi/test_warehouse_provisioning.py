import json

import pytest
import yaml
from fastapi.testclient import TestClient
from main import app
from nao_core.config import NaoConfig
from pydantic import ValidationError
from warehouse_provisioning import prepare_warehouse_config

INTERNAL_SECRET = "test-internal-secret-at-least-20-characters"
INTERNAL_HEADERS = {"X-Nao-Internal-Secret": INTERNAL_SECRET}
POSTGRES_REQUEST = {
    "project_name": "Analytics",
    "provider": "postgres",
    "credentials": {
        "host": "localhost",
        "port": 5433,
        "database": "analytics",
        "user": "nao",
        "password": "secret",
        "schema_name": "warehouse",
    },
}
BIGQUERY_CREDENTIALS_JSON = {
    "type": "service_account",
    "project_id": "nao-analytics",
    "private_key_id": "key-id",
    "private_key": "-----BEGIN PRIVATE KEY-----\nprivate-key\n-----END PRIVATE KEY-----\n",
    "client_email": "nao@nao-analytics.iam.gserviceaccount.com",
    "token_uri": "https://oauth2.googleapis.com/token",
}

SCALAR_WAREHOUSE_CASES = [
    pytest.param(
        "athena",
        {
            "s3_staging_dir": "s3://nao-results",
            "region_name": "us-east-1",
            "aws_access_key_id": "access-key",
            "aws_secret_access_key": "secret-key",
        },
        id="athena",
    ),
    pytest.param(
        "clickhouse",
        {
            "host": "clickhouse.example.com",
            "port": 8443,
            "database": "analytics",
            "user": "nao",
            "password": "secret",
            "secure": True,
        },
        id="clickhouse",
    ),
    pytest.param(
        "databricks",
        {
            "server_hostname": "workspace.databricks.com",
            "http_path": "/sql/1.0/warehouses/example",
            "access_token": "token",
            "catalog": "analytics",
        },
        id="databricks",
    ),
    pytest.param(
        "duckdb",
        {"path": "/tmp/analytics.duckdb"},
        id="duckdb",
    ),
    pytest.param(
        "fabric",
        {
            "host": "warehouse.fabric.microsoft.com",
            "database": "analytics",
            "auth_mode": "sql_password",
            "user": "nao",
            "password": "secret",
        },
        id="fabric",
    ),
    pytest.param(
        "motherduck",
        {"database": "analytics", "token": "token"},
        id="motherduck",
    ),
    pytest.param(
        "mssql",
        {
            "host": "mssql.example.com",
            "port": 1433,
            "database": "analytics",
            "user": "nao",
            "password": "secret",
        },
        id="mssql",
    ),
    pytest.param(
        "mysql",
        {
            "host": "mysql.example.com",
            "port": 3306,
            "database": "analytics",
            "user": "nao",
            "password": "secret",
        },
        id="mysql",
    ),
    pytest.param(
        "redshift",
        {
            "host": "cluster.redshift.amazonaws.com",
            "database": "analytics",
            "auth_mode": "password",
            "user": "nao",
            "password": "secret",
        },
        id="redshift",
    ),
    pytest.param(
        "snowflake",
        {
            "username": "nao",
            "account_id": "xy12345.us-east-1",
            "database": "analytics",
            "password": "secret",
            "warehouse": "compute_wh",
            "schema_name": "public",
        },
        id="snowflake",
    ),
    pytest.param(
        "starrocks",
        {
            "host": "starrocks.example.com",
            "port": 9030,
            "user": "nao",
            "password": "secret",
            "database": "analytics",
        },
        id="starrocks",
    ),
    pytest.param(
        "trino",
        {
            "host": "trino.example.com",
            "port": 8443,
            "catalog": "analytics",
            "user": "nao",
            "password": "secret",
            "http_scheme": "https",
        },
        id="trino",
    ),
]


@pytest.fixture(autouse=True)
def internal_secret(monkeypatch):
    monkeypatch.setenv("BETTER_AUTH_SECRET", INTERNAL_SECRET)


def test_prepare_postgres_warehouse_config():
    database_config, env_vars = prepare_warehouse_config(
        project_name="Analytics",
        provider="postgres",
        credentials={
            "host": "localhost",
            "port": 5433,
            "database": "analytics",
            "user": "nao",
            "password": "secret",
            "schema_name": "warehouse",
        },
    )

    assert database_config == {
        "type": "postgres",
        "name": "Analytics",
        "database": "${{ env('NAO_ONBOARDING_POSTGRES_DATABASE') }}",
        "host": "${{ env('NAO_ONBOARDING_POSTGRES_HOST') }}",
        "password": "${{ env('NAO_ONBOARDING_POSTGRES_PASSWORD') }}",
        "port": "${{ env('NAO_ONBOARDING_POSTGRES_PORT') }}",
        "schema_name": "${{ env('NAO_ONBOARDING_POSTGRES_SCHEMA_NAME') }}",
        "user": "${{ env('NAO_ONBOARDING_POSTGRES_USER') }}",
    }
    assert env_vars["NAO_ONBOARDING_POSTGRES_PASSWORD"] == json.dumps("secret")
    assert env_vars["NAO_ONBOARDING_POSTGRES_PORT"] == "5433"
    assert "secret" not in json.dumps(database_config)


@pytest.mark.parametrize(("provider", "credentials"), SCALAR_WAREHOUSE_CASES)
def test_prepare_scalar_warehouse_config(provider, credentials):
    database_config, env_vars = prepare_warehouse_config(
        project_name="Analytics",
        provider=provider,
        credentials=credentials,
    )

    assert database_config["type"] == provider
    assert database_config["name"] == "Analytics"

    for field_name, value in credentials.items():
        env_name = f"NAO_ONBOARDING_{provider.upper()}_{field_name.upper()}"
        assert database_config[field_name] == f"${{{{ env('{env_name}') }}}}"
        assert env_vars[env_name] == json.dumps(value)


def test_prepare_nested_bigquery_credentials():
    database_config, env_vars = prepare_warehouse_config(
        project_name="Analytics",
        provider="bigquery",
        credentials={
            "project_id": "nao-analytics",
            "credentials_json": BIGQUERY_CREDENTIALS_JSON,
        },
    )

    credentials_config = database_config["credentials_json"]
    assert isinstance(credentials_config, dict)

    for field_name, value in BIGQUERY_CREDENTIALS_JSON.items():
        env_name = "NAO_ONBOARDING_BIGQUERY_CREDENTIALS_JSON_" + field_name.upper()
        assert credentials_config[field_name] == f"${{{{ env('{env_name}') }}}}"
        assert env_vars[env_name] == json.dumps(value)

    assert BIGQUERY_CREDENTIALS_JSON["private_key"] not in json.dumps(database_config)


def test_prepare_nested_bigquery_credentials_round_trip(tmp_path):
    database_config, env_vars = prepare_warehouse_config(
        project_name="Analytics",
        provider="bigquery",
        credentials={
            "project_id": "nao-analytics",
            "credentials_json": BIGQUERY_CREDENTIALS_JSON,
        },
    )
    config_file = tmp_path / "nao_config.yaml"
    config_file.write_text(
        yaml.safe_dump(
            {
                "project_name": "Analytics",
                "databases": [database_config],
            },
            sort_keys=False,
        )
    )

    loaded_config = NaoConfig.load(tmp_path, extra_env=env_vars)

    assert loaded_config.databases[0].credentials_json == BIGQUERY_CREDENTIALS_JSON


def test_prepare_nested_redshift_ssh_tunnel():
    ssh_tunnel = {
        "ssh_host": "bastion.example.com",
        "ssh_port": 22,
        "ssh_username": "nao",
        "ssh_private_key_path": "/run/secrets/redshift-key",
        "ssh_private_key_passphrase": "key-passphrase",
    }
    database_config, env_vars = prepare_warehouse_config(
        project_name="Analytics",
        provider="redshift",
        credentials={
            "host": "cluster.redshift.amazonaws.com",
            "database": "analytics",
            "auth_mode": "password",
            "user": "nao",
            "password": "secret",
            "ssh_tunnel": ssh_tunnel,
        },
    )

    tunnel_config = database_config["ssh_tunnel"]
    assert isinstance(tunnel_config, dict)

    for field_name, value in ssh_tunnel.items():
        env_name = "NAO_ONBOARDING_REDSHIFT_SSH_TUNNEL_" + field_name.upper()
        assert tunnel_config[field_name] == f"${{{{ env('{env_name}') }}}}"
        assert env_vars[env_name] == json.dumps(value)

    assert ssh_tunnel["ssh_private_key_passphrase"] not in json.dumps(database_config)


def test_prepare_postgres_warehouse_config_rejects_invalid_credentials():
    with pytest.raises(ValidationError):
        prepare_warehouse_config(
            project_name="Analytics",
            provider="postgres",
            credentials={
                "database": "analytics",
                "user": "nao",
                "password": "secret",
            },
        )


def test_prepare_warehouse_endpoint_requires_internal_secret():
    response = TestClient(app).post("/warehouse/prepare", json=POSTGRES_REQUEST)

    assert response.status_code == 401


def test_prepare_warehouse_endpoint_returns_postgres_config():
    response = TestClient(app, headers=INTERNAL_HEADERS).post(
        "/warehouse/prepare",
        json=POSTGRES_REQUEST,
    )

    assert response.status_code == 200
    body = response.json()
    assert body["database_config"]["type"] == "postgres"
    assert (
        body["database_config"]["host"] == "${{ env('NAO_ONBOARDING_POSTGRES_HOST') }}"
    )
    assert body["env_vars"]["NAO_ONBOARDING_POSTGRES_PASSWORD"] == json.dumps("secret")
    assert "secret" not in json.dumps(body["database_config"])


def test_prepare_warehouse_endpoint_redacts_invalid_credentials():
    password = "must-not-leak"
    response = TestClient(app, headers=INTERNAL_HEADERS).post(
        "/warehouse/prepare",
        json={
            "project_name": "Analytics",
            "provider": "postgres",
            "credentials": {
                "database": "analytics",
                "user": "nao",
                "password": password,
            },
        },
    )

    assert response.status_code == 422
    assert response.json() == {
        "detail": {
            "code": "invalid_warehouse_credentials",
            "fields": ["host"],
        }
    }
    assert password not in response.text
