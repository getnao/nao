import json
import re
import shutil
import tempfile
from collections.abc import Callable
from pathlib import Path
from typing import Annotated, cast

from cyclopts import Parameter

from nao_core.tracking import track_command

from .client import TableauClient, TableauConfig
from .filters import parse_filters
from .workbook import parse_workbook


def workbook_output(
    workbook: str | Path,
    project: str | None = None,
) -> dict[str, object]:
    try:
        path = Path(workbook)
        if path.exists():
            return local_workbook_output(path)
        if path.suffix.lower() in {".twb", ".twbx"}:
            raise ValueError(f"Workbook {path} does not exist")
        return tableau_workbook_output(str(workbook), project)
    except Exception as error:
        return {
            "_version": "2",
            "success": False,
            "error": str(error),
        }


def local_workbook_output(workbook: Path) -> dict[str, object]:
    if workbook.suffix.lower() not in {".twb", ".twbx"}:
        raise ValueError(f"Workbook {workbook} is not a valid Tableau workbook")
    return {
        "_version": "2",
        "success": True,
        "source": {
            "type": "local",
            "path": str(workbook.resolve()),
        },
        "workbook": parse_workbook(workbook),
        "definition": parse_filters(workbook),
        "worksheet_assets": [],
    }


def tableau_workbook_output(
    workbook_name: str,
    project_name: str | None,
) -> dict[str, object]:
    temporary_directory = Path(tempfile.mkdtemp(prefix="nao-tableau-migration-"))
    try:
        with TableauClient(TableauConfig.from_environment()) as client:
            workbook = client.find_workbook(workbook_name, project_name)
            workbook_bytes = client.download_workbook(workbook["id"])
            composition = parse_workbook(workbook_bytes)
            definition = parse_filters(workbook_bytes)
            views = client.list_views(workbook["id"])
            assets = export_worksheet_assets(
                client,
                cast(list[str], composition["worksheets"]),
                views,
                temporary_directory,
            )

        return {
            "_version": "2",
            "success": True,
            "source": {
                "type": "tableau",
                "workbook_id": workbook["id"],
                "workbook_name": workbook["name"],
                "project_id": workbook.get("project_id"),
                "project_name": workbook.get("project_name"),
            },
            "temporary_directory": str(temporary_directory),
            "workbook": composition,
            "definition": definition,
            "worksheet_assets": assets,
        }
    except Exception:
        shutil.rmtree(temporary_directory, ignore_errors=True)
        raise


def export_worksheet_assets(
    client: TableauClient,
    worksheet_names: list[str],
    views: list[dict[str, str]],
    directory: Path,
) -> list[dict[str, object]]:
    assets: list[dict[str, object]] = []

    for worksheet_name in worksheet_names:
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
                    "error": reason,
                }
            )
            continue

        view = matches[0]
        asset: dict[str, object] = {
            "worksheet": worksheet_name,
            "view_id": view["id"],
            "success": True,
        }
        filename = safe_filename(worksheet_name)
        export_asset(
            asset,
            "data_path",
            "data_error",
            directory / f"{filename}.csv",
            lambda: client.download_view_data(view["id"]),
        )
        export_asset(
            asset,
            "image_path",
            "image_error",
            directory / f"{filename}.png",
            lambda: client.download_view_image(view["id"]),
        )
        asset["success"] = "data_path" in asset and "image_path" in asset
        assets.append(asset)

    return assets


def export_asset(
    asset: dict[str, object],
    path_key: str,
    error_key: str,
    path: Path,
    download: Callable[[], bytes],
) -> None:
    try:
        data = download()
        if not data:
            raise ValueError("Tableau returned an empty response.")
        path.write_bytes(data)
        asset[path_key] = str(path)
    except Exception as error:
        asset[error_key] = str(error)


def safe_filename(value: str) -> str:
    filename = re.sub(r"[^a-z0-9]+", "-", value.lower()).strip("-")
    return filename or "worksheet"


def normalize(value: str) -> str:
    return re.sub(r"[\s_-]+", "", value.lower())


@track_command("migrate-tableau")
def migrate_tableau(
    workbook: str,
    output: Annotated[Path | None, Parameter(name=["-o", "--output"])] = None,
    project: Annotated[str | None, Parameter(name=["--project"])] = None,
) -> None:
    result = json.dumps(workbook_output(workbook, project), indent=2)
    if output is None:
        print(result)
        return

    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(f"{result}\n", encoding="utf-8")
