import json
import re

from nao_core.config.databases import parse_database_config
from pydantic import ValidationError

ALLOWED_FIELDS = {
    "athena": {
        "region_name",
        "s3_staging_dir",
        "work_group",
        "schema_name",
        "aws_access_key_id",
        "aws_secret_access_key",
        "aws_session_token",
    },
    "bigquery": {"project_id", "dataset_id", "credentials_json", "location"},
    "clickhouse": {
        "host",
        "port",
        "user",
        "database",
        "password",
        "protocol",
        "secure",
    },
    "databricks": {
        "schema_name",
        "server_hostname",
        "http_path",
        "access_token",
        "catalog",
    },
    "fabric": {
        "host",
        "port",
        "database",
        "client_id",
        "client_secret",
        "auth_mode",
        "tenant_id",
    },
    "motherduck": {"database", "token"},
    "mssql": {
        "host",
        "port",
        "user",
        "database",
        "password",
        "schema_name",
        "driver",
    },
    "mysql": {"host", "port", "user", "database", "password", "schema_name"},
    "postgres": {"host", "port", "user", "database", "password", "schema_name"},
    "redshift": {
        "host",
        "port",
        "user",
        "database",
        "password",
        "schema_name",
        "auth_mode",
        "sslmode",
    },
    "snowflake": {
        "database",
        "password",
        "schema_name",
        "warehouse",
        "account_id",
        "username",
    },
    "starrocks": {
        "host",
        "port",
        "user",
        "database",
        "password",
        "schema_name",
        "catalog",
    },
    "trino": {
        "host",
        "port",
        "user",
        "catalog",
        "http_scheme",
        "password",
        "schema_name",
    },
}

REQUIRED_SECRET_FIELDS = {
    "athena": ("aws_access_key_id", "aws_secret_access_key"),
    "bigquery": ("credentials_json",),
    "databricks": ("access_token",),
    "fabric": ("client_id", "client_secret"),
    "motherduck": ("token",),
    "snowflake": ("password",),
}

PINNED_FIELDS = {
    "fabric": {"auth_mode": "azure_service_principal"},
    "redshift": {"auth_mode": "password"},
}

ODBC_DRIVER_NAME_PATTERN = re.compile(r"[A-Za-z0-9 ._-]+")


class NotionContextValidationError(Exception):
    pass


class ConfluenceContextValidationError(Exception):
    pass


AUTH_FIELDS = {
    "athena": ["aws_access_key_id", "aws_secret_access_key", "aws_session_token"],
    "bigquery": ["credentials_json"],
    "clickhouse": ["user", "password"],
    "databricks": ["access_token"],
    "fabric": ["client_id", "client_secret", "tenant_id"],
    "motherduck": ["token"],
    "mssql": ["user", "password"],
    "mysql": ["user", "password"],
    "postgres": ["user", "password"],
    "redshift": ["user", "password"],
    "snowflake": ["username", "password"],
    "starrocks": ["user", "password"],
    "trino": ["user", "password"],
}

ENDPOINT_FIELDS = {
    "athena": ["region_name", "s3_staging_dir"],
    "bigquery": ["project_id", "location"],
    "clickhouse": ["host", "port", "protocol"],
    "databricks": ["server_hostname", "http_path"],
    "fabric": ["host", "port"],
    "motherduck": ["database"],
    "mssql": ["host", "port"],
    "mysql": ["host", "port"],
    "postgres": ["host", "port"],
    "redshift": ["host", "port"],
    "snowflake": ["account_id"],
    "starrocks": ["host", "port"],
    "trino": ["host", "port", "http_scheme"],
}


def sanitize_warehouse_credentials(
    provider: str,
    credentials: dict[str, object],
) -> dict[str, object]:
    if provider not in ALLOWED_FIELDS:
        raise ValueError(f"Unsupported warehouse provider: {provider}")

    issues = [
        {"type": "extra_forbidden", "loc": (field,), "input": None}
        for field in sorted(credentials.keys() - ALLOWED_FIELDS[provider])
    ]
    issues += [
        {"type": "missing", "loc": (field,), "input": None}
        for field in REQUIRED_SECRET_FIELDS.get(provider, ())
        if not credentials.get(field)
    ]
    driver = credentials.get("driver")
    if driver is not None and not (isinstance(driver, str) and ODBC_DRIVER_NAME_PATTERN.fullmatch(driver)):
        issues.append(
            {
                "type": "value_error",
                "loc": ("driver",),
                "input": None,
                "ctx": {"error": ValueError("Invalid ODBC driver name")},
            }
        )
    if issues:
        raise ValidationError.from_exception_data("WarehouseCredentials", issues)

    return {**credentials, **PINNED_FIELDS.get(provider, {})}


def validate_warehouse_credentials(
    provider: str,
    credentials: dict[str, object],
) -> list[dict[str, object]]:
    config = parse_database_config(
        {
            **sanitize_warehouse_credentials(provider, credentials),
            "type": provider,
            "name": provider,
        }
    )
    connection = config.connect()
    try:
        schemas = []
        for schema in config.get_schemas(connection):
            schema_name = str(schema)
            schemas.append(
                {
                    "schema": schema_name,
                    "tables": sorted(
                        (str(table) for table in connection.list_tables(database=schema)),
                        key=str.casefold,
                    ),
                }
            )
        return sorted(schemas, key=lambda item: str(item["schema"]).casefold())
    finally:
        connection.disconnect()


