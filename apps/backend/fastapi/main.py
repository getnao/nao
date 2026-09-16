import math
import os
import secrets
import sys
from contextlib import asynccontextmanager
from datetime import date, datetime
from decimal import Decimal
from pathlib import Path
from typing import Annotated

import numpy as np
import pandas as pd
import uvicorn
from dotenv import load_dotenv
from fastapi import Depends, FastAPI, Header, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

load_dotenv()

cli_path = Path(__file__).resolve().parent.parent.parent.parent / "cli"
sys.path.insert(0, str(cli_path))

from nao_core.config import NaoConfig, NaoConfigError  # noqa: E402
from nao_core.config.databases.allow_listed_only_guard import (  # noqa: E402
    AllowListedOnlyGuardError,
    enforce_allow_listed_only,
    query_references_base_tables,
)
from nao_core.config.databases.column_access import (  # noqa: E402
    ColumnAccessError,
    validate_column_access,
)
from nao_core.context import get_context_provider  # noqa: E402
from nao_core.semantic_layer import (  # noqa: E402
    MetricFlowSemanticLayer,
    SemanticLayerError,
    SemanticLayerUnavailableError,
    SemanticQuery,
    metricflow_dialect_for,
    runtime_manifest_path,
)

port = int(os.environ.get("PORT", 8005))

