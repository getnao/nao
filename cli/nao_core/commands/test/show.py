"""Print the full prompt and SQL of a single test case, looked up by name or selector."""

from __future__ import annotations

import sys
from pathlib import Path
from typing import Annotated

from cyclopts import Parameter

from nao_core.ui import UI

from .case import TESTS_FOLDER, discover_tests
from .runner import filter_test_cases


def _render_test(test_case, project_path: Path, sql_only: bool, prompt_only: bool) -> None:
    """Print a single test case in the configured shape."""
    if sql_only:
        if test_case.sql:
            UI.print(test_case.sql)
        return
    if prompt_only:
        UI.print(test_case.prompt)
        return

    UI.print(f"  Test:    {test_case.name}")
    UI.print(f"  File:    {test_case.file_path.relative_to(project_path)}")
    UI.print(f"  Prompt:  {test_case.prompt}")
    UI.print("  SQL:")
    if test_case.sql:
        for line in test_case.sql.splitlines() or [""]:
            UI.print(f"    {line}")


def show(
    select: Annotated[
        str,
        Parameter(help="Test name, yaml stem, or subfolder. Comma-separated for multiple."),
    ],
    sql_only: Annotated[
        bool,
        Parameter(
            name=["--sql-only"],
            help="Print only the SQL field, no prompt or file path.",
        ),
    ] = False,
    prompt_only: Annotated[
        bool,
        Parameter(
            name=["--prompt-only"],
            help="Print only the prompt, no SQL or file path.",
        ),
    ] = False,
):
    """Print the full prompt and SQL of one or more test cases.

    The selector follows the same semantics as `nao test run -s` /
    `nao test list -s`: by name, by yaml stem, or by subfolder.
    Comma-separated selectors are accepted and each match is printed
    in order. No model calls, no network.

    Examples:
        nao test show orders_count
        nao test show orders_count,users_count
        nao test show contracts
        nao test show orders_count --sql-only
        nao test show orders_count --prompt-only
    """
    if sql_only and prompt_only:
        UI.error("--sql-only and --prompt-only are mutually exclusive")
        sys.exit(1)

    project_path = Path.cwd()
    tests_dir = project_path / TESTS_FOLDER

    test_cases = discover_tests(project_path)
    try:
        matches = filter_test_cases(test_cases, select, tests_dir)
    except ValueError as e:
        UI.error(str(e))
        sys.exit(1)

    if not matches:
        UI.error(f"No test cases matched selector: {select}")
        sys.exit(1)

    for test_case in matches:
        _render_test(test_case, project_path, sql_only, prompt_only)
        if not (sql_only or prompt_only) and test_case is not matches[-1]:
            UI.print("")