def validate_notion_context(
    api_key: str,
    pages: list[str],
) -> list[dict[str, str]]:
    from nao_core.commands.sync.providers.notion.database import join_rich_text
    from nao_core.commands.sync.providers.notion.provider import (
        create_client,
        extract_notion_id,
        extract_page_title,
        retrieve_page,
    )
    from notion_client.errors import APIResponseError

    client = create_client(api_key)
    validated_pages = []
    for reference in pages:
        try:
            object_id = extract_notion_id(reference)
        except ValueError as error:
            raise NotionContextValidationError(
                "One entry does not contain a valid Notion page or database ID."
            ) from error

        try:
            page = retrieve_page(client, object_id)
            if page is None:
                database = client.databases.retrieve(database_id=object_id)
                title = join_rich_text(database.get("title", [])) or object_id
            else:
                title = extract_page_title(page, object_id)
        except APIResponseError as error:
            if error.status == 401:
                message = "Notion rejected the integration token."
            elif error.status == 404:
                message = (
                    "Notion could not access one of the selected items. "
                    "Add the integration from the page's Connections menu."
                )
            elif error.status == 429:
                message = "Notion is rate limiting requests. Wait a moment and try again."
            else:
                message = f"Notion rejected one of the selected items ({error.code})."
            raise NotionContextValidationError(message) from error

        validated_pages.append({"url": reference, "title": title})
    return validated_pages


def validate_confluence_context(
    base_url: str,
    email: str,
    api_token: str,
    pages: list[str],
) -> list[dict[str, str]]:
    import httpx

    from nao_core.commands.sync.providers.confluence.client import (
        ConfluenceClient,
        extract_page_id,
    )
    from nao_core.config.confluence import ConfluenceConfig

    try:
        config = ConfluenceConfig(
            base_url=base_url,
            deployment="cloud",
            email=email,
            api_token=api_token,
            pages=pages,
        )
        with ConfluenceClient(config) as client:
            return [
                {"url": reference, "title": client.get_page(extract_page_id(reference)).title} for reference in pages
            ]
    except httpx.HTTPStatusError as error:
        status = error.response.status_code
        if status == 401:
            message = "Confluence rejected the email or API token."
        elif status == 403:
            message = "The Confluence account does not have access to one of the selected pages."
        elif status == 404:
            message = "Confluence could not find one of the selected pages."
        elif status == 429:
            message = "Confluence is rate limiting requests. Wait a moment and try again."
        else:
            message = f"Confluence rejected one of the selected pages (HTTP {status})."
        raise ConfluenceContextValidationError(message) from error
    except ValidationError as error:
        raise ConfluenceContextValidationError(
            "The Confluence site URL, account email, or page list is invalid."
        ) from error
    except ValueError as error:
        raise ConfluenceContextValidationError(str(error)) from error


def infer_warehouse_error_fields(provider: str, error: Exception) -> list[str]:
    message = str(error).lower()

    if "dataset" in message:
        return ["dataset_id"]
    if "schema" in message:
        return ["schema_name"]
    if "catalog" in message:
        return ["catalog"]
    if "database" in message and any(phrase in message for phrase in ("does not exist", "not found", "unknown")):
        return ["database"]
    if any(
        phrase in message
        for phrase in (
            "authentication",
            "access denied",
            "invalid credential",
            "invalid_grant",
            "login failed",
            "password",
            "unauthorized",
            "forbidden",
            "401",
            "403",
            "token",
        )
    ):
        return AUTH_FIELDS.get(provider, [])
    if any(
        phrase in message
        for phrase in (
            "connection refused",
            "could not connect",
            "name or service not known",
            "network",
            "no route to host",
            "timed out",
            "timeout",
            "unknown host",
        )
    ):
        return ENDPOINT_FIELDS.get(provider, [])

    return []


def prepare_warehouse_config(
    provider: str,
    credentials: dict[str, object],
) -> tuple[dict[str, object], dict[str, str]]:
    config = parse_database_config(
        {
            **sanitize_warehouse_credentials(provider, credentials),
            "type": provider,
            "name": provider,
        }
    )

    database_config = {
        "type": provider,
        "name": provider,
    }
    env_vars: dict[str, str] = {}
    values = config.model_dump(include=config.model_fields_set, mode="json")

    for field_name in sorted(config.model_fields_set - {"type", "name"}):
        value = values[field_name]
        if value is None:
            continue

        database_config[field_name] = replace_with_env_references(
            value,
            [provider, field_name],
            env_vars,
        )

    return database_config, env_vars


def replace_with_env_references(
    value: object,
    path: list[str],
    env_vars: dict[str, str],
) -> object:
    if isinstance(value, dict):
        return {
            str(key): replace_with_env_references(
                nested_value,
                [*path, str(key)],
                env_vars,
            )
            for key, nested_value in value.items()
        }

    if isinstance(value, list):
        return [
            replace_with_env_references(
                nested_value,
                [*path, str(index)],
                env_vars,
            )
            for index, nested_value in enumerate(value)
        ]

    if value is None:
        return None

    env_name = "NAO_ONBOARDING_" + "_".join(part.upper().replace("-", "_") for part in path)
    if env_name in env_vars:
        raise ValueError(f"Conflicting onboarding environment variable: {env_name}")
    env_vars[env_name] = json.dumps(value)

    return f"${{{{ env('{env_name}') }}}}"
