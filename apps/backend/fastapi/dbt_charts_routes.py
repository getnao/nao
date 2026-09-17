"""dbt Charts endpoints: validate and render YAML boards with SQL routed through nao databases."""

from pathlib import Path
from typing import Any

from fastapi import APIRouter, HTTPException
from fastapi.responses import FileResponse
from pydantic import BaseModel

from nao_core.config import NaoConfig, NaoConfigError
from nao_core.dbt_charts import (
    DbtChartsUnavailableError,
    dbt_charts_version,
    find_dbt_project_dir,
    font_file_path,
    is_available,
    render_board,
    validate_board,
)

from sql_execution import (
    GuardError,
    dataframe_to_records,
    run_guarded_sql,
    select_database,
)

router = APIRouter(prefix="/dbt_charts")


class DbtChartsStatusResponse(BaseModel):
    available: bool
    version: str | None
    install_hint: str | None


class ValidateBoardRequest(BaseModel):
    yaml: str
    nao_project_folder: str
    database_id: str | None = None
    env_vars: dict[str, str] | None = None


class RenderBoardRequest(ValidateBoardRequest):
    variables: dict[str, Any] | None = None
    azure_access_token: str | None = None
    enforce_excluded_columns: bool = False
    font_url_prefix: str | None = None


@router.get("/status", response_model=DbtChartsStatusResponse)
async def dbt_charts_status():
    available = is_available()
    return DbtChartsStatusResponse(
        available=available,
        version=dbt_charts_version() if available else None,
        install_hint=None if available else DbtChartsUnavailableError().args[0],
    )


@router.post("/validate")
async def validate_dbt_charts_board(request: ValidateBoardRequest):
    with _translate_errors():
        config = _load_config(request)
        default_database = _default_database_name(config, request.database_id)
        return validate_board(request.yaml, default_database=default_database).to_dict()


@router.post("/render")
async def render_dbt_charts_board(request: RenderBoardRequest):
    with _translate_errors():
        project_path = Path(request.nao_project_folder)
        config = _load_config(request)
        databases_by_name = {db.name: db for db in config.databases}

        def run_sql(database_name: str, sql: str):
            db_config = databases_by_name[database_name]
            df = run_guarded_sql(
                sql,
                db_config,
                project_path,
                request.enforce_excluded_columns,
                request.azure_access_token,
            )
            return dataframe_to_records(df)

        result = render_board(
            request.yaml,
            databases={db.name: db.type for db in config.databases},
            default_database=_default_database_name(config, request.database_id),
            run_sql=run_sql,
            variables=request.variables,
            dbt_project_dir=find_dbt_project_dir(
                project_path, _repo_dirs(config, project_path)
            ),
            font_url_prefix=request.font_url_prefix,
        )
        return result.to_dict()


@router.get("/fonts/{file_name}")
async def dbt_charts_font(file_name: str):
    with _translate_errors():
        path = font_file_path(file_name)
    if path is None:
        raise HTTPException(status_code=404, detail="Unknown font")
    return FileResponse(
        path, headers={"Cache-Control": "public, max-age=31536000, immutable"}
    )


def _load_config(request: ValidateBoardRequest) -> NaoConfig:
    config = NaoConfig.try_load(
        Path(request.nao_project_folder),
        raise_on_error=True,
        extra_env=request.env_vars,
    )
    assert config is not None
    return config


def _default_database_name(config: NaoConfig, database_id: str | None) -> str | None:
    if not config.databases:
        return None
    if len(config.databases) == 1 or database_id:
        return select_database(config, database_id).name
    return None


def _repo_dirs(config: NaoConfig, project_path: Path) -> list[Path]:
    """Synced repositories live under `repos/`; the bare name is kept for projects that vendor them at the root."""
    dirs: list[Path] = []
    for repo in config.repos:
        dirs.append(project_path / "repos" / repo.name)
        dirs.append(project_path / repo.name)
        if repo.local_path:
            dirs.append(
                Path(repo.local_path)
                if Path(repo.local_path).is_absolute()
                else project_path / repo.local_path
            )
    return dirs


class _translate_errors:
    """Map domain errors onto HTTP statuses; guard errors (400) must not surface as 500s."""

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc, _traceback):
        if exc is None or isinstance(exc, HTTPException):
            return False
        if isinstance(exc, DbtChartsUnavailableError):
            raise HTTPException(status_code=501, detail=str(exc)) from exc
        if isinstance(exc, (NaoConfigError, *GuardError)):
            raise HTTPException(status_code=400, detail=str(exc)) from exc
        raise HTTPException(status_code=500, detail=str(exc)) from exc
