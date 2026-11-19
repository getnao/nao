from pathlib import Path

import pytest
import yaml

from nao_core.config.file_references import resolve_file_references

TABLES_FILE = "repos/business_context/tables.yml"
NESTED_ALIASES = "\n".join(
    [
        "level_0: &level_0 [analytics.orders, analytics.orders]",
        *(f"level_{level + 1}: &level_{level + 1} [*level_{level}, *level_{level}]" for level in range(18)),
    ]
)
ALIAS_TO_ITS_OWN_PARENT = "tables: &tables [*tables]"


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


def test_sections_holding_a_missing_file_are_left_out_when_allowed(tmp_path: Path):
    repos = [{"name": "business_context", "url": "https://github.com/acme/business_context"}]
    data = {
        "project_name": "acme",
        "repos": repos,
        "databases": [{"name": {"from_file": "repos/business_context/name.yml"}, "type": "duckdb"}],
    }

    resolved, references = resolve_file_references(data, tmp_path, allow_missing=True)

    assert resolved == {"project_name": "acme", "repos": repos}
    assert references.missing_files == ["repos/business_context/name.yml"]


def test_a_missing_file_in_repos_fails_the_load_even_when_allowed(tmp_path: Path):
    repo = {"name": "dbt", "url": "https://github.com/acme/dbt", "include": {"from_file": TABLES_FILE}}

    with pytest.raises(ValueError, match="must already be in the project"):
        resolve_file_references({"repos": [repo]}, tmp_path, allow_missing=True)


@pytest.mark.parametrize(
    ("config", "file"),
    [
        pytest.param(NESTED_ALIASES, "- analytics.orders\n", id="nested_aliases"),
        pytest.param(ALIAS_TO_ITS_OWN_PARENT, "- analytics.orders\n", id="alias_to_its_own_parent"),
        pytest.param(f"include:\n  from_file: {TABLES_FILE}\n", NESTED_ALIASES, id="file_with_nested_aliases"),
        pytest.param(
            f"include:\n  from_file: {TABLES_FILE}\n", ALIAS_TO_ITS_OWN_PARENT, id="file_with_alias_to_its_own_parent"
        ),
    ],
)
def test_a_config_that_aliases_expand_beyond_the_node_budget_is_refused(tmp_path: Path, config: str, file: str):
    write_project_file(tmp_path, TABLES_FILE, file)

    with pytest.raises(ValueError, match="more than 100000 values"):
        resolve_file_references(yaml.safe_load(config), tmp_path)


def test_aliases_within_the_node_budget_are_kept(tmp_path: Path):
    data = yaml.safe_load("shared: &shared [analytics.orders]\ninclude: *shared\nexclude: *shared\n")

    resolved, _ = resolve_file_references(data, tmp_path)

    assert resolved == {
        "shared": ["analytics.orders"],
        "include": ["analytics.orders"],
        "exclude": ["analytics.orders"],
    }


def test_restore_puts_references_back_and_reports_those_whose_value_moved(tmp_path: Path):
    write_project_file(tmp_path, TABLES_FILE, "- analytics.orders\n")
    write_project_file(tmp_path, "endpoint.yml", "https://proxy.acme.com\n")
    data = {
        "databases": [{"name": "warehouse", "include": {"from_file": TABLES_FILE}}],
        "llm": {"provider": "openai", "base_url": {"from_file": "endpoint.yml"}},
    }
    _, references = resolve_file_references(data, tmp_path)
    saved = {
        "databases": [{"name": "warehouse", "include": ["analytics.orders"]}],
        "llm": {"providers": [{"provider": "openai", "base_url": "https://proxy.acme.com"}]},
    }

    lost = references.restore(saved)

    assert saved["databases"] == data["databases"]
    assert saved["llm"] == {"providers": [{"provider": "openai", "base_url": "https://proxy.acme.com"}]}
    assert lost == ["endpoint.yml"]


@pytest.mark.parametrize(
    ("file", "content", "error"),
    [
        pytest.param("../tables.yml", "- a.b\n", "no '..'", id="parent_folder"),
        pytest.param("/etc/tables.yml", "- a.b\n", "relative path", id="absolute_path"),
        pytest.param("linked/tables.yml", "- a.b\n", "outside the project", id="symlink_out_of_the_project"),
        pytest.param(".tables.yml", "- a.b\n", "dotfile", id="dotfile"),
        pytest.param(".hidden/tables.yml", "- a.b\n", "dot folder", id="dot_folder"),
        pytest.param("visible.yml", "- a.b\n", "dotfile", id="symlink_to_a_dotfile"),
        pytest.param("tables.yml", "- \"{{ env('SECRET') }}\"\n", "secret reference", id="secret_reference"),
        pytest.param(
            "tables.yml", "- \"\\u007b\\u007b env('SECRET') }}\"\n", "secret reference", id="escaped_secret_reference"
        ),
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
    write_project_file(project_path, ".tables.yml", content)
    write_project_file(project_path, ".hidden/tables.yml", content)
    (project_path / "visible.yml").symlink_to(project_path / ".tables.yml")

    with pytest.raises(ValueError, match=error):
        resolve_file_references({"include": {"from_file": file}}, project_path, allow_missing=True)
