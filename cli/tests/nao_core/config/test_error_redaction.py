import pytest

from nao_core.config.databases.bigquery import BigQueryConfig
from nao_core.config.databases.error_redaction import is_authentication_error, redact_warehouse_error
from nao_core.config.databases.postgres import PostgresConfig
from nao_core.config.databases.redshift import RedshiftConfig, RedshiftSSHTunnelConfig

PASSWORD = "Sup3r$ecret/pw"


def _postgres_config() -> PostgresConfig:
    return PostgresConfig(name="warehouse", host="db.internal", database="analytics", user="nao", password=PASSWORD)


def test_redacts_configured_password():
    message = f'connection failed: FATAL: password "{PASSWORD}" rejected for user "nao"'

    redacted = redact_warehouse_error(message, _postgres_config())

    assert PASSWORD not in redacted
    assert "[redacted]" in redacted
    assert 'user "nao"' in redacted


def test_redacts_url_encoded_configured_password():
    message = "could not connect to postgresql://nao@db.internal/analytics?password=Sup3r%24ecret%2Fpw"

    redacted = redact_warehouse_error(message, _postgres_config())

    assert "Sup3r%24ecret%2Fpw" not in redacted


def test_redacts_nested_secrets():
    config = RedshiftConfig(
        name="redshift",
        host="cluster.internal",
        database="dev",
        user="nao",
        password="redshift-pw",
        ssh_tunnel=RedshiftSSHTunnelConfig(
            ssh_host="bastion",
            ssh_username="ec2-user",
            ssh_private_key_path="~/.ssh/id_rsa",
            ssh_private_key_passphrase="tunnel-passphrase",
        ),
    )

    redacted = redact_warehouse_error("bad passphrase tunnel-passphrase, then redshift-pw", config)

    assert "tunnel-passphrase" not in redacted
    assert "redshift-pw" not in redacted


def test_redacts_service_account_private_key_but_keeps_project():
    config = BigQueryConfig(
        name="bq",
        project_id="my-project",
        credentials_json={"client_email": "nao@my-project.iam", "private_key": "-----BEGIN PRIVATE KEY-----abc"},
    )

    redacted = redact_warehouse_error("invalid key -----BEGIN PRIVATE KEY-----abc for my-project", config)

    assert "BEGIN PRIVATE KEY" not in redacted
    assert "my-project" in redacted


@pytest.mark.parametrize(
    ("message", "leaked"),
    [
        ("could not connect to postgresql://nao:hunter2@db.internal:5432/analytics", "hunter2"),
        ("could not connect to mysql://nao:p@ss@db.internal/analytics", "p@ss"),
        ("[ODBC Driver 18] DRIVER={ODBC};SERVER=db;UID=nao;PWD={hunter2};", "hunter2"),
        ("invalid dsn: host=db user=nao password=hunter2 dbname=analytics", "hunter2"),
        ("invalid dsn: password='hunter 2' host=db", "hunter 2"),
        ("md:analytics?motherduck_token=abc.def.ghi failed", "abc.def.ghi"),
        ("request failed with header Authorization: Bearer eyJhbGciOi.payload.sig", "eyJhbGciOi.payload.sig"),
        ("aws_secret_access_key: wJalrXUtnFEMI/K7MDENG", "wJalrXUtnFEMI/K7MDENG"),
    ],
)
def test_redacts_credentials_missing_from_config(message: str, leaked: str):
    redacted = redact_warehouse_error(message)

    assert leaked not in redacted
    assert "[redacted]" in redacted


def test_keeps_sql_errors_intact():
    message = (
        'Binder Error: Referenced column "amount" not found in FROM clause! LINE 1: SELECT amount::int FROM orders'
    )

    assert redact_warehouse_error(message, _postgres_config()) == message


def test_ignores_empty_secret_values():
    config = PostgresConfig(name="warehouse", host="db", database="analytics", user="nao", password="")

    assert redact_warehouse_error("syntax error", config) == "syntax error"


@pytest.mark.parametrize(
    "message",
    [
        'connection failed: FATAL:  password authentication failed for user "nao"',
        "(1045, \"Access denied for user 'nao'@'10.0.0.1' (using password: YES)\")",
        "Login failed for user 'nao'. (18456)",
        "250001 (08001): Failed to connect to DB. Incorrect username or password was specified.",
        "Code: 516. DB::Exception: nao: Authentication failed: password is incorrect",
        "Error during request to server: Invalid access token.",
        "401 Unauthorized",
    ],
)
def test_detects_authentication_errors(message: str):
    assert is_authentication_error(message)


@pytest.mark.parametrize(
    "message",
    [
        'relation "orders" does not exist',
        "Access Denied: Table my-project:sales.orders: User does not have permission to query table",
        "syntax error at or near 401",
    ],
)
def test_does_not_flag_query_errors_as_authentication_errors(message: str):
    assert not is_authentication_error(message)
