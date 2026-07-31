"""List the test cases discovered in the tests/ folder, without running them."""

from __future__ import annotations

import sys
from pathlib import Path
from typing import Annotated

import pandas as pd
from cyclopts import Parameter

from nao_core.ui import UI

from .case import TESTS_FOLDER, discover_tests
from .runner import filter_test_cases

DEFAULT_PROMPT_LENGTH = 80


def _truncate(text: str, length: int) -> str:
    """Trim a string to at most `length` characters, adding an ellipsis when cut."""
    if length <= 0 or len(text) <= length:
        return text
    return text[:length].rstrip() + "..."


def list_tests(
    select: Annotated[
        str | None,
        Parameter(
            name=["-s", "--select"],
            help="Only list tests that match the given name, yaml stem, or subfolder. Comma-separated.",
        ),
    ] = None,
    prompt_length: Annotated[
        int,
        Parameter(
            name=["--prompt-length"],
            help="Maximum number of prompt characters to show per test. 0 hides the prompt column.",
        ),
    ] = DEFAULT_PROMPT_LENGTH,
):
    """List the test cases discovered in the tests/ folder.

    Walks the tests/ folder, loads each YAML, and prints a table of test name,
    file path, and a one-line prompt preview. No model calls, no backend
    connection. Use this to check that a new test YAML is picked up, or to
    confirm the --select filter before running the suite.

    Examples:
        nao test list
        nao test list -s contracts
        nao test list -s orders_count,users_count
        nao test list --prompt-length 0
    """
    project_path = Path.cwd()
    tests_dir = project_path / TESTS_FOLDER

    test_cases = discover_tests(project_path)

    try:
        test_cases = filter_test_cases(test_cases, select, tests_dir)
    except ValueError as e:
        UI.error(str(e))
        sys.exit(1)

    if not test_cases:
        UI.warn("No tests matched the filters.")
        return

    df = pd.DataFrame(
        [
            {
                "Name": tc.name,
                "File": str(tc.file_path.relative_to(project_path)),
                "Prompt": _truncate(tc.prompt, prompt_length) if prompt_length > 0 else "",
            }
            for tc in test_cases
        ]
    )

    title = f"Discovered {len(test_cases)} test case{'s' if len(test_cases) != 1 else ''}"
    UI.table(df, title=title)
