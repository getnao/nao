import os
import secrets
import sys
from contextlib import asynccontextmanager
from datetime import datetime
from pathlib import Path
from typing import Annotated

import uvicorn
from dotenv import load_dotenv
from fastapi import Depends, FastAPI, Header, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

load_dotenv()

cli_path = Path(__file__).resolve().parent.parent.parent.parent / "cli"
sys.path.insert(0, str(cli_path))

from nao_core.config import NaoConfig, NaoConfigError
from nao_core.context import get_context_provider

from dbt_charts_routes import router as dbt_charts_router
from sql_execution import GuardError, dataframe_to_records, run_guarded_sql, select_database

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


def require_internal_secret(
    provided: Annotated[str | None, Header(alias="X-Nao-Internal-Secret")] = None,
):
    """Only the nao backend, which shares BETTER_AUTH_SECRET, may call internal routes."""
    expected = os.environ.get("BETTER_AUTH_SECRET")
    if not expected:
        raise HTTPException(status_code=503, detail="BETTER_AUTH_SECRET is not configured")
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
        db_config = select_database(config, request.database_id)

        try:
            df = run_guarded_sql(
                request.sql,
                db_config,
                project_path,
                request.enforce_excluded_columns,
                request.azure_access_token,
            )
        except GuardError as error:
            raise HTTPException(status_code=400, detail=str(error)) from error

        columns, data = dataframe_to_records(df)
        return ExecuteSQLResponse(
            data=data,
            row_count=len(data),
            columns=columns,
            dialect=db_config.type,
        )
    except HTTPException:
        raise
    except NaoConfigError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


app.include_router(dbt_charts_router, dependencies=internal_only)


if __name__ == "__main__":
    uvicorn.run("main:app", host="127.0.0.1", port=port, reload=True)
