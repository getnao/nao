import json
import os
import sys
from concurrent.futures import ThreadPoolExecutor, as_completed
from dataclasses import asdict, dataclass
from datetime import datetime
from pathlib import Path
from typing import Annotated, cast
from urllib.parse import urlparse

import numpy as np
import pandas as pd
from cyclopts import Parameter

from nao_core import native
from nao_core.config import NaoConfig, resolve_project_path
from nao_core.config.llm import ModelCosts
from nao_core.config.test import ComparisonConfig, TestConfig
from nao_core.ui import UI

from .case import TESTS_FOLDER, TestCase, discover_tests
from .client import BACKEND_URL, AgentClientError, VerificationResult, get_client
from .compare import normalize_dataframe_numbers
from .summary import ModelSummary, summarize, summarize_by_model, summarize_pass_metrics


@dataclass
class ModelConfig:
    """Model configuration for testing."""

    provider: str
    model_id: str

    @classmethod
    def parse(cls, model_str: str) -> "ModelConfig":
        """Parse 'provider:model_id' string."""
        if ":" not in model_str:
            raise ValueError(f"Invalid model format: {model_str}. Use 'provider:model_id'")
        provider, model_id = model_str.split(":", 1)
        return cls(provider=provider, model_id=model_id)

    def __str__(self) -> str:
        return f"{self.provider}:{self.model_id}"


@dataclass
class TestRunDetails:
    """Detailed information about a test run for debugging."""

    response_text: str | None = None
    actual_data: list[dict] | None = None
    expected_data: list[dict] | None = None
    comparison: str | None = None
    tool_calls: list[dict] | None = None
    reference_sql: str | None = None
    verification_sql: str | None = None


@dataclass
class TestRunResult:
    """Result of a single test run."""

    name: str
    model: str
    passed: bool
    message: str
    tokens: int | None = None
    cost: float | None = None
    duration_ms: int | None = None
    tool_call_count: int | None = None
    error: str | None = None
    details: TestRunDetails | None = None
    attempt: int | None = None


def check_dataframe(
    verification: VerificationResult, rtol: float = 1e-5, atol: float = 1e-8, decimals: int = 2
) -> tuple[bool, str, str | None]:
    """Check if actual data matches expected. Returns (passed, message, comparison).

    Args:
        verification: The verification result containing actual and expected data.
        rtol: Relative tolerance for float comparison.
        atol: Absolute tolerance for float comparison.
        decimals: Decimals kept when rounding float values before comparing.
    """
    if verification.data is None:
        return False, verification.error or "no data returned", None

    actual = pd.DataFrame(verification.data)
    expected = pd.DataFrame(verification.expectedData)
    cols = verification.expectedColumns

    if actual.empty and expected.empty:
        return True, "both empty", None
    if actual.empty:
        return False, "actual is empty", None
    if expected.empty:
        return False, "expected is empty", None

    # Filter to expected columns
    if cols:
        missing = set(cols) - set(actual.columns)
        if missing:
            return False, f"missing columns: {missing}", None
        actual = cast(pd.DataFrame, actual[cols])
        expected = cast(pd.DataFrame, expected[cols])

    if len(actual) != len(expected):
        return False, f"row count: {len(actual)} vs {len(expected)}", None

    actual = normalize_dataframe_numbers(actual)
    expected = normalize_dataframe_numbers(expected)

    def round_numeric(df: pd.DataFrame, decimals: int) -> pd.DataFrame:
        """Round float-like columns to the given number of decimals for stable comparisons."""
        for col in df.columns:
            series = df[col]
            if pd.api.types.is_float_dtype(series) or (
                pd.api.types.is_numeric_dtype(series) and not pd.api.types.is_integer_dtype(series)
            ):
                df[col] = series.round(decimals)
        return df

    # Normalize: reset index, infer types, and sort columns consistently
    actual = pd.DataFrame(actual.reset_index(drop=True).infer_objects(copy=False))
    expected = pd.DataFrame(expected.reset_index(drop=True).infer_objects(copy=False))

    # Sort columns alphabetically for consistent comparison
    sorted_cols = sorted(actual.columns)
    actual = cast(pd.DataFrame, actual[sorted_cols])
    expected = cast(pd.DataFrame, expected[sorted_cols])

    # Round float-like values to avoid noisy diffs
    actual = round_numeric(actual, decimals=decimals)
    expected = round_numeric(expected, decimals=decimals)

    # Sort rows by all columns (in alphabetic order) to ignore row order
    actual = actual.sort_values(by=sorted_cols).reset_index(drop=True)
    expected = expected.sort_values(by=sorted_cols).reset_index(drop=True)

    if actual.equals(expected):
        return True, "match", None

    # Try approximate comparison for numeric columns
    try:
        is_close = True
        for col in actual.columns:
            actual_series = cast(pd.Series, actual[col])
            expected_series = cast(pd.Series, expected[col])

            # Check if both columns are numeric
            if pd.api.types.is_numeric_dtype(actual_series) and pd.api.types.is_numeric_dtype(expected_series):
                # Use numpy's isclose for float comparison
                if not np.allclose(
                    actual_series.to_numpy(),
                    expected_series.to_numpy(),
                    rtol=rtol,
                    atol=atol,
                    equal_nan=True,
                ):
                    is_close = False
                    break
            else:
                # For non-numeric columns, require exact equality
                if not actual_series.equals(expected_series):
                    is_close = False
                    break

        if is_close:
            return True, "match (approximate)", None
    except Exception:
        pass  # Fall through to show diff

    # Build comparison string
    comparison: str | None = None
    try:
        diff = actual.compare(expected, result_names=("actual", "expected"))
        comparison = diff.to_string()
        UI.print(f"[dim]{comparison}[/dim]")
    except Exception:
        comparison = f"Actual:\n{actual.to_string()}\n\nExpected:\n{expected.to_string()}"
        UI.print(f"[dim]  Actual:\n{actual.to_string()}[/dim]")
        UI.print(f"[dim]  Expected:\n{expected.to_string()}[/dim]")

    return False, "values differ", comparison


