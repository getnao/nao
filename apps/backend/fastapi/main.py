import os
import sys
from contextlib import asynccontextmanager
from datetime import datetime
from pathlib import Path

import numpy as np
import uvicorn
from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

load_dotenv()

cli_path = Path(__file__).parent.parent.parent / "cli"
sys.path.insert(0, str(cli_path))

from nao_core.config import NaoConfig
from nao_core.context import get_context_provider

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
            print(f"[Scheduler] Context already up-to-date at {datetime.now().isoformat()}")
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


class ExecuteSQLResponse(BaseModel):
    data: list[dict]
    row_count: int
    columns: list[str]


class RefreshResponse(BaseModel):
    status: str
    updated: bool
    message: str


class HealthResponse(BaseModel):
    status: str
    context_source: str
    context_initialized: bool
    refresh_schedule: str | None


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


@app.post("/api/refresh", response_model=RefreshResponse)
async def refresh_context():
    """Trigger a context refresh (git pull if using git source).

    This endpoint can be called by:
    - CI/CD pipelines after pushing new context
    - Webhooks when data schemas change
    - Manual triggers for immediate updates
    """
    try:
        provider = get_context_provider()
        updated = provider.refresh()

        if updated:
            return RefreshResponse(
                status="ok",
                updated=True,
                message="Context updated successfully",
            )
        else:
            return RefreshResponse(
                status="ok",
                updated=False,
                message="Context already up-to-date",
            )
    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=f"Failed to refresh context: {str(e)}",
        )


@app.post("/execute_sql", response_model=ExecuteSQLResponse)
async def execute_sql(request: ExecuteSQLRequest):
    try:
        # Load the nao config from the project folder
        project_path = Path(request.nao_project_folder)
        os.chdir(project_path)
        config = NaoConfig.try_load(project_path)

        if config is None:
            raise HTTPException(
                status_code=400,
                detail=f"Could not load nao_config.yaml from {request.nao_project_folder}",
            )

        if len(config.databases) == 0:
            raise HTTPException(
                status_code=400,
                detail="No databases configured in nao_config.yaml",
            )

        # Determine which database to use
        if len(config.databases) == 1:
            db_config = config.databases[0]
        elif request.database_id:
            # Find the database by name
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
            # Multiple databases and no database_id specified
            available_databases = [db.name for db in config.databases]
            raise HTTPException(
                status_code=400,
                detail={
                    "message": "Multiple databases configured. Please specify database_id.",
                    "available_databases": available_databases,
                },
            )

        connection = db_config.connect()

        # Use raw_sql to execute arbitrary SQL (including CTEs)
        cursor = connection.raw_sql(request.sql)

        # Handle different cursor types from different backends
        if hasattr(cursor, "fetchdf"):
            # DuckDB returns a cursor with fetchdf()
            df = cursor.fetchdf()
        elif hasattr(cursor, "to_dataframe"):
            # Some backends return cursors with to_dataframe()
            df = cursor.to_dataframe()
        else:
            # Fallback: try to use pandas read_sql or fetchall
            import pandas as pd

            columns = [desc[0] for desc in cursor.description]
            df = pd.DataFrame(cursor.fetchall(), columns=columns)

        def convert_value(v):
            if isinstance(v, (np.integer,)):
                return int(v)
            if isinstance(v, (np.floating,)):
                return float(v)
            if isinstance(v, np.ndarray):
                return v.tolist()
            if hasattr(v, "item"):  # numpy scalar
                return v.item()
            return v

        data = [{k: convert_value(v) for k, v in row.items()} for row in df.to_dict(orient="records")]

        return ExecuteSQLResponse(
            data=data,
            row_count=len(data),
            columns=[str(c) for c in df.columns.tolist()],
        )
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


if __name__ == "__main__":
    nao_project_folder = os.getenv("NAO_DEFAULT_PROJECT_PATH")
    if nao_project_folder:
        os.chdir(nao_project_folder)
    uvicorn.run("main:app", host="0.0.0.0", port=port, reload=True)
