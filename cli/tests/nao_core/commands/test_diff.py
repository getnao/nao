"""Tests for the `nao test diff` subcommand."""

from __future__ import annotations

import importlib.util
import json
from pathlib import Path

import pytest

from nao_core.commands.test.diff import (
    ADDED,
    FIX,
    REGRESSION,
    REMOVED,
    UNCHANGED,
    DiffRow,
    _filter_rows,
    _load_results,
    _render_summary,
    _summary_counts,
    compute_diff,
    diff,
)

# `nao_core.commands.test` is shadowed by the cyclopts App at the package
# level, so dotted imports of the submodule fail. Load the file directly
# to reach the `_resolve_last_two` helper.
_DIFF_FILE = Path(__file__).resolve().parents[3] / "nao_core" / "commands" / "test" / "diff.py"
_diff_spec = importlib.util.spec_from_file_location("nao_core.commands.test.diff", _DIFF_FILE)
assert _diff_spec is not None and _diff_spec.loader is not None
diff_module = importlib.util.module_from_spec(_diff_spec)
_diff_spec.loader.exec_module(diff_module)


def _row(name: str, model: str, passed: bool) -> dict:
    return {
        "name": name,
        "model": model,
        "passed": passed,
        "message": "match" if passed else "values differ",
        "tokens": 100,
        "cost": 0.001,
        "duration_ms": 1000,
        "tool_call_count": 1,
    }


def _write_results(path: Path, results: list[dict]) -> None:
    path.write_text(
        json.dumps(
            {
                "timestamp": "2026-07-30T00:00:00",
                "results": results,
                "summary": {
                    "total": len(results),
                    "passed": sum(1 for r in results if r["passed"]),
                    "failed": sum(1 for r in results if not r["passed"]),
                },
            }
        )
    )


def test_compute_diff_unchanged_when_status_matches():
    left = [_row("orders", "openai:gpt-4.1", True)]
    right = [_row("orders", "openai:gpt-4.1", True)]

    rows = compute_diff(left, right)

    assert rows == [DiffRow("orders", "openai:gpt-4.1", "PASS", "PASS", UNCHANGED)]


def test_compute_diff_regression_when_passing_becomes_failing():
    left = [_row("orders", "openai:gpt-4.1", True)]
    right = [_row("orders", "openai:gpt-4.1", False)]

    rows = compute_diff(left, right)

    assert rows[0].change == REGRESSION
    assert rows[0].before == "PASS"
    assert rows[0].after == "FAIL"


def test_compute_diff_fix_when_failing_becomes_passing():
    left = [_row("orders", "openai:gpt-4.1", False)]
    right = [_row("orders", "openai:gpt-4.1", True)]

    rows = compute_diff(left, right)

    assert rows[0].change == FIX
    assert rows[0].before == "FAIL"
    assert rows[0].after == "PASS"


def test_compute_diff_added_when_pair_only_in_right():
    left = []
    right = [_row("orders", "openai:gpt-4.1", True)]

    rows = compute_diff(left, right)

    assert rows[0].change == ADDED
    assert rows[0].before == "-"
    assert rows[0].after == "PASS"


def test_compute_diff_removed_when_pair_only_in_left():
    left = [_row("orders", "openai:gpt-4.1", True)]
    right = []

    rows = compute_diff(left, right)

    assert rows[0].change == REMOVED
    assert rows[0].before == "PASS"
    assert rows[0].after == "-"


def test_compute_diff_mixed_pairs():
    left = [
        _row("unchanged_test", "openai:gpt-4.1", True),
        _row("regression_test", "openai:gpt-4.1", True),
        _row("fix_test", "openai:gpt-4.1", False),
        _row("removed_test", "openai:gpt-4.1", True),
    ]
    right = [
        _row("unchanged_test", "openai:gpt-4.1", True),
        _row("regression_test", "openai:gpt-4.1", False),
        _row("fix_test", "openai:gpt-4.1", True),
        _row("added_test", "openai:gpt-4.1", True),
    ]

    rows = compute_diff(left, right)
    by_pair = {(r.test, r.model): r for r in rows}

    assert by_pair[("unchanged_test", "openai:gpt-4.1")].change == UNCHANGED
    assert by_pair[("regression_test", "openai:gpt-4.1")].change == REGRESSION
    assert by_pair[("fix_test", "openai:gpt-4.1")].change == FIX
    assert by_pair[("removed_test", "openai:gpt-4.1")].change == REMOVED
    assert by_pair[("added_test", "openai:gpt-4.1")].change == ADDED


