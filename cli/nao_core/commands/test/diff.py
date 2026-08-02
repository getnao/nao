"""Diff two nao test result files to surface regressions, fixes, and additions."""

from __future__ import annotations

import json
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Annotated, Any

import pandas as pd
from cyclopts import Parameter

from nao_core.ui import UI

from .case import TESTS_FOLDER

# Change labels for the (test, model) pair between two result files.
UNCHANGED = "unchanged"
REGRESSION = "regression"
FIX = "fix"
ADDED = "added"
REMOVED = "removed"


@dataclass(frozen=True)
class DiffRow:
    """One row in the diff table."""

    test: str
    model: str
    before: str  # "PASS" | "FAIL" | "-"
    after: str  # "PASS" | "FAIL" | "-"
    change: str  # one of UNCHANGED/REGRESSION/FIX/ADDED/REMOVED


def _load_results(path: Path) -> list[dict[str, Any]]:
    """Read a results JSON file and return its `results` list.

    Exits with a clear error if the file is missing, unreadable, not JSON,
    or does not contain a `results` list.
    """
    if not path.exists() or not path.is_file():
        UI.error(f"File not found: {path}")
        sys.exit(1)

    try:
        data = json.loads(path.read_text())
    except json.JSONDecodeError as e:
        UI.error(f"Invalid JSON in {path}: {e}")
        sys.exit(1)

    results = data.get("results")
    if not isinstance(results, list):
        UI.error(f"Missing or invalid 'results' key in {path}")
        sys.exit(1)

    return results


def _index_by_pair(results: list[dict[str, Any]]) -> dict[tuple[str, str], dict[str, Any]]:
    """Index results by the (name, model) pair key."""
    return {(r["name"], r["model"]): r for r in results}


def _status(result: dict[str, Any] | None) -> str:
    """Render a single side of a pair as PASS/FAIL/-."""
    if result is None:
        return "-"
    return "PASS" if result.get("passed") else "FAIL"


def compute_diff(
    left: list[dict[str, Any]],
    right: list[dict[str, Any]],
) -> list[DiffRow]:
    """Compute the diff between two `results` lists.

    Pair key is (name, model). The change label is one of:
    - ADDED: pair only in `right`
    - REMOVED: pair only in `left`
    - REGRESSION: passed in `left`, failed in `right`
    - FIX: failed in `left`, passed in `right`
    - UNCHANGED: same outcome on both sides
    """
    left_idx = _index_by_pair(left)
    right_idx = _index_by_pair(right)
    pairs = sorted(set(left_idx) | set(right_idx))

    rows: list[DiffRow] = []
    for key in pairs:
        test, model = key
        left_row = left_idx.get(key)
        right_row = right_idx.get(key)
        if left_row is None:
            change = ADDED
        elif right_row is None:
            change = REMOVED
        elif left_row.get("passed") == right_row.get("passed"):
            change = UNCHANGED
        elif right_row.get("passed"):
            change = FIX
        else:
            change = REGRESSION
        rows.append(DiffRow(test=test, model=model, before=_status(left_row), after=_status(right_row), change=change))
    return rows


def _filter_rows(
    rows: list[DiffRow],
    model: str | None,
    test: str | None,
) -> list[DiffRow]:
    """Apply --model and --test filters to the row list."""
    if model:
        rows = [r for r in rows if r.model == model]
    if test:
        rows = [r for r in rows if r.test == test]
    return rows


def _summary_counts(rows: list[DiffRow]) -> dict[str, int]:
    """Count rows by change label."""
    counts = {REGRESSION: 0, FIX: 0, UNCHANGED: 0, ADDED: 0, REMOVED: 0}
    for r in rows:
        counts[r.change] += 1
    return counts


