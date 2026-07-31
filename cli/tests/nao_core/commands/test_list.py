"""Tests for the `nao test list` subcommand."""

from __future__ import annotations

from pathlib import Path

import pytest

from nao_core.commands.test.list import list_tests


def _write_test_yaml(path: Path, name: str, prompt: str, sql: str = "select 1") -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(f'name: "{name}"\nprompt: "{prompt}"\nsql: |\n  {sql}\n')


def _patch_ui_table(monkeypatch):
    """Capture the rows the list subcommand would render as a table."""
    captured: list[dict] = []
    titles: list[str | None] = []

    def fake_table(cls, df, title=None, sum_columns=None):  # noqa: ARG001
        titles.append(title)
        captured.extend(df.to_dict("records"))

    monkeypatch.setattr("nao_core.ui.UI.table", classmethod(fake_table))

    def fake_warn(cls, msg: str) -> None:
        captured.append({"_warn": msg})

    def fake_error(cls, msg: str) -> None:
        captured.append({"_error": msg})

    monkeypatch.setattr("nao_core.ui.UI.warn", classmethod(fake_warn))
    monkeypatch.setattr("nao_core.ui.UI.error", classmethod(fake_error))

    return captured, titles


def test_list_discovers_every_yaml_in_tests_folder(tmp_path: Path, monkeypatch):
    _write_test_yaml(tmp_path / "tests" / "orders.yml", "orders", "Count orders.")
    _write_test_yaml(tmp_path / "tests" / "users.yml", "users", "Count users.")
    monkeypatch.chdir(tmp_path)

    captured, titles = _patch_ui_table(monkeypatch)
    list_tests()

    assert titles == ["Discovered 2 test cases"]
    names = [row["Name"] for row in captured]
    assert names == ["orders", "users"]


def test_list_renders_path_relative_to_project_root(tmp_path: Path, monkeypatch):
    _write_test_yaml(tmp_path / "tests" / "deep" / "x.yml", "x", "Prompt x.")
    monkeypatch.chdir(tmp_path)

    captured, _ = _patch_ui_table(monkeypatch)
    list_tests()

    assert captured[0]["File"] == str(Path("tests") / "deep" / "x.yml")


def test_list_singular_label_for_single_test(tmp_path: Path, monkeypatch):
    _write_test_yaml(tmp_path / "tests" / "only.yml", "only", "Prompt only.")
    monkeypatch.chdir(tmp_path)

    captured, titles = _patch_ui_table(monkeypatch)
    list_tests()

    assert titles == ["Discovered 1 test case"]


def test_list_truncates_long_prompts(tmp_path: Path, monkeypatch):
    long_prompt = "x" * 200
    _write_test_yaml(tmp_path / "tests" / "long.yml", "long", long_prompt)
    monkeypatch.chdir(tmp_path)

    captured, _ = _patch_ui_table(monkeypatch)
    list_tests(prompt_length=40)

    assert captured[0]["Prompt"].endswith("...")
    assert len(captured[0]["Prompt"]) <= 43


def test_list_prompt_length_zero_hides_prompt_column(tmp_path: Path, monkeypatch):
    _write_test_yaml(tmp_path / "tests" / "hide.yml", "hide", "Should not appear.")
    monkeypatch.chdir(tmp_path)

    captured, _ = _patch_ui_table(monkeypatch)
    list_tests(prompt_length=0)

    assert captured[0]["Prompt"] == ""


def test_list_prompt_length_at_least_text_length_does_not_truncate(tmp_path: Path, monkeypatch):
    _write_test_yaml(tmp_path / "tests" / "short.yml", "short", "Short prompt.")
    monkeypatch.chdir(tmp_path)

    captured, _ = _patch_ui_table(monkeypatch)
    list_tests(prompt_length=200)

    assert captured[0]["Prompt"] == "Short prompt."


def test_list_select_filter_narrows_results(tmp_path: Path, monkeypatch):
    _write_test_yaml(tmp_path / "tests" / "orders.yml", "orders", "Count orders.")
    _write_test_yaml(tmp_path / "tests" / "users.yml", "users", "Count users.")
    monkeypatch.chdir(tmp_path)

    captured, _ = _patch_ui_table(monkeypatch)
    list_tests(select="orders")

    assert [row["Name"] for row in captured] == ["orders"]


def test_list_select_folder_filter(tmp_path: Path, monkeypatch):
    _write_test_yaml(tmp_path / "tests" / "a" / "x.yml", "x", "prompt")
    _write_test_yaml(tmp_path / "tests" / "b" / "y.yml", "y", "prompt")
    monkeypatch.chdir(tmp_path)

    captured, _ = _patch_ui_table(monkeypatch)
    list_tests(select="a")

    assert [row["Name"] for row in captured] == ["x"]


def test_list_unknown_selector_exits_with_error(tmp_path: Path, monkeypatch):
    _write_test_yaml(tmp_path / "tests" / "real.yml", "real", "prompt")
    monkeypatch.chdir(tmp_path)

    captured, _ = _patch_ui_table(monkeypatch)
    monkeypatch.setattr("sys.exit", lambda code=0: (_ for _ in ()).throw(SystemExit(code)))

    with pytest.raises(SystemExit):
        list_tests(select="does_not_exist")

    assert any("_error" in row and "does_not_exist" in row["_error"] for row in captured)


def test_list_no_tests_folder_warns_and_returns_silently(tmp_path: Path, monkeypatch):
    monkeypatch.chdir(tmp_path)
    captured, titles = _patch_ui_table(monkeypatch)

    list_tests()

    assert titles == []
    assert any("_warn" in row for row in captured)


def test_list_filter_excludes_everything_warns(tmp_path: Path, monkeypatch):
    _write_test_yaml(tmp_path / "tests" / "real.yml", "real", "prompt")
    monkeypatch.chdir(tmp_path)

    captured, _ = _patch_ui_table(monkeypatch)
    monkeypatch.setattr("sys.exit", lambda code=0: (_ for _ in ()).throw(SystemExit(code)))

    with pytest.raises(SystemExit):
        list_tests(select="nope")

    assert any("_error" in row for row in captured)