def run_test(
    test_case: TestCase,
    model: ModelConfig,
    email: str | None = None,
    password: str | None = None,
    costs: ModelCosts | None = None,
    comparison: ComparisonConfig | None = None,
) -> TestRunResult:
    """Run a single test case with a specific model. Returns TestRunResult."""
    UI.print(f"[bold]Running:[/bold] {test_case.name} [dim]({model})[/dim]")
    UI.print(f"[dim]  Prompt: {test_case.prompt}[/dim]")

    client = get_client(email=email, password=password)

    try:
        result = client.run_test(test_case, provider=model.provider, model_id=model.model_id, costs=costs)

        if result.text:
            UI.print(f"[dim]  Response: {result.text[:200]}...[/dim]")

        tool_call_count = len(result.tool_calls) if result.tool_calls else 0
        if result.tool_calls:
            tools = [tc.get("toolName") for tc in result.tool_calls]
            UI.print(f"[dim]  Tool calls: {tool_call_count} {tools}[/dim]")

        UI.print(f"[dim]  Tokens: {result.usage.totalTokens}[/dim]")
        UI.print(f"[dim]  Cost: ${result.cost.totalCost}[/dim]")
        UI.print(f"[dim]  Time: {result.duration_ms}ms[/dim]")

        if result.verification:
            tolerances = comparison or ComparisonConfig()
            if result.verification.sql:
                UI.print(f"[dim]  Verification SQL: {result.verification.sql}[/dim]")
            passed, msg, diff = check_dataframe(
                result.verification,
                rtol=tolerances.rtol,
                atol=tolerances.atol,
                decimals=tolerances.decimals,
            )
            status = "[green]✓[/green]" if passed else "[red]✗[/red]"
            UI.print(f"  {status} {msg}")
            return TestRunResult(
                name=test_case.name,
                model=str(model),
                passed=passed,
                message=msg,
                tokens=result.usage.totalTokens,
                cost=result.cost.totalCost,
                duration_ms=result.duration_ms,
                tool_call_count=tool_call_count,
                details=TestRunDetails(
                    response_text=result.text,
                    actual_data=result.verification.data,
                    expected_data=result.verification.expectedData,
                    comparison=diff,
                    tool_calls=result.tool_calls,
                    reference_sql=test_case.sql,
                    verification_sql=result.verification.sql,
                ),
            )

        UI.print("[yellow]  ⚠ no verification data[/yellow]")
        return TestRunResult(
            name=test_case.name,
            model=str(model),
            passed=True,
            message="no verification",
            tokens=result.usage.totalTokens,
            cost=result.cost.totalCost,
            duration_ms=result.duration_ms,
            tool_call_count=tool_call_count,
            details=TestRunDetails(
                response_text=result.text,
                tool_calls=result.tool_calls,
                reference_sql=test_case.sql,
            ),
        )

    except AgentClientError as e:
        UI.error(str(e))
        return TestRunResult(
            name=test_case.name,
            model=str(model),
            passed=False,
            message="error",
            error=str(e),
            details=TestRunDetails(reference_sql=test_case.sql),
        )