def test_compute_diff_multiple_models_treated_as_distinct_pairs():
    left = [
        _row("orders", "openai:gpt-4.1", True),
        _row("orders", "anthropic:claude-sonnet-4-5", True),
    ]
    right = [
        _row("orders", "openai:gpt-4.1", False),
        _row("orders", "anthropic:claude-sonnet-4-5", True),
    ]

    rows = compute_diff(left, right)
    by_pair = {(r.test, r.model): r for r in rows}

    assert by_pair[("orders", "openai:gpt-4.1")].change == REGRESSION
    assert by_pair[("orders", "anthropic:claude-sonnet-4-5")].change == UNCHANGED


def test_compute_diff_empty_inputs_returns_empty():
    assert compute_diff([], []) == []


def test_compute_diff_pairs_are_sorted():
    left = [_row("zeta", "openai:gpt-4.1", True), _row("alpha", "openai:gpt-4.1", True)]
    right = [_row("zeta", "openai:gpt-4.1", True), _row("alpha", "openai:gpt-4.1", True)]

    rows = compute_diff(left, right)

    assert [r.test for r in rows] == ["alpha", "zeta"]


def test_load_results_reads_results_list(tmp_path: Path):
    file = tmp_path / "results.json"
    _write_results(file, [_row("orders", "openai:gpt-4.1", True)])

    results = _load_results(file)

    assert len(results) == 1
    assert results[0]["name"] == "orders"


def test_load_results_exits_on_missing_file(tmp_path: Path, monkeypatch):
    monkeypatch.setattr("sys.exit", lambda code=0: (_ for _ in ()).throw(SystemExit(code)))
    with pytest.raises(SystemExit):
        _load_results(tmp_path / "does_not_exist.json")


def test_load_results_exits_on_invalid_json(tmp_path: Path, monkeypatch):
    file = tmp_path / "broken.json"
    file.write_text("not json {")
    monkeypatch.setattr("sys.exit", lambda code=0: (_ for _ in ()).throw(SystemExit(code)))
    with pytest.raises(SystemExit):
        _load_results(file)


def test_load_results_exits_when_results_key_missing(tmp_path: Path, monkeypatch):
    file = tmp_path / "no_results.json"
    file.write_text(json.dumps({"summary": {}}))
    monkeypatch.setattr("sys.exit", lambda code=0: (_ for _ in ()).throw(SystemExit(code)))
    with pytest.raises(SystemExit):
        _load_results(file)


def test_load_results_exits_when_results_not_a_list(tmp_path: Path, monkeypatch):
    file = tmp_path / "wrong_type.json"
    file.write_text(json.dumps({"results": "not a list"}))
    monkeypatch.setattr("sys.exit", lambda code=0: (_ for _ in ()).throw(SystemExit(code)))
    with pytest.raises(SystemExit):
        _load_results(file)


def test_filter_rows_keeps_rows_matching_model():
    rows = [
        DiffRow("orders", "openai:gpt-4.1", "PASS", "PASS", UNCHANGED),
        DiffRow("orders", "anthropic:claude-sonnet-4-5", "PASS", "PASS", UNCHANGED),
    ]

    filtered = _filter_rows(rows, model="openai:gpt-4.1", test=None)

    assert [r.model for r in filtered] == ["openai:gpt-4.1"]


def test_filter_rows_keeps_rows_matching_test_name():
    rows = [
        DiffRow("orders", "openai:gpt-4.1", "PASS", "PASS", UNCHANGED),
        DiffRow("users", "openai:gpt-4.1", "PASS", "PASS", UNCHANGED),
    ]

    filtered = _filter_rows(rows, model=None, test="orders")

    assert [r.test for r in filtered] == ["orders"]


def test_filter_rows_combines_model_and_test():
    rows = [
        DiffRow("orders", "openai:gpt-4.1", "PASS", "PASS", UNCHANGED),
        DiffRow("orders", "anthropic:claude-sonnet-4-5", "PASS", "PASS", UNCHANGED),
        DiffRow("users", "openai:gpt-4.1", "PASS", "PASS", UNCHANGED),
    ]

    filtered = _filter_rows(rows, model="openai:gpt-4.1", test="orders")

    assert filtered == [DiffRow("orders", "openai:gpt-4.1", "PASS", "PASS", UNCHANGED)]


