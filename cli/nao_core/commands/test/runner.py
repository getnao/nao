import json
import os
import sys
from concurrent.futures import ThreadPoolExecutor, as_completed
from dataclasses import asdict, dataclass, field
from datetime import datetime
from math import comb
from pathlib import Path
from typing import Annotated, cast

import numpy as np
import pandas as pd
from cyclopts import Parameter

from nao_core.config import NaoConfig, resolve_project_path
from nao_core.config.llm import ModelCosts
from nao_core.ui import UI

from .case import TESTS_FOLDER, TestCase, discover_tests
from .client import AgentClientError, VerificationResult, get_client
from .compare import normalize_dataframe_numbers

# Default models to test
DEFAULT_MODELS = ["openai:gpt-4.1"]
# Default number of attempts per (test, model). k=1 preserves the previous behavior.
DEFAULT_K = 1
# Hard upper bound on k to keep accidental invocations from running thousands of attempts.
MAX_K = 100


def pass_at_k(n: int, c: int, k: int) -> float:
    """Probability of at least one success in k trials given c successes in n samples.

    Standard Codex unbiased estimator (Chen et al., 2021). When n > k this is
    a smooth probability that rises with k; when n == k (the common case for
    `nao test --k N`) it collapses to a step function: 1.0 if any attempt
    succeeded, 0.0 otherwise.
    """
    if k <= 0:
        raise ValueError(f"k must be positive, got {k}")
    if n < c or c < 0 or n < 0:
        raise ValueError(f"invalid (n, c): ({n}, {c})")
    if n - c < k:
        return 1.0
    return 1.0 - comb(n - c, k) / comb(n, k)


def pass_pow_k(n: int, c: int, k: int) -> float:
    """Probability that all k trials succeed given c successes in n samples.

    Returns 1.0 if c >= k, else 0.0. With n == k this is 1.0 only on a perfect run.
    """
    if k <= 0:
        raise ValueError(f"k must be positive, got {k}")
    if n < c or c < 0 or n < 0:
        raise ValueError(f"invalid (n, c): ({n}, {c})")
    return 1.0 if c >= k else 0.0


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


@dataclass
class TestRunMetrics:
    """Aggregate metrics for a (test, model) pair across k attempts."""

    name: str
    model: str
    k: int
    attempts: int
    successes: int
    pass_at_k: float
    pass_pow_k: float
    tokens: int = 0
    cost: float = 0.0
    duration_ms: int = 0
    tool_call_count: int = 0
    attempt_results: list[TestRunResult] = field(default_factory=list)

    @property
    def label(self) -> str:
        """Short human label, e.g. '3/5'."""
        return f"{self.successes}/{self.attempts}"


def check_dataframe(
    verification: VerificationResult, rtol: float = 1e-5, atol: float = 1e-8
) -> tuple[bool, str, str | None]:
    """Check if actual data matches expected. Returns (passed, message, comparison).

    Args:
        verification: The verification result containing actual and expected data.
        rtol: Relative tolerance for float comparison.
        atol: Absolute tolerance for float comparison.
    """
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

    def round_numeric(df: pd.DataFrame, decimals: int = 2) -> pd.DataFrame:
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

    # Round float-like values to 2 decimals to avoid noisy diffs
    actual = round_numeric(actual, decimals=2)
    expected = round_numeric(expected, decimals=2)

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
            passed, msg, comparison = check_dataframe(result.verification)
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
                    comparison=comparison,
                    tool_calls=result.tool_calls,
                    reference_sql=test_case.sql,
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


def build_metrics(
    results: list[TestRunResult],
    k: int,
) -> list[TestRunMetrics]:
    """Group per-attempt results by (test, model) and compute pass@k / pass^k.

    The input `results` may include errors / failed attempts interleaved with
    successes. We count a `TestRunResult` as a success when `passed is True`
    and no error was reported. Failed runs (including `AgentClientError`s
    caught by `run_test`) are counted as failures.
    """
    by_pair: dict[tuple[str, str], list[TestRunResult]] = {}
    for r in results:
        by_pair.setdefault((r.name, r.model), []).append(r)

    metrics: list[TestRunMetrics] = []
    for (name, model), attempts in by_pair.items():
        n = len(attempts)
        c = sum(1 for a in attempts if a.passed and not a.error)
        metrics.append(
            TestRunMetrics(
                name=name,
                model=model,
                k=k,
                attempts=n,
                successes=c,
                pass_at_k=pass_at_k(n, c, k) if n > 0 else 0.0,
                pass_pow_k=pass_pow_k(n, c, k) if n > 0 else 0.0,
                tokens=sum(a.tokens or 0 for a in attempts),
                cost=sum(a.cost or 0 for a in attempts),
                duration_ms=sum(a.duration_ms or 0 for a in attempts),
                tool_call_count=sum(a.tool_call_count or 0 for a in attempts),
                attempt_results=list(attempts),
            )
        )
    return metrics


