"""Tests for the `nao test show <name>` subcommand."""

from __future__ import annotations

from pathlib import Path

import pytest

from nao_core.commands.test.show import show


def _write_test_yaml(path: Path, name: str, prompt: str, sql: str = "select 1") -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(f'name: "{name}"\nprompt: "{prompt}"\nsql: |\n  {sql}\n')


def _patch_ui_print(monkeypatch):
    """Capture every UI.print call as a structured list of args."""
    captured: list[tuple[tuple, dict]] = []

    def fake_print(cls, *args, **kwargs):
        captured.append((args, kwargs))

    def fake_error(cls, *args, **kwargs):
        captured.append((args, {"_error": True, **kwargs}))

    monkeypatch.setattr("nao_core.ui.UI.print", classmethod(fake_print))
    monkeypatch.setattr("nao_core.ui.UI.error", classmethod(fake_error))
    return captured


def test_show_prints_one_test_full_detail(tmp_path: Path, monkeypatch):
    _write_test_yaml(tmp_path / "tests" / "orders.yml", "orders", "How many orders?")
    monkeypatch.chdir(tmp_path)
    captured = _patch_ui_print(monkeypatch)

    show(select="orders")

    lines = [a[0][0] for a in captured if a[0] and isinstance(a[0][0], str)]
    joined = "\n".join(lines)
    assert "Test:    orders" in joined
    assert "File:    tests/orders.yml" in joined
    assert "Prompt:  How many orders?" in joined
    assert "SQL:" in joined
    assert "select 1" in joined


def test_show_comma_separated_prints_each_match(tmp_path: Path, monkeypatch):
    _write_test_yaml(tmp_path / "tests" / "orders.yml", "orders", "Orders prompt.")
    _write_test_yaml(tmp_path / "tests" / "users.yml", "users", "Users prompt.")
    monkeypatch.chdir(tmp_path)
    captured = _patch_ui_print(monkeypatch)

    show(select="orders,users")

    joined = "\n".join(a[0][0] for a in captured if a[0] and isinstance(a[0][0], str))
    assert "Test:    orders" in joined
    assert "Test:    users" in joined
    # Blank line between matches
    assert "" in [a[0][0] for a in captured if a[0] and isinstance(a[0][0], str)]


def test_show_subfolder_selector(tmp_path: Path, monkeypatch):
    _write_test_yaml(tmp_path / "tests" / "a" / "x.yml", "x", "X prompt.")
    _write_test_yaml(tmp_path / "tests" / "b" / "y.yml", "y", "Y prompt.")
    monkeypatch.chdir(tmp_path)
    captured = _patch_ui_print(monkeypatch)

    show(select="a")

    joined = "\n".join(a[0][0] for a in captured if a[0] and isinstance(a[0][0], str))
    assert "Test:    x" in joined
    assert "Test:    y" not in joined


def test_show_unknown_selector_exits_with_error(tmp_path: Path, monkeypatch):
    _write_test_yaml(tmp_path / "tests" / "real.yml", "real", "Prompt.")
    monkeypatch.chdir(tmp_path)
    captured = _patch_ui_print(monkeypatch)
    monkeypatch.setattr("sys.exit", lambda code=0: (_ for _ in ()).throw(SystemExit(code)))

    with pytest.raises(SystemExit) as excinfo:
        show(select="does_not_exist")

    assert excinfo.value.code == 1
    assert any(a[1].get("_error") for a in captured)


def test_show_no_tests_folder_exits_with_error(tmp_path: Path, monkeypatch):
    monkeypatch.chdir(tmp_path)
    _patch_ui_print(monkeypatch)
    monkeypatch.setattr("sys.exit", lambda code=0: (_ for _ in ()).throw(SystemExit(code)))

    with pytest.raises(SystemExit) as excinfo:
        show(select="anything")

    assert excinfo.value.code == 1


def test_show_sql_only_prints_only_sql(tmp_path: Path, monkeypatch):
    _write_test_yaml(tmp_path / "tests" / "orders.yml", "orders", "Orders prompt.", "select 42")
    monkeypatch.chdir(tmp_path)
    captured = _patch_ui_print(monkeypatch)

    show(select="orders", sql_only=True)

    printed = [a[0][0] for a in captured if a[0] and isinstance(a[0][0], str)]
    joined = "\n".join(printed)
    assert "select 42" in joined
    # No name, no file path, no prompt label, no SQL: header
    assert "Test:" not in joined
    assert "File:" not in joined
    assert "Prompt:" not in joined
    assert "SQL:" not in joined
    assert "Orders prompt." not in joined


def test_show_prompt_only_prints_only_prompt(tmp_path: Path, monkeypatch):
    _write_test_yaml(tmp_path / "tests" / "orders.yml", "orders", "Orders prompt.", "select 42")
    monkeypatch.chdir(tmp_path)
    captured = _patch_ui_print(monkeypatch)

    show(select="orders", prompt_only=True)

    printed = [a[0][0] for a in captured if a[0] and isinstance(a[0][0], str)]
    assert "Orders prompt." in printed
    assert "select 42" not in printed
    assert "Test:" not in "\n".join(printed)
    assert "SQL:" not in "\n".join(printed)


def test_show_both_flags_together_exits_with_error(tmp_path: Path, monkeypatch):
    _write_test_yaml(tmp_path / "tests" / "orders.yml", "orders", "Prompt.")
    monkeypatch.chdir(tmp_path)
    captured = _patch_ui_print(monkeypatch)
    monkeypatch.setattr("sys.exit", lambda code=0: (_ for _ in ()).throw(SystemExit(code)))

    with pytest.raises(SystemExit) as excinfo:
        show(select="orders", sql_only=True, prompt_only=True)

    assert excinfo.value.code == 1
    assert any(a[1].get("_error") for a in captured)


def test_show_yaml_stem_selector(tmp_path: Path, monkeypatch):
    _write_test_yaml(tmp_path / "tests" / "orders_count.yml", "orders_count", "Prompt.")
    _write_test_yaml(tmp_path / "tests" / "orders_count_v2.yml", "orders_count_v2", "V2 prompt.")
    monkeypatch.chdir(tmp_path)
    captured = _patch_ui_print(monkeypatch)

    show(select="orders_count")

    joined = "\n".join(a[0][0] for a in captured if a[0] and isinstance(a[0][0], str))
    assert "Test:    orders_count" in joined
    assert "Test:    orders_count_v2" not in joined