def test_filter_rows_no_filters_returns_all():
    rows = [DiffRow("orders", "openai:gpt-4.1", "PASS", "PASS", UNCHANGED)]
    assert _filter_rows(rows, model=None, test=None) == rows


def test_summary_counts_categorises_each_change_type():
    rows = [
        DiffRow("a", "m", "PASS", "PASS", UNCHANGED),
        DiffRow("b", "m", "PASS", "FAIL", REGRESSION),
        DiffRow("c", "m", "FAIL", "PASS", FIX),
        DiffRow("d", "m", "-", "PASS", ADDED),
        DiffRow("e", "m", "PASS", "-", REMOVED),
        DiffRow("f", "m", "PASS", "PASS", UNCHANGED),
    ]

    counts = _summary_counts(rows)

    assert counts == {REGRESSION: 1, FIX: 1, UNCHANGED: 2, ADDED: 1, REMOVED: 1}


def test_render_summary_singular_and_plural_labels():
    counts = {REGRESSION: 1, FIX: 2, UNCHANGED: 0, ADDED: 0, REMOVED: 0}
    rendered = _render_summary(counts)

    assert "1 regression, " in rendered
    assert "2 fixes, " in rendered


def test_render_summary_with_zero_counts():
    counts = {REGRESSION: 0, FIX: 0, UNCHANGED: 0, ADDED: 0, REMOVED: 0}
    rendered = _render_summary(counts)

    assert rendered == "0 regressions, 0 fixes, 0 unchanged, 0 added, 0 removed"


def _patch_ui(monkeypatch):
    """Capture UI output without rendering to the terminal."""
    captured: list[str] = []

    def fake_print(cls, msg: str = "") -> None:
        captured.append(str(msg))

    def fake_warn(cls, msg: str) -> None:
        captured.append(f"[warn] {msg}")

    def fake_error(cls, msg: str) -> None:
        captured.append(f"[error] {msg}")

    def fake_table(cls, df, title=None, sum_columns=None):  # noqa: ARG001
        captured.append(f"[table] {title} -> {df.to_dict('records')}")

    monkeypatch.setattr("nao_core.ui.UI.print", classmethod(fake_print))
    monkeypatch.setattr("nao_core.ui.UI.warn", classmethod(fake_warn))
    monkeypatch.setattr("nao_core.ui.UI.error", classmethod(fake_error))
    monkeypatch.setattr("nao_core.ui.UI.table", classmethod(fake_table))
    return captured


def test_diff_function_exits_zero_on_no_regressions(tmp_path: Path, monkeypatch):
    a = tmp_path / "a.json"
    b = tmp_path / "b.json"
    _write_results(a, [_row("orders", "openai:gpt-4.1", True)])
    _write_results(b, [_row("orders", "openai:gpt-4.1", True)])

    captured = _patch_ui(monkeypatch)
    monkeypatch.setattr("sys.exit", lambda code=0: (_ for _ in ()).throw(SystemExit(code)))

    diff(a, b)

    joined = "\n".join(captured)
    assert "1 unchanged" in joined


def test_diff_function_exits_one_on_regression(tmp_path: Path, monkeypatch):
    a = tmp_path / "a.json"
    b = tmp_path / "b.json"
    _write_results(a, [_row("orders", "openai:gpt-4.1", True)])
    _write_results(b, [_row("orders", "openai:gpt-4.1", False)])

    _patch_ui(monkeypatch)

    def fake_exit(code=0):
        raise SystemExit(code)

    monkeypatch.setattr("sys.exit", fake_exit)

    with pytest.raises(SystemExit) as excinfo:
        diff(a, b)

    assert excinfo.value.code == 1


def test_diff_function_no_fail_overrides_exit_code(tmp_path: Path, monkeypatch):
    a = tmp_path / "a.json"
    b = tmp_path / "b.json"
    _write_results(a, [_row("orders", "openai:gpt-4.1", True)])
    _write_results(b, [_row("orders", "openai:gpt-4.1", False)])

    _patch_ui(monkeypatch)

    def fake_exit(code=0):
        raise SystemExit(code)

    monkeypatch.setattr("sys.exit", fake_exit)

    diff(a, b, no_fail=True)