def save_results(
    results: list[TestRunResult],
    output_dir: Path,
    metrics: list[TestRunMetrics] | None = None,
    k: int = 1,
) -> Path:
    """Save test results to JSON file.

    The on-disk shape:

    - ``results`` — flat list of per-attempt results (backwards compatible with
      the pre-k=1 schema; with k>1, this contains every attempt).
    - ``metrics`` — one aggregate per (test, model) pair with pass@k / pass^k.
    - ``summary`` — per-attempt totals (unchanged semantics for k=1; counts
      scale with k for k>1).
    """
    output_dir.mkdir(parents=True, exist_ok=True)
    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    output_file = output_dir / f"results_{timestamp}.json"

    total_duration_ms = sum(r.duration_ms or 0 for r in results)
    total_tool_calls = sum(r.tool_call_count or 0 for r in results)

    metrics_payload = []
    for m in metrics or []:
        m_dict = asdict(m)
        # Don't dump nested attempt_results into the per-pair metric; the flat
        # `results` array already holds every attempt. Keep the metric lean.
        m_dict.pop("attempt_results", None)
        metrics_payload.append(m_dict)

    data = {
        "timestamp": datetime.now().isoformat(),
        "k": k,
        "results": [asdict(r) for r in results],
        "metrics": metrics_payload,
        "summary": {
            "total": len(results),
            "passed": sum(1 for r in results if r.passed),
            "failed": sum(1 for r in results if not r.passed),
            "total_tokens": sum(r.tokens or 0 for r in results),
            "total_cost": sum(r.cost or 0 for r in results),
            "total_duration_ms": total_duration_ms,
            "total_duration_s": round(total_duration_ms / 1000, 2),
            "total_tool_calls": total_tool_calls,
            "avg_duration_ms": round(total_duration_ms / len(results), 0) if results else 0,
            "avg_tool_calls": round(total_tool_calls / len(results), 1) if results else 0,
        },
    }

    output_file.write_text(json.dumps(data, indent=2))
    return output_file


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


