"""Tests for the `nao test summary` subcommand."""

from __future__ import annotations

import importlib.util
import json
from pathlib import Path
from typing import Any

import pytest

from nao_core.commands.test.summary_cmd import summary

# `nao_core.commands.test` is shadowed by the cyclopts App at the package
# level (commands/test/__init__.py creates `test = App(...)`), so dotted
# imports of the submodule fail with "cannot import name 'summary_cmd' from
# <unknown module name>". Load the source file directly to reach the private
# helpers (`_resolve_default_file`, `_render_overall`, `_render_by_model`).
# Use the dotted name so the module's relative imports resolve.
_SUMMARY_CMD_FILE = Path(__file__).resolve().parents[3] / "nao_core" / "commands" / "test" / "summary_cmd.py"
_spec = importlib.util.spec_from_file_location("nao_core.commands.test.summary_cmd", _SUMMARY_CMD_FILE)
assert _spec is not None and _spec.loader is not None
summary_module = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(summary_module)


def _write_results_file(
    path: Path,
    *,
    results: list[dict] | None = None,
    include_by_model: bool = True,
) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    body = {
        "timestamp": "2026-07-30T00:00:00",
        "results": results
        if results is not None
        else [
            {
                "name": "orders_count",
                "model": "openai:gpt-4.1",
                "passed": True,
                "message": "match",
                "tokens": 100,
                "cost": 0.001,
                "duration_ms": 1000,
                "tool_call_count": 1,
            }
        ],
        "summary": {
            "total": 1,
            "passed": 1,
            "failed": 0,
            "total_tokens": 100,
            "total_cost": 0.001,
            "total_duration_ms": 1000,
            "total_duration_s": 1.0,
            "total_tool_calls": 1,
            "avg_duration_ms": 1000,
            "avg_tool_calls": 1.0,
        },
    }
    if include_by_model and results is not None and len(results) > 1:
        body["by_model"] = [
            {
                "model": "openai:gpt-4.1",
                "total": 1,
                "passed": 1,
                "failed": 0,
                "pass_rate": 100.0,
                "total_tokens": 100,
                "total_cost": 0.001,
                "total_duration_ms": 1000,
                "avg_duration_ms": 1000.0,
                "total_tool_calls": 1,
                "avg_tool_calls": 1.0,
            }
        ]
    path.write_text(json.dumps(body))


def _patch_ui(monkeypatch):
    """Capture every UI call as a structured list of (method, args, kwargs) tuples."""
    captured: list[tuple[str, tuple, dict]] = []

    def make_capture(method_name: str):
        def capture(cls, *args, **kwargs):
            captured.append((method_name, args, kwargs))

        return capture

    for name in ("print", "success", "warn", "error", "title", "info", "table"):
        monkeypatch.setattr(f"nao_core.ui.UI.{name}", classmethod(make_capture(name)))

    return captured


def _calls(captured, method: str) -> list[tuple[tuple, dict]]:
    """Return just the args/kwargs of every call to a given UI method."""
    return [(args, kwargs) for name, args, kwargs in captured if name == method]


def _has_call(captured, method: str, *, contains: str | None = None) -> bool:
    """Return True if the named UI method was called, optionally with substring match on the first arg."""
    for name, args, _kwargs in captured:
        if name != method:
            continue
        if contains is None:
            return True
        if args and contains in str(args[0]):
            return True
    return False


# ---------------------------------------------------------------------------
# File resolution
# ---------------------------------------------------------------------------


def test_summary_with_explicit_file_runs(tmp_path: Path, monkeypatch):
    file = tmp_path / "results.json"
    _write_results_file(file)
    captured = _patch_ui(monkeypatch)

    summary(file=file)

    assert _has_call(captured, "success")


def test_summary_without_file_uses_most_recent_in_outputs(tmp_path: Path, monkeypatch):
    monkeypatch.chdir(tmp_path)
    outputs = tmp_path / "tests" / "outputs"
    _write_results_file(outputs / "results_20260701_000000.json")
    _write_results_file(outputs / "results_20260715_120000.json")
    captured = _patch_ui(monkeypatch)

    summary()

    # If the wrong file had been picked, the success line would not have
    # fired (missing-file error path). The per-model backfill from
    # `with_model_summaries` proves the file was loaded; the `_resolve_default_file`
    # test covers the "most recent" sort. Here we just verify the happy path runs.
    assert _has_call(captured, "success")