def test_diff_function_exits_on_missing_file(tmp_path: Path, monkeypatch):
    a = tmp_path / "a.json"
    b = tmp_path / "missing.json"
    _write_results(a, [_row("orders", "openai:gpt-4.1", True)])

    captured = _patch_ui(monkeypatch)

    def fake_exit(code=0):
        raise SystemExit(code)

    monkeypatch.setattr("sys.exit", fake_exit)

    with pytest.raises(SystemExit) as excinfo:
        diff(a, b)

    assert excinfo.value.code == 1
    assert any("File not found" in line for line in captured)


def test_diff_function_exits_on_invalid_json(tmp_path: Path, monkeypatch):
    a = tmp_path / "a.json"
    b = tmp_path / "b.json"
    _write_results(a, [_row("orders", "openai:gpt-4.1", True)])
    b.write_text("not json")

    captured = _patch_ui(monkeypatch)

    def fake_exit(code=0):
        raise SystemExit(code)

    monkeypatch.setattr("sys.exit", fake_exit)

    with pytest.raises(SystemExit) as excinfo:
        diff(a, b)

    assert excinfo.value.code == 1
    assert any("Invalid JSON" in line for line in captured)


def test_diff_function_quiet_skips_table(tmp_path: Path, monkeypatch):
    a = tmp_path / "a.json"
    b = tmp_path / "b.json"
    _write_results(a, [_row("orders", "openai:gpt-4.1", True)])
    _write_results(b, [_row("orders", "openai:gpt-4.1", True)])

    captured = _patch_ui(monkeypatch)

    diff(a, b, quiet=True)

    assert not any("[table]" in line for line in captured)
    assert any("1 unchanged" in line for line in captured)


def test_diff_function_model_filter_narrows_table(tmp_path: Path, monkeypatch):
    a = tmp_path / "a.json"
    b = tmp_path / "b.json"
    _write_results(
        a,
        [
            _row("orders", "openai:gpt-4.1", True),
            _row("orders", "anthropic:claude-sonnet-4-5", True),
        ],
    )
    _write_results(
        b,
        [
            _row("orders", "openai:gpt-4.1", False),
            _row("orders", "anthropic:claude-sonnet-4-5", True),
        ],
    )

    captured = _patch_ui(monkeypatch)
    diff(a, b, model="openai:gpt-4.1", no_fail=True)

    joined = "\n".join(captured)
    assert "1 regression" in joined
    assert "0 fixes" in joined
    assert "0 unchanged" in joined
    assert "[table]" in joined


def test_diff_function_test_filter_narrows_table(tmp_path: Path, monkeypatch):
    a = tmp_path / "a.json"
    b = tmp_path / "b.json"
    _write_results(
        a,
        [
            _row("orders", "openai:gpt-4.1", True),
            _row("users", "openai:gpt-4.1", True),
        ],
    )
    _write_results(
        b,
        [
            _row("orders", "openai:gpt-4.1", False),
            _row("users", "openai:gpt-4.1", True),
        ],
    )

    captured = _patch_ui(monkeypatch)
    diff(a, b, test="orders", no_fail=True)

    joined = "\n".join(captured)
    assert "1 regression" in joined


def test_diff_function_warns_when_filter_excludes_everything(tmp_path: Path, monkeypatch):
    a = tmp_path / "a.json"
    b = tmp_path / "b.json"
    _write_results(a, [_row("orders", "openai:gpt-4.1", True)])
    _write_results(b, [_row("orders", "openai:gpt-4.1", True)])

    captured = _patch_ui(monkeypatch)
    monkeypatch.setattr("sys.exit", lambda code=0: (_ for _ in ()).throw(SystemExit(code)))

    diff(a, b, model="anthropic:claude-sonnet-4-5")

    assert any("No matching rows" in line for line in captured)


# ---------------------------------------------------------------------------
# --last flag: file resolution
# ---------------------------------------------------------------------------


def test_resolve_last_two_returns_none_when_outputs_dir_missing(tmp_path: Path):
    assert diff_module._resolve_last_two(tmp_path) is None


def test_resolve_last_two_returns_none_with_fewer_than_two_files(tmp_path: Path):
    (tmp_path / "tests" / "outputs").mkdir(parents=True)
    assert diff_module._resolve_last_two(tmp_path) is None
    _write_results(tmp_path / "tests" / "outputs" / "results_20260801_000000.json", [_row("x", "openai:gpt-4.1", True)])
    assert diff_module._resolve_last_two(tmp_path) is None