# Global scheduler instance
scheduler = None


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Manage application lifespan - setup scheduler on startup."""
    global scheduler

    # Setup periodic refresh if configured
    refresh_schedule = os.environ.get("NAO_REFRESH_SCHEDULE")
    if refresh_schedule:
        from apscheduler.schedulers.asyncio import AsyncIOScheduler
        from apscheduler.triggers.cron import CronTrigger

        scheduler = AsyncIOScheduler()

        try:
            trigger = CronTrigger.from_crontab(refresh_schedule)
            scheduler.add_job(
                _refresh_context_task,
                trigger,
                id="context_refresh",
                name="Periodic context refresh",
            )
            scheduler.start()
            print(f"[Scheduler] Periodic refresh enabled: {refresh_schedule}")
        except ValueError as e:
            print(f"[Scheduler] Invalid cron expression '{refresh_schedule}': {e}")

    yield

    # Shutdown scheduler
    if scheduler:
        scheduler.shutdown(wait=False)


async def _refresh_context_task():
    """Background task for scheduled context refresh."""
    try:
        provider = get_context_provider()
        updated = provider.refresh()
        if updated:
            print(f"[Scheduler] Context refreshed at {datetime.now().isoformat()}")
        else:
            print(
                f"[Scheduler] Context already up-to-date at {datetime.now().isoformat()}"
            )
    except Exception as e:
        print(f"[Scheduler] Failed to refresh context: {e}")


app = FastAPI(lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


# =============================================================================
# Request/Response Models
# =============================================================================


class ExecuteSQLRequest(BaseModel):
    sql: str
    nao_project_folder: str
    database_id: str | None = None
    env_vars: dict[str, str] | None = None
    azure_access_token: str | None = None
    enforce_excluded_columns: bool = False


class ExecuteSQLResponse(BaseModel):
    data: list[dict]
    row_count: int
    columns: list[str]
    dialect: str | None = None


class HealthResponse(BaseModel):
    status: str
    context_source: str
    context_initialized: bool
    refresh_schedule: str | None


class CompileSemanticQueryRequest(BaseModel):
    nao_project_folder: str
    metrics: list[str]
    group_by: list[str] = []
    where: list[str] = []
    order_by: list[str] = []
    limit: int | None = None
    start_time: str | None = None
    end_time: str | None = None
    env_vars: dict[str, str] | None = None


class CompileSemanticQueryResponse(BaseModel):
    sql: str
    database_id: str
    dialect: str


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


def _execute_sql_with_guards(
    sql: str,
    db_config,
    project_path: Path,
    enforce_excluded_columns: bool,
) -> pd.DataFrame:
    conn = db_config.connect()
    try:
        validated_sql = _validate_sql(
            sql,
            db_config,
            project_path,
            enforce_excluded_columns,
            conn=conn,
        )
        return db_config.execute_sql(validated_sql, conn=conn)
    finally:
        conn.disconnect()


def _convert_value(v: object):
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


def require_internal_secret(
    provided: Annotated[str | None, Header(alias="X-Nao-Internal-Secret")] = None,
):
    """Only the nao backend, which shares BETTER_AUTH_SECRET, may call internal routes."""
    expected = os.environ.get("BETTER_AUTH_SECRET")
    if not expected:
        raise HTTPException(
            status_code=503, detail="BETTER_AUTH_SECRET is not configured"
        )
    if provided is None or not secrets.compare_digest(provided, expected):
        raise HTTPException(status_code=401, detail="Invalid internal secret")


internal_only = [Depends(require_internal_secret)]


# =============================================================================
# API Endpoints
# =============================================================================


@app.get("/health", response_model=HealthResponse)
async def health_check():
    """Health check endpoint with context status."""
    try:
        provider = get_context_provider()
        context_source = os.environ.get("NAO_CONTEXT_SOURCE", "local")
        return HealthResponse(
            status="ok",
            context_source=context_source,
            context_initialized=provider.is_initialized(),
            refresh_schedule=os.environ.get("NAO_REFRESH_SCHEDULE"),
        )
    except Exception:
        return HealthResponse(
            status="error",
            context_source=os.environ.get("NAO_CONTEXT_SOURCE", "local"),
            context_initialized=False,
            refresh_schedule=os.environ.get("NAO_REFRESH_SCHEDULE"),
        )


@app.post("/execute_sql", response_model=ExecuteSQLResponse, dependencies=internal_only)
async def execute_sql(request: ExecuteSQLRequest):
    try:
        project_path = Path(request.nao_project_folder)
        config = NaoConfig.try_load(
            project_path,
            raise_on_error=True,
            extra_env=request.env_vars,
        )
        assert config is not None

        if len(config.databases) == 0:
            raise HTTPException(
                status_code=400,
                detail="No databases configured in nao_config.yaml",
            )

        if len(config.databases) == 1:
            db_config = config.databases[0]
        elif request.database_id:
            db_config = next(
                (db for db in config.databases if db.name == request.database_id),
                None,
            )
            if db_config is None:
                available_databases = [db.name for db in config.databases]
                raise HTTPException(
                    status_code=400,
                    detail={
                        "message": f"Database '{request.database_id}' not found",
                        "available_databases": available_databases,
                    },
                )
        else:
            available_databases = [db.name for db in config.databases]
            raise HTTPException(
                status_code=400,
                detail={
                    "message": "Multiple databases configured. Please specify database_id.",
                    "available_databases": available_databases,
                },
            )

        auth_mode_value = getattr(getattr(db_config, "auth_mode", None), "value", None)
        is_azure_entra_id = auth_mode_value == "azure_entra_id"

        if is_azure_entra_id and not request.azure_access_token:
            raise HTTPException(
                status_code=400,
                detail=(
                    "azure_access_token is required when the database auth_mode is "
                    "'azure_entra_id'. Runtime queries must use the end user's access "
                    "token; any configured user/password is only used by nao sync."
                ),
            )

        try:
            if is_azure_entra_id:
                if db_config.allow_listed_only and query_references_base_tables(
                    request.sql,
                    db_config.type,
                ):
                    if not getattr(db_config, "user", None) or not getattr(
                        db_config,
                        "password",
                        None,
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
                    request.sql,
                    db_config,
                    project_path,
                    request.enforce_excluded_columns,
                )
                df = db_config.execute_sql_with_token(
                    validated_sql,
                    request.azure_access_token,
                )
            elif db_config.allow_listed_only:
                df = _execute_sql_with_guards(
                    request.sql,
                    db_config,
                    project_path,
                    request.enforce_excluded_columns,
                )
            else:
                validated_sql = _validate_sql(
                    request.sql,
                    db_config,
                    project_path,
                    request.enforce_excluded_columns,
                )
                df = db_config.execute_sql(validated_sql)
        except (AllowListedOnlyGuardError, ColumnAccessError) as error:
            raise HTTPException(status_code=400, detail=str(error)) from error

        data = [
            {k: _convert_value(v) for k, v in row.items()}
            for row in df.to_dict(orient="records")
        ]

        return ExecuteSQLResponse(
            data=data,
            row_count=len(data),
            columns=[str(c) for c in df.columns.tolist()],
            dialect=db_config.type,
        )
    except HTTPException:
        raise
    except NaoConfigError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post(
    "/semantic_layer/compile",
    response_model=CompileSemanticQueryResponse,
    dependencies=internal_only,
)
async def compile_semantic_query(request: CompileSemanticQueryRequest):
    """Compile a metric query to SQL with the project's semantic layer. Execution stays with /execute_sql."""
    try:
        project_path = Path(request.nao_project_folder)
        config = NaoConfig.try_load(
            project_path, raise_on_error=True, extra_env=request.env_vars
        )
        assert config is not None

        semantic_layer = config.semantic_layer
        if semantic_layer is None:
            raise HTTPException(
                status_code=400,
                detail="No semantic_layer configured in nao_config.yaml",
            )

        db_config = _resolve_semantic_layer_database(config, semantic_layer.database)
        dialect = metricflow_dialect_for(db_config.type)
        engine = MetricFlowSemanticLayer.load(
            runtime_manifest_path(semantic_layer, project_path), dialect
        )
        sql = engine.compile(
            SemanticQuery(
                metrics=request.metrics,
                group_by=request.group_by,
                where=request.where,
                order_by=request.order_by,
                limit=request.limit,
                start_time=request.start_time,
                end_time=request.end_time,
            )
        )
        return CompileSemanticQueryResponse(
            sql=sql, database_id=db_config.name, dialect=db_config.type
        )
    except HTTPException:
        raise
    except SemanticLayerUnavailableError as e:
        raise HTTPException(status_code=503, detail=str(e))
    except (NaoConfigError, SemanticLayerError) as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


def _resolve_semantic_layer_database(config: NaoConfig, database_name: str | None):
    if database_name is not None:
        db_config = next(
            (db for db in config.databases if db.name == database_name), None
        )
        if db_config is None:
            raise HTTPException(
                status_code=400,
                detail=f"semantic_layer.database '{database_name}' is not a configured database",
            )
        return db_config
    if len(config.databases) == 1:
        return config.databases[0]
    raise HTTPException(
        status_code=400,
        detail="semantic_layer.database must name the database that runs semantic queries when several are configured",
    )


if __name__ == "__main__":
    uvicorn.run("main:app", host="127.0.0.1", port=port, reload=True)