def test(
    models: Annotated[
        list[str] | None,
        Parameter(
            name=["-m", "--model"],
            help="Models to test (format: provider:model_id). Can be specified multiple times.",
        ),
    ] = None,
    threads: Annotated[
        int,
        Parameter(
            name=["-t", "--threads"],
            help="Number of parallel threads for running tests.",
        ),
    ] = 1,
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
    k: Annotated[
        int,
        Parameter(
            name=["-k", "--k"],
            help=(
                "Number of attempts per (test, model) pair. Reports pass@k "
                "(chance of at least one success in k trials) and pass^k "
                "(chance all k trials succeed) alongside the existing single-run "
                f"pass rate. Defaults to {DEFAULT_K} (single-run, unchanged behavior). "
                f"Maximum {MAX_K}."
            ),
        ),
    ] = DEFAULT_K,
):
    """Run tests from the tests/ folder.

    Examples:
        nao test
        nao test -m openai:gpt-4.1
        nao test -m openai:gpt-4.1 -m anthropic:claude-sonnet-4-20250514
        nao test --threads 4
        nao test -k 5
        nao test -k 5 -m openai:gpt-4.1
        nao test -s test_name
        nao test -s 12,13,14
        nao test -u user@example.com --password secret
    """
    if k < 1:
        UI.error("--k must be at least 1")
        sys.exit(2)
    if k > MAX_K:
        UI.error(f"--k must be at most {MAX_K}")
        sys.exit(2)

    email = username or os.environ.get("NAO_USERNAME")
    pwd = password or os.environ.get("NAO_PASSWORD")

    UI.info("\n🧪 Running nao tests...\n")

    config = NaoConfig.try_load(resolve_project_path(), exit_on_error=True)
    assert config is not None

    # Parse models
    model_strs = models if models else DEFAULT_MODELS
    try:
        model_configs = [ModelConfig.parse(m) for m in model_strs]
    except ValueError as e:
        UI.error(str(e))
        return

    project_path = Path.cwd()
    model_costs = config.llm.meta.costs if config.llm and config.llm.meta else None
    tests_dir = project_path / TESTS_FOLDER
    UI.print(f"[dim]Project: {config.project_name}[/dim]")
    UI.print(f"[dim]Tests folder: {tests_dir}[/dim]")
    UI.print(f"[dim]Models: {', '.join(str(m) for m in model_configs)}[/dim]")
    if k > 1:
        UI.print(f"[dim]Attempts per (test, model): {k}[/dim]")
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

    total_pairs = len(test_cases) * len(model_configs)
    total_runs = total_pairs * k
    if k > 1:
        UI.print(
            f"[bold]Found {len(test_cases)} test(s) × {len(model_configs)} model(s) × {k} attempt(s) "
            f"= {total_runs} run(s)[/bold]"
        )
    else:
        UI.print(f"[bold]Found {len(test_cases)} test(s) × {len(model_configs)} model(s) = {total_runs} run(s)[/bold]")
    if threads > 1:
        UI.print(f"[dim]Running with {threads} threads (output may be interleaved)[/dim]")
    UI.print("")

    # Build list of (test_case, model) pairs, repeated k times each.
    test_runs = [(test_case, model) for model in model_configs for test_case in test_cases for _ in range(k)]

    results: list[TestRunResult] = []
    if threads == 1:
        for test_case, model in test_runs:
            result = run_test(test_case, model, email=email, password=pwd, costs=model_costs)
            results.append(result)
            UI.print("")
    else:
        with ThreadPoolExecutor(max_workers=threads) as executor:
            futures = {
                executor.submit(run_test, tc, m, email=email, password=pwd, costs=model_costs): (tc, m)
                for tc, m in test_runs
            }
            for future in as_completed(futures):
                result = future.result()
                results.append(result)
                UI.print("")

    # Group per-attempt results into per-pair metrics for pass@k / pass^k.
    metrics = build_metrics(results, k)

    # Save results to JSON
    output_file = save_results(
        results,
        project_path / TESTS_FOLDER / "outputs",
        metrics=metrics,
        k=k,
    )
    UI.print(f"[dim]Results saved to: {output_file}[/dim]\n")

    # Print summary table — one row per (test, model) pair, with k, pass@k, pass^k.
    rows: list[dict] = []
    for m in metrics:
        if m.attempts == 0:
            status = "[dim]-[/dim]"
        elif m.pass_pow_k >= 1.0:
            status = "[green]✓ all[/green]"
        elif m.successes > 0:
            status = "[yellow]~ partial[/yellow]"
        else:
            status = "[red]✗[/red]"
        row = {
            "Test": m.name,
            "Model": m.model,
            "k": m.k,
            "Pass": m.label,
            "Pass@k": f"{m.pass_at_k * 100:.0f}%",
            "Pass^k": f"{m.pass_pow_k * 100:.0f}%",
            "Status": status,
            "Tokens": m.tokens,
            "Cost": m.cost,
            "Time (s)": round(m.duration_ms / 1000, 1),
            "Tools": m.tool_call_count,
        }
        rows.append(row)
    df = pd.DataFrame(rows)
    table_title = "Test Results" if k == 1 else f"Test Results (k={k})"
    UI.table(df, title=table_title, sum_columns={"Tokens": "", "Cost": "$", "Time (s)": "", "Tools": ""})

    # Print summary
    total_attempts = len(results)
    passed_attempts = sum(1 for r in results if r.passed)
    failed_attempts = sum(1 for r in results if not r.passed)
    total_pairs_ok = sum(1 for m in metrics if m.attempts > 0 and m.pass_pow_k >= 1.0)
    total_pairs_partial = sum(1 for m in metrics if m.attempts > 0 and 0 < m.successes < m.attempts)
    total_pairs_failed = sum(1 for m in metrics if m.attempts > 0 and m.successes == 0)
    aggregate_pass_at_k = sum(m.pass_at_k for m in metrics) / len(metrics) if metrics else 0.0
    aggregate_pass_pow_k = sum(m.pass_pow_k for m in metrics) / len(metrics) if metrics else 0.0

    UI.print("")
    if k == 1:
        if failed_attempts == 0:
            UI.success(f"All {total_attempts} test(s) passed")
        else:
            UI.print(
                f"[green]{passed_attempts} passed[/green], [red]{failed_attempts} failed[/red], {total_attempts} total"
            )
            sys.exit(1)
        return

    # k > 1: print the richer summary.
    UI.print(
        f"[bold]Pairs:[/bold] {total_pairs_ok} all-pass, {total_pairs_partial} partial, {total_pairs_failed} all-fail (of {len(metrics)} total)"
    )
    UI.print(f"[bold]Attempts:[/bold] {passed_attempts} passed, {failed_attempts} failed (of {total_attempts} total)")
    UI.print(
        f"[bold]Aggregate pass@k:[/bold] {aggregate_pass_at_k * 100:.1f}%   "
        f"[bold]pass^k:[/bold] {aggregate_pass_pow_k * 100:.1f}%"
    )
    # Exit non-zero if any pair failed every attempt — same policy as before
    # (failed single-run tests fail the command).
    if total_pairs_failed > 0:
        sys.exit(1)