def test_resolve_last_two_picks_two_most_recent(tmp_path: Path):
    outputs = tmp_path / "tests" / "outputs"
    outputs.mkdir(parents=True)
    _write_results(outputs / "results_20260101_000000.json", [_row("a", "openai:gpt-4.1", True)])
    _write_results(outputs / "results_20260615_120000.json", [_row("b", "openai:gpt-4.1", True)])
    _write_results(outputs / "results_20260301_000000.json", [_row("c", "openai:gpt-4.1", True)])

    resolved = diff_module._resolve_last_two(tmp_path)

    assert resolved is not None
    assert [p.name for p in resolved] == ["results_20260301_000000.json", "results_20260615_120000.json"]


def test_diff_last_picks_two_most_recent(tmp_path: Path, monkeypatch):
    outputs = tmp_path / "tests" / "outputs"
    outputs.mkdir(parents=True)
    _write_results(
        outputs / "results_20260601_000000.json",
        [_row("orders", "openai:gpt-4.1", True)],
    )
    _write_results(
        outputs / "results_20260615_120000.json",
        [_row("orders", "openai:gpt-4.1", False)],
    )
    monkeypatch.chdir(tmp_path)
    captured = _patch_ui(monkeypatch)

    diff(last=True, no_fail=True)

    assert any("1 regression" in line for line in captured)


def test_diff_last_errors_when_outputs_dir_missing(tmp_path: Path, monkeypatch):
    monkeypatch.chdir(tmp_path)
    captured = _patch_ui(monkeypatch)
    monkeypatch.setattr("sys.exit", lambda code=0: (_ for _ in ()).throw(SystemExit(code)))

    with pytest.raises(SystemExit) as excinfo:
        diff(last=True)

    assert excinfo.value.code == 1
    assert any("at least two results" in line for line in captured)


def test_diff_last_errors_when_only_one_file_exists(tmp_path: Path, monkeypatch):
    outputs = tmp_path / "tests" / "outputs"
    outputs.mkdir(parents=True)
    _write_results(
        outputs / "results_20260615_120000.json",
        [_row("orders", "openai:gpt-4.1", True)],
    )
    monkeypatch.chdir(tmp_path)
    captured = _patch_ui(monkeypatch)
    monkeypatch.setattr("sys.exit", lambda code=0: (_ for _ in ()).throw(SystemExit(code)))

    with pytest.raises(SystemExit) as excinfo:
        diff(last=True)

    assert excinfo.value.code == 1
    assert any("at least two results" in line for line in captured)


def test_diff_last_rejects_explicit_file_args(tmp_path: Path, monkeypatch):
    a = tmp_path / "a.json"
    b = tmp_path / "b.json"
    _write_results(a, [_row("x", "openai:gpt-4.1", True)])
    _write_results(b, [_row("x", "openai:gpt-4.1", True)])
    captured = _patch_ui(monkeypatch)
    monkeypatch.setattr("sys.exit", lambda code=0: (_ for _ in ()).throw(SystemExit(code)))

    with pytest.raises(SystemExit) as excinfo:
        diff(file1=a, file2=b, last=True)

    assert excinfo.value.code == 1
    assert any("mutually exclusive" in line for line in captured)


def test_diff_with_no_args_errors(tmp_path: Path, monkeypatch):
    monkeypatch.chdir(tmp_path)
    captured = _patch_ui(monkeypatch)
    monkeypatch.setattr("sys.exit", lambda code=0: (_ for _ in ()).throw(SystemExit(code)))

    with pytest.raises(SystemExit) as excinfo:
        diff()

    assert excinfo.value.code == 1
    assert any("two file paths" in line for line in captured)


def test_diff_with_only_one_file_errors(tmp_path: Path, monkeypatch):
    a = tmp_path / "a.json"
    _write_results(a, [_row("x", "openai:gpt-4.1", True)])
    captured = _patch_ui(monkeypatch)
    monkeypatch.setattr("sys.exit", lambda code=0: (_ for _ in ()).throw(SystemExit(code)))

    with pytest.raises(SystemExit) as excinfo:
        diff(file1=a)

    assert excinfo.value.code == 1
    assert any("two file paths" in line for line in captured)
