import json

import pytest
import yaml
from fastapi.testclient import TestClient
from main import app
from nao_core.config import NaoConfig
from pydantic import ValidationError
from warehouse_provisioning import (
    infer_warehouse_error_fields,
    prepare_warehouse_config,
)

INTERNAL_SECRET = "test-internal-secret-at-least-20-characters"
INTERNAL_HEADERS = {"X-Nao-Internal-Secret": INTERNAL_SECRET}
POSTGRES_REQUEST = {
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
        "fabric",
        {
            "host": "warehouse.fabric.microsoft.com",
            "database": "analytics",
            "auth_mode": "azure_service_principal",
            "client_id": "client-id",
            "client_secret": "client-secret",
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
        "name": "postgres",
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


@pytest.mark.parametrize(
    ("provider", "message", "expected"),
    [
        ("postgres", "password authentication failed", ["user", "password"]),
        ("postgres", "connection refused", ["host", "port"]),
        ("bigquery", "invalid_grant", ["credentials_json"]),
        ("postgres", "unexpected failure", []),
    ],
)
def test_infer_warehouse_error_fields(provider, message, expected):
    assert infer_warehouse_error_fields(provider, ValueError(message)) == expected


@pytest.mark.parametrize(("provider", "credentials"), SCALAR_WAREHOUSE_CASES)
def test_prepare_scalar_warehouse_config(provider, credentials):
    database_config, env_vars = prepare_warehouse_config(
        provider=provider,
        credentials=credentials,
    )

    assert database_config["type"] == provider
    assert database_config["name"] == provider

    for field_name, value in credentials.items():
        env_name = f"NAO_ONBOARDING_{provider.upper()}_{field_name.upper()}"
        assert database_config[field_name] == f"${{{{ env('{env_name}') }}}}"
        assert env_vars[env_name] == json.dumps(value)


def test_prepare_nested_bigquery_credentials():
    database_config, env_vars = prepare_warehouse_config(
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


@pytest.mark.parametrize(
    ("provider", "credentials", "expected_fields"),
    [
        pytest.param(
            "bigquery",
            {"project_id": "nao-analytics"},
            ["credentials_json"],
            id="bigquery-ambient-credentials",
        ),
        pytest.param(
            "bigquery",
            {"project_id": "nao-analytics", "credentials_path": "/etc/key.json"},
            ["credentials_json", "credentials_path"],
            id="bigquery-server-file",
        ),
        pytest.param(
            "athena",
            {
                "region_name": "us-east-1",
                "s3_staging_dir": "s3://nao-results",
                "profile_name": "default",
            },
            ["aws_access_key_id", "aws_secret_access_key", "profile_name"],
            id="athena-server-profile",
        ),
        pytest.param(
            "motherduck",
            {"database": "analytics"},
            ["token"],
            id="motherduck-env-token",
        ),
        pytest.param(
            "redshift",
            {
                "host": "cluster.redshift.amazonaws.com",
                "database": "analytics",
                "user": "nao",
                "password": "secret",
                "ssh_tunnel": {"ssh_private_key_path": "/root/.ssh/id_rsa"},
            },
            ["ssh_tunnel"],
            id="redshift-server-ssh-key",
        ),
        pytest.param(
            "mssql",
            {
                "host": "mssql.example.com",
                "user": "nao",
                "password": "secret",
                "driver": "/tmp/evil.so",
            },
            ["driver"],
            id="mssql-driver-path",
        ),
    ],
)
def test_prepare_rejects_server_side_credentials(
    provider, credentials, expected_fields
):
    with pytest.raises(ValidationError) as error:
        prepare_warehouse_config(provider=provider, credentials=credentials)

    assert sorted(issue["loc"][0] for issue in error.value.errors()) == expected_fields


def test_prepare_pins_server_independent_auth_mode():
    database_config, env_vars = prepare_warehouse_config(
        provider="redshift",
        credentials={
            "host": "cluster.redshift.amazonaws.com",
            "database": "analytics",
            "auth_mode": "iam",
            "user": "nao",
            "password": "secret",
        },
    )

    assert env_vars["NAO_ONBOARDING_REDSHIFT_AUTH_MODE"] == json.dumps("password")
    assert "auth_mode" in database_config


def test_validate_warehouse_endpoint_rejects_ambient_credentials():
    response = TestClient(app, headers=INTERNAL_HEADERS).post(
        "/warehouse/validate",
        json={"provider": "bigquery", "credentials": {"project_id": "nao-analytics"}},
    )

    assert response.status_code == 422
    assert response.json() == {
        "detail": {
            "code": "invalid_warehouse_credentials",
            "fields": ["credentials_json"],
        }
    }


def test_prepare_postgres_warehouse_config_rejects_invalid_credentials():
    with pytest.raises(ValidationError):
        prepare_warehouse_config(
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


def test_validate_warehouse_endpoint_accepts_working_credentials(monkeypatch):
    monkeypatch.setattr(
        "main.validate_warehouse_credentials",
        lambda provider, credentials: None,
    )

    response = TestClient(app, headers=INTERNAL_HEADERS).post(
        "/warehouse/validate",
        json=POSTGRES_REQUEST,
    )

    assert response.status_code == 200
    assert response.json() == {"valid": True}


def test_validate_warehouse_endpoint_rejects_invalid_credentials(monkeypatch):
    def reject_credentials(provider, credentials):
        raise ValueError("password authentication failed")

    monkeypatch.setattr("main.validate_warehouse_credentials", reject_credentials)

    response = TestClient(app, headers=INTERNAL_HEADERS).post(
        "/warehouse/validate",
        json=POSTGRES_REQUEST,
    )

    assert response.status_code == 422
    assert response.json() == {
        "detail": {
            "code": "warehouse_connection_failed",
            "fields": ["user", "password"],
        }
    }


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
