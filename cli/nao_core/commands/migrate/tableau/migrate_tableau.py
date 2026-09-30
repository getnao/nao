import json
import re
import shutil
import tempfile
from collections.abc import Callable
from pathlib import Path
from typing import Annotated, cast

import httpx
from cyclopts import Parameter

from nao_core.config import NaoConfig, TableauConfig, resolve_project_path
from nao_core.tracking import track_command

from .client import TableauClient
from .filters import parse_filters
from .utils import normalize
from .workbook import parse_workbook


def export_workbook(
    workbook: str | Path,
    project: str | None = None,
    dashboard: str | None = None,
    assets_dir: Path | None = None,
) -> dict[str, object]:
    try:
        path = Path(workbook)
        if path.exists():
            if path.suffix.lower() not in {".twb", ".twbx"}:
                raise ValueError(f"Workbook {path} is not a valid Tableau workbook")
            raise ValueError(
                "Local Tableau workbook migration is unsupported because worksheet CSV and image assets "
                "require a published Tableau workbook. Pass its Tableau Cloud workbook name instead."
            )
        if path.suffix.lower() in {".twb", ".twbx"}:
            raise ValueError(f"Workbook {path} does not exist")
        return tableau_export_workbook(str(workbook), project, dashboard, assets_dir)
    except (ValueError, httpx.HTTPError, OSError) as error:
        return {
            "version": "1",
            "success": False,
            "errors": [str(error)],
        }


def tableau_export_workbook(
    workbook_name: str,
    project_name: str | None,
    dashboard_name: str | None = None,
    assets_dir: Path | None = None,
) -> dict[str, object]:
    assets_directory = create_assets_directory(assets_dir)
    try:
        with TableauClient(load_tableau_config()) as client:
            workbook = client.find_workbook(workbook_name, project_name)
            workbook_bytes = client.download_workbook(workbook["id"])
            parsed_workbook = parse_workbook(workbook_bytes, dashboard_name)
            interactions = parse_filters(workbook_bytes, dashboard_name)
            views = client.list_views(workbook["id"])
            assets = export_worksheet_assets(
                client,
                selected_worksheet_names(parsed_workbook, dashboard_name),
                views,
                assets_directory,
            )

        return {
            "version": "1",
            "success": True,
            "source": {
                "type": "tableau",
                "workbook_id": workbook["id"],
                "workbook_name": workbook["name"],
                "project_id": workbook.get("project_id"),
                "project_name": workbook.get("project_name"),
            },
            "assets_directory": str(assets_directory),
            "workbook": parsed_workbook,
            "interactions": interactions,
            "worksheet_assets": assets,
            "errors": [],
        }
    except Exception:
        shutil.rmtree(assets_directory, ignore_errors=True)
        raise


def load_tableau_config() -> TableauConfig:
    config = NaoConfig.load(resolve_project_path(), drop_invalid_optional_sections=True)
    if config.tableau is None:
        raise ValueError("Tableau is not configured. Run `nao migrate tableau configure` from your nao project.")
    return config.tableau


def create_assets_directory(assets_dir: Path | None) -> Path:
    if assets_dir is None:
        return Path(tempfile.mkdtemp(prefix="nao-tableau-migration-"))

    directory = assets_dir.expanduser().resolve()
    directory.mkdir(parents=True, exist_ok=False)
    return directory


def selected_worksheet_names(
    parsed_workbook: dict[str, object],
    dashboard_name: str | None,
) -> list[str]:
    if dashboard_name is None:
        return cast(list[str], parsed_workbook["worksheets"])

    return [
        worksheet
        for dashboard in cast(list[dict[str, object]], parsed_workbook["dashboards"])
        for worksheet in cast(list[str], dashboard["worksheets"])
    ]


def export_worksheet_assets(
    client: TableauClient,
    worksheet_names: list[str],
    views: list[dict[str, str]],
    directory: Path,
) -> list[dict[str, object]]:
    assets: list[dict[str, object]] = []

    for worksheet_name in worksheet_names:
        matches = [view for view in views if view["name"] == worksheet_name]
        if not matches:
            matches = [view for view in views if normalize(view["name"]) == normalize(worksheet_name)]
        if len(matches) != 1:
            reason = (
                "No published Tableau view matched this worksheet."
                if not matches
                else "Multiple published Tableau views matched this worksheet."
            )
            assets.append(
                {
                    "worksheet": worksheet_name,
                    "success": False,
                    "errors": [reason],
                }
            )
            continue

        view = matches[0]
        asset: dict[str, object] = {
            "worksheet": worksheet_name,
            "view_id": view["id"],
            "success": True,
            "errors": [],
        }
        filename = f"{safe_filename(worksheet_name)}-{safe_filename(view['id'])}"
        export_asset(
            asset,
            "data_path",
            directory / f"{filename}.csv",
            lambda: client.download_view_data(view["id"]),
        )
        export_asset(
            asset,
            "image_path",
            directory / f"{filename}.png",
            lambda: client.download_view_image(view["id"]),
        )
        asset["success"] = "data_path" in asset and "image_path" in asset
        assets.append(asset)

    return assets


def export_asset(
    asset: dict[str, object],
    path_key: str,
    path: Path,
    download: Callable[[], bytes],
) -> None:
    try:
        data = download()
        if not data:
            raise ValueError("Tableau returned an empty response.")
        path.write_bytes(data)
        asset[path_key] = str(path)
    except (ValueError, httpx.HTTPError, OSError) as error:
        cast(list[str], asset["errors"]).append(str(error))


def safe_filename(value: str) -> str:
    filename = re.sub(r"[^a-z0-9]+", "-", value.lower()).strip("-")
    return filename or "worksheet"


@track_command("migrate-tableau")
def tableau(
    workbook: str,
    output: Annotated[Path | None, Parameter(name=["-o", "--output"])] = None,
    dashboard: Annotated[str | None, Parameter(name="--dashboard")] = None,
    assets_dir: Annotated[Path | None, Parameter(name="--assets-dir")] = None,
    project: Annotated[str | None, Parameter(name="--project")] = None,
) -> None:
    assets_dir = assets_dir or default_assets_directory(workbook, output)
    result = json.dumps(export_workbook(workbook, project, dashboard, assets_dir), indent=2)
    if output is None:
        print(result)
        return

    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(f"{result}\n", encoding="utf-8")


def default_assets_directory(workbook: str, output: Path | None) -> Path:
    if output is not None:
        return output.parent / f"{output.stem}-assets"
    return Path.cwd() / f"{safe_filename(workbook)}-assets"
