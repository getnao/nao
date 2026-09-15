"""Guarded SQL execution shared by the `/execute_sql` and dbt Charts endpoints."""

import math
from datetime import date, datetime
from decimal import Decimal
from pathlib import Path
from typing import Any

import numpy as np
import pandas as pd
from fastapi import HTTPException

from nao_core.config import NaoConfig
from nao_core.config.databases.allow_listed_only_guard import (
    AllowListedOnlyGuardError,
    enforce_allow_listed_only,
    query_references_base_tables,
)
from nao_core.config.databases.column_access import (
    ColumnAccessError,
    validate_column_access,
)

GuardError = (AllowListedOnlyGuardError, ColumnAccessError)


def select_database(config: NaoConfig, database_id: str | None):
    if len(config.databases) == 0:
        raise HTTPException(
            status_code=400,
            detail="No databases configured in nao_config.yaml",
        )

    if len(config.databases) == 1:
        return config.databases[0]

    available_databases = [db.name for db in config.databases]
    if not database_id:
        raise HTTPException(
            status_code=400,
            detail={
                "message": "Multiple databases configured. Please specify database_id.",
                "available_databases": available_databases,
            },
        )

    db_config = next((db for db in config.databases if db.name == database_id), None)
    if db_config is None:
        raise HTTPException(
            status_code=400,
            detail={
                "message": f"Database '{database_id}' not found",
                "available_databases": available_databases,
            },
        )
    return db_config


def run_guarded_sql(
    sql: str,
    db_config,
    project_path: Path,
    enforce_excluded_columns: bool,
    azure_access_token: str | None = None,
) -> pd.DataFrame:
    """Validate `sql` against the database guards, then execute it with the right credentials."""
    if _uses_azure_entra_id(db_config):
        return _run_with_azure_token(
            sql, db_config, project_path, enforce_excluded_columns, azure_access_token
        )
    if db_config.allow_listed_only:
        return _run_with_live_schema_validation(
            sql, db_config, project_path, enforce_excluded_columns
        )
    validated_sql = _validate_sql(
        sql, db_config, project_path, enforce_excluded_columns
    )
    return db_config.execute_sql(validated_sql)


def dataframe_to_records(df: pd.DataFrame) -> tuple[list[str], list[dict[str, Any]]]:
    columns = [str(column) for column in df.columns.tolist()]
    data = [
        {key: convert_value(value) for key, value in row.items()}
        for row in df.to_dict(orient="records")
    ]
    return columns, data


def convert_value(v: object):
    """Convert a DataFrame cell to a JSON-serializable Python type."""
    if v is None:
        return None

    # Handle float NaN / Infinity early (common in pandas output)
    if isinstance(v, float) and (math.isnan(v) or math.isinf(v)):
        return None

    # Handle pandas NA / NaT sentinels
    if v is pd.NA or v is pd.NaT:
        return None

    # Numpy scalar types
    if isinstance(v, np.bool_):
        return bool(v)
    if isinstance(v, np.integer):
        return int(v)
    if isinstance(v, np.floating):
        val = float(v)
        return None if math.isnan(val) or math.isinf(val) else val
    if isinstance(v, np.ndarray):
        return v.tolist()

    # Python / DB types that aren't JSON-serializable by default
    if isinstance(v, Decimal):
        if v.is_nan() or v.is_infinite():
            return None
        return float(v)
    if isinstance(v, (datetime, date)):
        return v.isoformat()
    if isinstance(v, bytes):
        return v.decode("utf-8", errors="replace")

    # Catch-all for remaining numpy scalars (e.g. np.str_, np.bytes_)
    item_method = getattr(v, "item", None)
    if callable(item_method):
        return item_method()

    return v


def _uses_azure_entra_id(db_config) -> bool:
    auth_mode_value = getattr(getattr(db_config, "auth_mode", None), "value", None)
    return auth_mode_value == "azure_entra_id"


def _run_with_azure_token(
    sql: str,
    db_config,
    project_path: Path,
    enforce_excluded_columns: bool,
    azure_access_token: str | None,
) -> pd.DataFrame:
    if not azure_access_token:
        raise HTTPException(
            status_code=400,
            detail=(
                "azure_access_token is required when the database auth_mode is "
                "'azure_entra_id'. Runtime queries must use the end user's access "
                "token; any configured user/password is only used by nao sync."
            ),
        )
    if db_config.allow_listed_only and query_references_base_tables(
        sql, db_config.type
    ):
        if not getattr(db_config, "user", None) or not getattr(
            db_config, "password", None
        ):
            raise HTTPException(
                status_code=400,
                detail=(
                    "Queries that reference tables require sync user and password "
                    "when allow_listed_only validation is enabled with auth_mode "
                    "'azure_entra_id'. These credentials are used only to validate "
                    "the query against the live schema and context rules; the query "
                    "still executes with the end user's access token."
                ),
            )
    validated_sql = _validate_sql(
        sql, db_config, project_path, enforce_excluded_columns
    )
    return db_config.execute_sql_with_token(validated_sql, azure_access_token)


def _run_with_live_schema_validation(
    sql: str,
    db_config,
    project_path: Path,
    enforce_excluded_columns: bool,
) -> pd.DataFrame:
    conn = db_config.connect()
    try:
        validated_sql = _validate_sql(
            sql, db_config, project_path, enforce_excluded_columns, conn=conn
        )
        return db_config.execute_sql(validated_sql, conn=conn)
    finally:
        conn.disconnect()


def _validate_sql(
    sql: str,
    db_config,
    project_path: Path,
    enforce_excluded_columns: bool,
    conn=None,
) -> str:
    validated_sql = enforce_allow_listed_only(sql, db_config, project_path, conn=conn)
    if enforce_excluded_columns:
        validated_sql = validate_column_access(validated_sql, db_config, project_path)
    return validated_sql
