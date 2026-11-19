from pathlib import Path

import pytest

from nao_core.config.file_references import resolve_file_references

TABLES_FILE = "repos/business_context/tables.yml"


def write_project_file(project_path: Path, file: str, content: str) -> None:
    file_path = project_path / file
    file_path.parent.mkdir(parents=True, exist_ok=True)
    file_path.write_text(content)


def test_references_are_replaced_by_the_content_of_their_file(tmp_path: Path):
    write_project_file(tmp_path, TABLES_FILE, "- analytics.orders\n- analytics.dim_*\n")
    write_project_file(tmp_path, "databases/extra.yml", "name: extra\ntype: duckdb\n")
    data = {
        "databases": [
            {"name": "warehouse", "include": {"from_file": TABLES_FILE}},
            {"from_file": "databases/extra.yml"},
        ]
    }

    resolved, references = resolve_file_references(data, tmp_path)

    assert resolved == {
        "databases": [
            {"name": "warehouse", "include": ["analytics.orders", "analytics.dim_*"]},
            {"name": "extra", "type": "duckdb"},
        ]
    }
    assert references.missing_files == []


def test_a_missing_file_fails_the_load(tmp_path: Path):
    data = {"databases": [{"name": "warehouse", "include": {"from_file": TABLES_FILE}}]}

    with pytest.raises(ValueError, match=r"tables\.yml' does not exist.*nao sync -p repos"):
        resolve_file_references(data, tmp_path)


def test_a_missing_file_is_left_out_when_allowed_and_restored_on_save(tmp_path: Path):
    write_project_file(tmp_path, "exclude.yml", "- tmp.*\n")
    data = {
        "databases": [
            {"from_file": "databases/extra.yml"},
            {"name": "warehouse", "include": {"from_file": TABLES_FILE}, "exclude": {"from_file": "exclude.yml"}},
        ]
    }

    resolved, references = resolve_file_references(data, tmp_path, allow_missing=True)

    assert resolved == {"databases": [{"name": "warehouse", "exclude": ["tmp.*"]}]}
    assert references.missing_files == ["databases/extra.yml", TABLES_FILE]

    references.restore(resolved)

    assert resolved == data


@pytest.mark.parametrize(
    ("file", "content", "error"),
    [
        pytest.param("../tables.yml", "- a.b\n", "no '..'", id="parent_folder"),
        pytest.param("/etc/tables.yml", "- a.b\n", "relative path", id="absolute_path"),
        pytest.param("linked/tables.yml", "- a.b\n", "outside the project", id="symlink_out_of_the_project"),
        pytest.param("tables.yml", "- \"{{ env('SECRET') }}\"\n", "secret reference", id="secret_reference"),
        pytest.param("tables.yml", "- from_file: other.yml\n", "another from_file", id="nested_reference"),
        pytest.param("tables.yml", "- [unclosed\n", "not valid YAML", id="invalid_yaml"),
    ],
)
def test_unsafe_or_unreadable_files_are_refused(tmp_path: Path, file: str, content: str, error: str):
    project_path = tmp_path / "project"
    project_path.mkdir()
    write_project_file(tmp_path, "outside/tables.yml", content)
    (project_path / "linked").symlink_to(tmp_path / "outside")
    write_project_file(project_path, "tables.yml", content)

    with pytest.raises(ValueError, match=error):
        resolve_file_references({"include": {"from_file": file}}, project_path, allow_missing=True)