def resolve_model_costs(config: NaoConfig, model: ModelConfig) -> ModelCosts | None:
    """Look up the configured price of the model under test."""
    if not config.llm:
        return None

    return config.llm.costs(model.provider, model.model_id)


def save_results(results: list[TestRunResult], output_dir: Path) -> Path:
    """Save test results to JSON file."""
    output_dir.mkdir(parents=True, exist_ok=True)
    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    output_file = output_dir / f"results_{timestamp}.json"

    runs = [asdict(r) for r in results]
    data = {
        "timestamp": datetime.now().isoformat(),
        "results": runs,
        "summary": summarize(runs),
        "by_model": [asdict(s) for s in summarize_by_model(runs)],
        "pass_metrics": summarize_pass_metrics(runs),
    }

    output_file.write_text(json.dumps(data, indent=2))
    return output_file


def print_run_table(results: list[TestRunResult]) -> None:
    """Print one row per run/attempt."""
    df = pd.DataFrame(
        [
            {
                "Test": r.name,
                "Model": r.model,
                "Status": status_icon(r.passed),
                "Message": r.message,
                "Tokens": r.tokens or 0,
                "Cost": r.cost or 0,
                "Time (s)": round((r.duration_ms or 0) / 1000, 1),
                "Tools": r.tool_call_count or 0,
            }
            for r in results
        ]
    )

    UI.table(df, title="Test Results", sum_columns={"Tokens": "", "Cost": "$", "Time (s)": "", "Tools": ""})


def print_pass_metrics_table(pass_metrics: dict, k_count: int) -> None:
    """Print per-test-case pass@k metrics. Extra columns only when k > 1."""
    rows = []
    for item in pass_metrics.get("by_test", []):
        row = {
            "Test": item["name"],
            "Model": item["model"],
            "pass@1": format_pass_fraction(float(item["pass_at_1"])),
        }
        if k_count > 1:
            row[f"pass@{k_count}"] = format_pass_fraction(float(item["pass_at_k"]))
            row[f"pass^{k_count}"] = format_pass_fraction(float(item["pass_hat_k"]))
        rows.append(row)
    if rows:
        UI.table(pd.DataFrame(rows), title="Pass Metrics by Test")


def print_model_table(summaries: list[ModelSummary], k_count: int = 1) -> None:
    """Print one row per model, ranked from best to worst pass rate.

    pass@k / pass^k columns are added only when k > 1 so default output stays lean.
    """
    rows = []
    for s in summaries:
        row: dict[str, object] = {
            "Model": column_label(s.model),
            "Pass Rate": format_pass_rate(s.pass_rate),
            "Passed": f"{s.passed}/{s.total}",
            "Tokens": s.total_tokens,
            "Cost": s.total_cost,
            "Avg Time (s)": round(s.avg_duration_ms / 1000, 1),
            "Avg Tools": s.avg_tool_calls,
        }
        if k_count > 1:
            row["pass@1"] = format_pass_fraction(s.pass_at_1)
            row[f"pass@{k_count}"] = format_pass_fraction(s.pass_at_k)
            row[f"pass^{k_count}"] = format_pass_fraction(s.pass_hat_k)
        rows.append(row)

    UI.table(
        pd.DataFrame(rows),
        title="Performance by Model",
        sum_columns={"Tokens": "", "Cost": "$"},
        fixed_columns={"Model"},
    )


def print_model_matrix(results: list[TestRunResult]) -> None:
    """Print a test × model grid to show which model passes which test."""
    models = list(dict.fromkeys(r.model for r in results))
    statuses: dict[tuple[str, str], list[str]] = {}
    for result in results:
        statuses.setdefault((result.name, result.model), []).append(status_icon(result.passed))

    rows = [
        {"Test": name}
        | {column_label(model): " ".join(statuses.get((name, model), ["[dim]-[/dim]"])) for model in models}
        for name in dict.fromkeys(r.name for r in results)
    ]

    UI.table(pd.DataFrame(rows), title="Pass / Fail by Test and Model")


def column_label(model: str) -> str:
    """Stack the provider above the model id to keep matrix columns narrow."""
    return model.replace(":", "\n")


def status_icon(passed: bool) -> str:
    """Render a pass/fail marker for terminal tables."""
    return "[green]✓[/green]" if passed else "[red]✗[/red]"


def format_pass_rate(pass_rate: float) -> str:
    """Colour a 0-100 pass rate from green (all passing) to red (mostly failing)."""
    color = "green" if pass_rate == 100 else "red" if pass_rate < 50 else "yellow"
    return f"[{color}]{pass_rate}%[/{color}]"


