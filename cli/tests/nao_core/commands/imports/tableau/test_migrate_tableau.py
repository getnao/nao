from pathlib import Path

from nao_core.commands.imports.tableau.migrate_tableau import workbook_output


def test_local_workbook_returns_unsupported_failure(tmp_path: Path) -> None:
    workbook = tmp_path / "local.twb"
    workbook.write_text("<workbook />", encoding="utf-8")

    assert workbook_output(workbook) == {
        "_version": "2",
        "success": False,
        "error": (
            "Local Tableau workbook migration is unsupported because worksheet CSV and image assets "
            "require a published Tableau workbook. Pass its Tableau Cloud workbook name instead."
        ),
    }