def test_summary_without_file_errors_when_no_outputs_folder(tmp_path: Path, monkeypatch):
    monkeypatch.chdir(tmp_path)
    captured = _patch_ui(monkeypatch)
    monkeypatch.setattr("sys.exit", lambda code=0: (_ for _ in ()).throw(SystemExit(code)))

    with pytest.raises(SystemExit):
        summary()

    assert _has_call(captured, "error", contains="No results")


def test_summary_without_file_errors_when_outputs_folder_is_empty(tmp_path: Path, monkeypatch):
    monkeypatch.chdir(tmp_path)
    (tmp_path / "tests" / "outputs").mkdir(parents=True)
    captured = _patch_ui(monkeypatch)
    monkeypatch.setattr("sys.exit", lambda code=0: (_ for _ in ()).throw(SystemExit(code)))

    with pytest.raises(SystemExit):
        summary()

    assert _has_call(captured, "error", contains="No results")


def test_resolve_default_file_returns_none_when_outputs_dir_missing(tmp_path: Path):
    result = summary_module._resolve_default_file(tmp_path)
    assert result is None


def test_resolve_default_file_returns_none_when_no_files(tmp_path: Path):
    (tmp_path / "tests" / "outputs").mkdir(parents=True)
    result = summary_module._resolve_default_file(tmp_path)
    assert result is None


def test_resolve_default_file_returns_most_recent(tmp_path: Path):
    outputs = tmp_path / "tests" / "outputs"
    outputs.mkdir(parents=True)
    _write_results_file(outputs / "results_20260101_000000.json")
    _write_results_file(outputs / "results_20260615_120000.json")
    _write_results_file(outputs / "results_20260301_000000.json")

    result = summary_module._resolve_default_file(tmp_path)

    assert result.name == "results_20260615_120000.json"


# ---------------------------------------------------------------------------
# Error paths
# ---------------------------------------------------------------------------


def test_summary_exits_on_missing_file(tmp_path: Path, monkeypatch):
    missing = tmp_path / "does_not_exist.json"
    captured = _patch_ui(monkeypatch)
    monkeypatch.setattr("sys.exit", lambda code=0: (_ for _ in ()).throw(SystemExit(code)))

    with pytest.raises(SystemExit) as excinfo:
        summary(file=missing)

    assert excinfo.value.code == 1
    assert _has_call(captured, "error", contains="File not found")


def test_summary_exits_on_invalid_json(tmp_path: Path, monkeypatch):
    file = tmp_path / "broken.json"
    file.write_text("not json")
    captured = _patch_ui(monkeypatch)
    monkeypatch.setattr("sys.exit", lambda code=0: (_ for _ in ()).throw(SystemExit(code)))

    with pytest.raises(SystemExit) as excinfo:
        summary(file=file)

    assert excinfo.value.code == 1
    assert _has_call(captured, "error", contains="Invalid JSON")


def test_summary_exits_when_results_key_missing(tmp_path: Path, monkeypatch):
    file = tmp_path / "no_results.json"
    file.write_text(json.dumps({"summary": {}}))
    captured = _patch_ui(monkeypatch)
    monkeypatch.setattr("sys.exit", lambda code=0: (_ for _ in ()).throw(SystemExit(code)))

    with pytest.raises(SystemExit) as excinfo:
        summary(file=file)

    assert excinfo.value.code == 1
    assert _has_call(captured, "error", contains="Missing or invalid 'results'")


def test_summary_exits_when_results_is_not_a_list(tmp_path: Path, monkeypatch):
    file = tmp_path / "wrong_type.json"
    file.write_text(json.dumps({"results": "not a list"}))
    _patch_ui(monkeypatch)
    monkeypatch.setattr("sys.exit", lambda code=0: (_ for _ in ()).throw(SystemExit(code)))

    with pytest.raises(SystemExit) as excinfo:
        summary(file=file)

    assert excinfo.value.code == 1


# ---------------------------------------------------------------------------
# --json flag
# ---------------------------------------------------------------------------