def format_pass_fraction(rate: float) -> str:
    """Colour a 0-1 pass metric (pass@k / pass^k) for terminal tables."""
    pct = round(rate * 100, 1)
    color = "green" if pct == 100 else "red" if pct < 50 else "yellow"
    return f"[{color}]{pct}%[/{color}]"


def filter_test_cases(
    test_cases: list[TestCase],
    selected_tests: str | None,
    tests_dir: Path | None = None,
) -> list[TestCase]:
    """Filter test cases to the selected tests, if provided.

    Each comma-separated selection matches either a single test (by ``name`` or
    file stem) or, when ``tests_dir`` is given, every test under a subfolder of
    tests/ (e.g. ``contracts`` selects all tests in tests/contracts/).
    """
    if not selected_tests:
        return test_cases

    selections = [s.strip() for s in selected_tests.split(",") if s.strip()]
    if not selections:
        available = ", ".join(tc.name for tc in test_cases)
        raise ValueError(f"Test not found: {selected_tests}. Available tests: {available}")

    selected: list[TestCase] = []
    seen: set[Path] = set()
    for selection in selections:
        folder_matches: list[TestCase] = []
        if tests_dir is not None:
            for tc in test_cases:
                try:
                    parts = tc.file_path.relative_to(tests_dir).parent.parts
                except ValueError:
                    continue
                if selection in parts:
                    folder_matches.append(tc)
        name_matches = [tc for tc in test_cases if tc.name == selection or tc.file_path.stem == selection]
        matches = folder_matches or name_matches
        if not matches:
            available = ", ".join(tc.name for tc in test_cases)
            raise ValueError(f"Test not found: {selection}. Available tests: {available}")
        if not folder_matches and len(matches) > 1:
            names = ", ".join(f"{tc.name} ({tc.file_path.name})" for tc in matches)
            raise ValueError(f"Multiple tests match '{selection}': {names}")
        for match in matches:
            if match.file_path in seen:
                continue
            seen.add(match.file_path)
            selected.append(match)

    return selected


def ensure_verification_engine(test_cases: list[TestCase]) -> None:
    """Fetch the DuckDB engine the backend verifies answers with, if it needs it.

    Only tests that declare reference SQL are verified, and a remote backend brings
    its own engine, so neither case is worth a download.
    """
    if not any(test_case.sql for test_case in test_cases):
        return

    if urlparse(BACKEND_URL).hostname not in ("localhost", "127.0.0.1", "::1"):
        return

    native.ensure_group(native.server_bin_dir(), "duckdb")