def _render_summary(counts: dict[str, int]) -> str:
    """Render the one-line summary."""
    parts = [
        f"{counts[REGRESSION]} regression{'s' if counts[REGRESSION] != 1 else ''}",
        f"{counts[FIX]} fix{'es' if counts[FIX] != 1 else ''}",
        f"{counts[UNCHANGED]} unchanged",
        f"{counts[ADDED]} added",
        f"{counts[REMOVED]} removed",
    ]
    return ", ".join(parts)


def _resolve_last_two(project_path: Path) -> list[Path] | None:
    """Return the two most recent `results_*.json` files, or None if there are fewer than two.

    Names sort chronologically because `save_results` uses a `%Y%m%d_%H%M%S` prefix.
    """
    outputs_dir = project_path / TESTS_FOLDER / "outputs"
    if not outputs_dir.exists():
        return None
    files = sorted(outputs_dir.glob("results_*.json"))
    return files[-2:] if len(files) >= 2 else None


def diff(
    file1: Annotated[
        Path | None,
        Parameter(help="Path to the first results JSON file (before). Mutually exclusive with --last."),
    ] = None,
    file2: Annotated[
        Path | None,
        Parameter(help="Path to the second results JSON file (after). Mutually exclusive with --last."),
    ] = None,
    last: Annotated[
        bool,
        Parameter(
            name=["--last"],
            help="Use the two most recent results_*.json files in tests/outputs/ instead of explicit paths.",
        ),
    ] = False,
    model: Annotated[
        str | None,
        Parameter(
            name=["--model"],
            help="Only show rows for this model (e.g. openai:gpt-4.1).",
        ),
    ] = None,
    test: Annotated[
        str | None,
        Parameter(
            name=["--test"],
            help="Only show rows for this test name.",
        ),
    ] = None,
    quiet: Annotated[
        bool,
        Parameter(
            name=["--quiet", "-q"],
            help="Only print the summary line, no per-row table.",
        ),
    ] = False,
    no_fail: Annotated[
        bool,
        Parameter(
            name=["--no-fail"],
            help="Print the report but always exit 0, even on regressions.",
        ),
    ] = False,
):
    """Diff two nao test result files to surface regressions, fixes, and additions.

    Pairs are matched on (test name, model). Use this to track what changed
    between two runs of `nao test` -- a passing→failing pair is a regression,
    a failing→passing pair is a fix, and a pair only in one file is added or
    removed. Pass two file paths, or pass `--last` to use the two most recent
    results_*.json files in tests/outputs/.

    Examples:
        nao test diff tests/outputs/results_before.json tests/outputs/results_after.json
        nao test diff a.json b.json --model openai:gpt-4.1
        nao test diff a.json b.json --test orders_count
        nao test diff a.json b.json --quiet
        nao test diff a.json b.json --no-fail
        nao test diff --last
        nao test diff --last --quiet
    """
    if last and (file1 or file2):
        UI.error("--last is mutually exclusive with the two file path arguments")
        sys.exit(1)
    if not last and not (file1 and file2):
        UI.error("Provide two file paths, or pass --last to use the two most recent results files")
        sys.exit(1)
    if last:
        resolved = _resolve_last_two(Path.cwd())
        if resolved is None:
            UI.error("Need at least two results_*.json files in tests/outputs/ for --last")
            sys.exit(1)
        file1, file2 = resolved

    assert file1 is not None and file2 is not None
    left = _load_results(file1)
    right = _load_results(file2)

    rows = compute_diff(left, right)
    rows = _filter_rows(rows, model=model, test=test)
    counts = _summary_counts(rows)

    if not quiet:
        if rows:
            df = pd.DataFrame(
                [
                    {
                        "Test": r.test,
                        "Model": r.model,
                        "Before": r.before,
                        "After": r.after,
                        "Change": r.change,
                    }
                    for r in rows
                ]
            )
            UI.table(df, title=f"Diff: {file1.name} -> {file2.name}")
        else:
            UI.warn("No matching rows after applying filters.")

    UI.print(f"\nSummary: {_render_summary(counts)}")

    if counts[REGRESSION] > 0 and not no_fail:
        sys.exit(1)