def test_summary_json_flag_emits_json_payload(tmp_path: Path, monkeypatch):
    file = tmp_path / "results.json"
    _write_results_file(
        file,
        results=[
            {
                "name": "orders_count",
                "model": "openai:gpt-4.1",
                "passed": True,
                "message": "match",
                "tokens": 100,
                "cost": 0.001,
                "duration_ms": 1000,
                "tool_call_count": 1,
            },
            {
                "name": "users_count",
                "model": "openai:gpt-4.1",
                "passed": False,
                "message": "values differ",
                "tokens": 200,
                "cost": 0.002,
                "duration_ms": 2000,
                "tool_call_count": 2,
            },
        ],
        include_by_model=False,
    )
    captured = _patch_ui(monkeypatch)

    summary(file=file, as_json=True)

    print_calls = _calls(captured, "print")
    assert print_calls, "expected a UI.print call from --json"
    payload = _parse_json_arg(print_calls[0][0][0])
    assert payload["summary"]["total"] == 2
    assert payload["summary"]["passed"] == 1
    assert payload["summary"]["failed"] == 1


def test_summary_json_flag_includes_per_model_breakdown(tmp_path: Path, monkeypatch):
    file = tmp_path / "results.json"
    _write_results_file(
        file,
        results=[
            {
                "name": "orders_count",
                "model": "openai:gpt-4.1",
                "passed": True,
                "message": "match",
                "tokens": 100,
                "cost": 0.001,
                "duration_ms": 1000,
                "tool_call_count": 1,
            },
            {
                "name": "users_count",
                "model": "anthropic:claude-sonnet-4-5",
                "passed": True,
                "message": "match",
                "tokens": 150,
                "cost": 0.0015,
                "duration_ms": 1500,
                "tool_call_count": 1,
            },
        ],
        include_by_model=False,
    )
    captured = _patch_ui(monkeypatch)

    summary(file=file, as_json=True)

    print_calls = _calls(captured, "print")
    payload = _parse_json_arg(print_calls[0][0][0])
    models = [m["model"] for m in payload["by_model"]]
    assert "openai:gpt-4.1" in models
    assert "anthropic:claude-sonnet-4-5" in models


def _parse_json_arg(arg: Any) -> dict:
    """Parse the JSON string the subcommand hands to UI.print under --json."""
    assert isinstance(arg, str)
    return json.loads(arg)


# ---------------------------------------------------------------------------
# Per-model backfill for older files
# ---------------------------------------------------------------------------


def test_summary_backfills_by_model_for_older_files(tmp_path: Path, monkeypatch):
    """A result file written before `by_model` existed should still get the table."""
    file = tmp_path / "old_results.json"
    _write_results_file(file, include_by_model=False)
    captured = _patch_ui(monkeypatch)

    summary(file=file)

    assert _calls(captured, "table"), "expected a UI.table call for the per-model breakdown"


# ---------------------------------------------------------------------------
# Direct helper tests
# ---------------------------------------------------------------------------


def test_render_overall_prints_a_one_liner(tmp_path: Path, monkeypatch):
    captured = _patch_ui(monkeypatch)

    summary_module._render_overall(
        {
            "total": 2,
            "passed": 1,
            "failed": 1,
            "total_cost": 0.005,
            "total_duration_s": 12.5,
            "total_tool_calls": 3,
        }
    )

    assert _has_call(captured, "success", contains="1 passed, 1 failed")


def test_render_by_model_skips_when_empty(tmp_path: Path, monkeypatch):
    captured = _patch_ui(monkeypatch)

    summary_module._render_by_model([])

    assert captured == []


def test_render_by_model_renders_a_table(tmp_path: Path, monkeypatch):
    from nao_core.commands.test.summary import ModelSummary

    captured = _patch_ui(monkeypatch)

    summary_module._render_by_model(
        [
            ModelSummary(
                model="openai:gpt-4.1",
                total=1,
                passed=1,
                failed=0,
                pass_rate=100.0,
                total_tokens=100,
                total_cost=0.001,
                total_duration_ms=1000,
                avg_duration_ms=1000.0,
                total_tool_calls=1,
                avg_tool_calls=1.0,
            )
        ]
    )

    table_calls = _calls(captured, "table")
    assert table_calls
    title = table_calls[0][1].get("title", "")
    assert title == "By model"
