from pathlib import Path
from unittest.mock import MagicMock, patch

import pytest

from nao_core.commands.migrate.tableau.migrate_tableau import (
    create_assets_directory,
    default_assets_directory,
    export_asset,
    export_workbook,
    export_worksheet_assets,
    load_tableau_config,
    tableau_export_workbook,
)


def test_local_workbook_returns_unsupported_failure(tmp_path: Path) -> None:
    workbook = tmp_path / "local.twb"
    workbook.write_text("<workbook />", encoding="utf-8")

    assert export_workbook(workbook) == {
        "version": "1",
        "success": False,
        "errors": [
            (
                "Local Tableau workbook migration is unsupported because worksheet CSV and image assets "
                "require a published Tableau workbook. Pass its Tableau Cloud workbook name instead."
            )
        ],
    }


def test_load_tableau_config_from_nao_config(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    (tmp_path / "nao_config.yaml").write_text(
        """
project_name: example
tableau:
  server: https://tableau.example.com
  pat_name: name
  pat_value: value
""".lstrip()
    )
    monkeypatch.chdir(tmp_path)

    config = load_tableau_config()

    assert config.server == "https://tableau.example.com"
    assert config.site_name == ""
    assert config.pat_name == "name"
    assert config.pat_value == "value"
    assert config.api_version == "3.21"


def test_tableau_export_uses_interactions_key(tmp_path: Path) -> None:
    client = MagicMock()
    client.find_workbook.return_value = {"id": "workbook-id", "name": "Sales"}
    client.download_workbook.return_value = b"<workbook />"
    client.list_views.return_value = []
    parsed_workbook = {
        "worksheets": ["Sales", "Profit"],
        "dashboards": [{"name": "Overview", "worksheets": ["Sales"]}],
    }

    with (
        patch("nao_core.commands.migrate.tableau.migrate_tableau.tempfile.mkdtemp", return_value=str(tmp_path)),
        patch("nao_core.commands.migrate.tableau.migrate_tableau.load_tableau_config"),
        patch("nao_core.commands.migrate.tableau.migrate_tableau.TableauClient") as client_class,
        patch(
            "nao_core.commands.migrate.tableau.migrate_tableau.parse_workbook",
            return_value=parsed_workbook,
        ) as parse_workbook,
        patch(
            "nao_core.commands.migrate.tableau.migrate_tableau.parse_filters",
            return_value={"controls": []},
        ) as parse_filters,
        patch(
            "nao_core.commands.migrate.tableau.migrate_tableau.export_worksheet_assets",
            return_value=[],
        ) as export_worksheet_assets,
    ):
        client_class.return_value.__enter__.return_value = client
        result = tableau_export_workbook("Sales", None, "Overview")

    assert result["workbook"] == parsed_workbook
    assert result["interactions"] == {"controls": []}
    assert result["assets_directory"] == str(tmp_path)
    assert "definition" not in result
    parse_workbook.assert_called_once_with(b"<workbook />", "Overview")
    parse_filters.assert_called_once_with(b"<workbook />", "Overview")
    export_worksheet_assets.assert_called_once_with(client, ["Sales"], [], tmp_path)


def test_assets_directory_is_explicit_and_not_overwritten(tmp_path: Path) -> None:
    assets_directory = tmp_path / "assets"

    assert create_assets_directory(assets_directory) == assets_directory
    assert assets_directory.is_dir()
    with pytest.raises(FileExistsError):
        create_assets_directory(assets_directory)


def test_assets_directory_defaults_next_to_output(tmp_path: Path) -> None:
    output = tmp_path / "migration.json"

    assert default_assets_directory("Sales", output) == tmp_path / "migration-assets"


def test_export_worksheet_assets_writes_data_and_image(tmp_path: Path) -> None:
    client = MagicMock()
    client.download_view_data.return_value = b"region,sales\nEast,10\n"
    client.download_view_image.return_value = b"png"

    assets = export_worksheet_assets(
        client,
        ["Sales by Region"],
        [{"id": "view-id", "name": "Sales by Region"}],
        tmp_path,
    )

    assert assets == [
        {
            "worksheet": "Sales by Region",
            "view_id": "view-id",
            "success": True,
            "errors": [],
            "data_path": str(tmp_path / "sales-by-region-view-id.csv"),
            "image_path": str(tmp_path / "sales-by-region-view-id.png"),
        }
    ]
    assert (tmp_path / "sales-by-region-view-id.csv").read_bytes() == b"region,sales\nEast,10\n"
    assert (tmp_path / "sales-by-region-view-id.png").read_bytes() == b"png"


def test_export_worksheet_assets_reports_missing_and_duplicate_views(tmp_path: Path) -> None:
    assets = export_worksheet_assets(
        MagicMock(),
        ["Missing", "Duplicate"],
        [
            {"id": "view-1", "name": "Duplicate"},
            {"id": "view-2", "name": "Duplicate"},
        ],
        tmp_path,
    )

    assert assets == [
        {
            "worksheet": "Missing",
            "success": False,
            "errors": ["No published Tableau view matched this worksheet."],
        },
        {
            "worksheet": "Duplicate",
            "success": False,
            "errors": ["Multiple published Tableau views matched this worksheet."],
        },
    ]


def test_export_asset_collects_errors(tmp_path: Path) -> None:
    asset: dict[str, object] = {"errors": []}

    export_asset(asset, "data_path", tmp_path / "data.csv", failed_download)

    assert asset == {"errors": ["Download failed"]}


def failed_download() -> bytes:
    raise ValueError("Download failed")
