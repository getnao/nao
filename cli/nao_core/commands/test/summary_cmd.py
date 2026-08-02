"""Print a one-line summary and per-model breakdown of a saved nao test result file."""

from __future__ import annotations

import json
import sys
from dataclasses import asdict
from pathlib import Path
from typing import Annotated

import pandas as pd
from cyclopts import Parameter

from nao_core.ui import UI

from .case import TESTS_FOLDER
from .summary import (
    summarize,
    summarize_by_model,
    with_model_summaries,
)


def _resolve_default_file(project_path: Path) -> Path | None:
    """Return the most recent `results_*.json` in the project's outputs folder, or None."""
    outputs_dir = project_path / TESTS_FOLDER / "outputs"
    if not outputs_dir.exists() or not outputs_dir.is_dir():
        return None
    files = sorted(outputs_dir.glob("results_*.json"), reverse=True)
    return files[0] if files else None


def _load_results_file(path: Path) -> dict:
    """Read and validate a results JSON file. Exits with a clear error on any failure."""
    if not path.exists() or not path.is_file():
        UI.error(f"File not found: {path}")
        sys.exit(1)

    try:
        data = json.loads(path.read_text())
    except json.JSONDecodeError as e:
        UI.error(f"Invalid JSON in {path}: {e}")
        sys.exit(1)

    if not isinstance(data.get("results"), list):
        UI.error(f"Missing or invalid 'results' key in {path}")
        sys.exit(1)

    return with_model_summaries(data)


def _render_overall(overall: dict) -> None:
    """Print the one-line overall summary."""
    line = (
        f"  {overall['passed']} passed, {overall['failed']} failed, "
        f"{overall['total']} total, ${overall['total_cost']:.4f}, "
        f"{overall['total_duration_s']}s, {overall['total_tool_calls']} tool calls"
    )
    UI.success(line)


def _render_by_model(by_model: list) -> None:
    """Print the per-model table."""
    if not by_model:
        return
    df = pd.DataFrame([asdict(m) for m in by_model])
    UI.table(df, title="By model")


def summary(
    file: Annotated[
        Path | None,
        Parameter(
            name=["-f", "--file"],
            help="Path to a results JSON file. Defaults to the most recent file in tests/outputs/.",
        ),
    ] = None,
    as_json: Annotated[
        bool,
        Parameter(
            name=["--json"],
            help="Print the summary as JSON instead of a human-readable table.",
        ),
    ] = False,
):
    """Print a one-line summary and per-model breakdown of a saved nao test result file.

    Reuses the same summary helpers that the `server` subcommand and
    `save_results` use, so output is identical to what the browser UI shows
    for the same file. No model calls, no HTTP requests.

    Examples:
        nao test summary
        nao test summary tests/outputs/results_20260715_120000.json
        nao test summary --json
    """
    project_path = Path.cwd()

    if file is None:
        file = _resolve_default_file(project_path)
        if file is None:
            UI.error(f"No results_*.json files found in {project_path / TESTS_FOLDER / 'outputs'}")
            sys.exit(1)

    data = _load_results_file(file)
    results = data["results"]

    overall = summarize(results)
    by_model = summarize_by_model(results)

    if as_json:
        payload = {
            "file": str(file),
            "summary": overall,
            "by_model": [asdict(m) for m in by_model],
        }
        UI.print(json.dumps(payload, indent=2))
        return

    _render_overall(overall)
    _render_by_model(by_model)