def test(
    models: Annotated[
        list[str] | None,
        Parameter(
            name=["-m", "--model"],
            help="Models to test (format: provider:model_id). Can be specified multiple times. Overrides test.models.",
        ),
    ] = None,
    threads: Annotated[
        int | None,
        Parameter(
            name=["-t", "--threads"],
            help="Number of parallel threads for running tests. Overrides test.threads.",
        ),
    ] = None,
    k: Annotated[
        int | None,
        Parameter(
            name=["-k", "--k"],
            help="Number of times to run each test case, used to compute pass@k and pass^k. Overrides test.k.",
        ),
    ] = None,
    select: Annotated[
        str | None,
        Parameter(
            name=["-s", "--select"],
            help="Run only selected tests by name, yaml stem, or subfolder. Comma-separated (e.g. 'contracts' or '12,13,14').",
        ),
    ] = None,
    username: Annotated[
        str | None,
        Parameter(
            name=["-u", "--username"],
            help="Email for authentication. Falls back to NAO_USERNAME env var.",
        ),
    ] = None,
    password: Annotated[
        str | None,
        Parameter(
            name=["--password"],
            help="Password for authentication. Falls back to NAO_PASSWORD env var.",
        ),
    ] = None,
):
    """Run tests from the tests/ folder.

    Defaults come from the `test` block of nao_config.yaml, and every flag below overrides them.

    Examples:
        nao test
        nao test -m openai:gpt-4.1
        nao test -m openai:gpt-4.1 -m anthropic:claude-sonnet-4-20250514
        nao test --threads 4
        nao test --k 5
        nao test -s test_name
        nao test -s 12,13,14
        nao test -u user@example.com --password secret
    """
    email = username or os.environ.get("NAO_USERNAME")
    pwd = password or os.environ.get("NAO_PASSWORD")

    UI.info("\n🧪 Running nao tests...\n")

    config = NaoConfig.try_load(resolve_project_path(), exit_on_error=True)
    assert config is not None

    test_config = config.test or TestConfig()
    thread_count = threads if threads is not None else test_config.threads
    k_count = k if k is not None else test_config.k

    if k_count < 1:
        UI.error(f"k must be >= 1, got {k_count}")
        return

    try:
        model_configs = [ModelConfig.parse(m) for m in models or test_config.models]
    except ValueError as e:
        UI.error(str(e))
        return

    project_path = Path.cwd()
    tests_dir = project_path / TESTS_FOLDER
    UI.print(f"[dim]Project: {config.project_name}[/dim]")
    UI.print(f"[dim]Tests folder: {tests_dir}[/dim]")
    UI.print(f"[dim]Models: {', '.join(str(m) for m in model_configs)}[/dim]")
    if k_count > 1:
        UI.print(f"[dim]k: {k_count}[/dim]")
    UI.print("")

    test_cases = discover_tests(project_path)

    if not test_cases:
        UI.warn("No tests to run.")
        return

    try:
        test_cases = filter_test_cases(test_cases, select, tests_dir)
    except ValueError as e:
        UI.error(str(e))
        return

    ensure_verification_engine(test_cases)

    total_runs = len(test_cases) * len(model_configs) * k_count
    UI.print(
        f"[bold]Found {len(test_cases)} test(s) × {len(model_configs)} model(s) × {k_count} attempt(s) = {total_runs} run(s)[/bold]"
        if k_count > 1
        else f"[bold]Found {len(test_cases)} test(s) × {len(model_configs)} model(s) = {total_runs} run(s)[/bold]"
    )
    if thread_count > 1:
        UI.print(f"[dim]Running with {thread_count} threads (output may be interleaved)[/dim]")
    UI.print("")

    # Build list of (test_case, model, attempt) triples — attempt is 1-indexed
    test_runs = [
        (test_case, model, attempt)
        for model in model_configs
        for test_case in test_cases
        for attempt in range(1, k_count + 1)
    ]

    results: list[TestRunResult] = []
    if thread_count == 1:
        for test_case, model, attempt in test_runs:
            result = run_test(
                test_case,
                model,
                email=email,
                password=pwd,
                costs=resolve_model_costs(config, model),
                comparison=test_config.comparison,
            )
            result.attempt = attempt
            results.append(result)
            UI.print("")
    else:
        # Results are collected by submission order so the summaries stay grouped by model.
        completed: dict[int, TestRunResult] = {}
        with ThreadPoolExecutor(max_workers=thread_count) as executor:
            futures = {
                executor.submit(
                    run_test,
                    tc,
                    m,
                    email=email,
                    password=pwd,
                    costs=resolve_model_costs(config, m),
                    comparison=test_config.comparison,
                ): (index, attempt)
                for index, (tc, m, attempt) in enumerate(test_runs)
            }
            for future in as_completed(futures):
                index, attempt = futures[future]
                result = future.result()
                result.attempt = attempt
                completed[index] = result
                UI.print("")
        results = [completed[index] for index in sorted(completed)]

    # Save results to JSON
    output_file = save_results(results, project_path / TESTS_FOLDER / "outputs")
    UI.print(f"[dim]Results saved to: {output_file}[/dim]\n")

    print_run_table(results)

    run_dicts = [asdict(r) for r in results]
    pass_metrics = summarize_pass_metrics(run_dicts)
    model_summaries = summarize_by_model(run_dicts)

    print_pass_metrics_table(pass_metrics, k_count)
    if len(model_summaries) > 1 or k_count > 1:
        print_model_table(model_summaries, k_count)
    if len(model_summaries) > 1:
        print_model_matrix(results)

    passed = sum(1 for r in results if r.passed)
    failed = sum(1 for r in results if not r.passed)
    total = len(results)
    unit = "run" if len(model_summaries) > 1 or k_count > 1 else "test"
    aggregate = pass_metrics["aggregate"]

    UI.print("")
    UI.print(
        f"pass@1: {format_pass_fraction(float(aggregate['pass_at_1']))}"
        + (
            f"  pass@{k_count}: {format_pass_fraction(float(aggregate['pass_at_k']))}"
            f"  pass^{k_count}: {format_pass_fraction(float(aggregate['pass_hat_k']))}"
            if k_count > 1
            else ""
        )
    )
    if failed == 0:
        UI.success(f"All {total} {unit}(s) passed")
    else:
        UI.print(f"[green]{passed} passed[/green], [red]{failed} failed[/red], {total} total")
        sys.exit(1)
