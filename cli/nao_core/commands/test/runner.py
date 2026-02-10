import json
from concurrent.futures import ThreadPoolExecutor, as_completed
from dataclasses import asdict, dataclass
from datetime import datetime
from pathlib import Path
from typing import Annotated

import numpy as np
import pandas as pd
from cyclopts import Parameter

from nao_core.config import NaoConfig
from nao_core.ui import UI

from .case import TESTS_FOLDER, TestCase, discover_tests
from .client import AgentClientError, VerificationResult, get_client

# Default models to test
DEFAULT_MODELS = ["openai:gpt-4.1"]


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
        actual, expected = actual[cols], expected[cols]

    if len(actual) != len(expected):
        return False, f"row count: {len(actual)} vs {len(expected)}", None

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
    actual = actual[sorted_cols]
    expected = expected[sorted_cols]

    # Round float-like values to 2 decimals to avoid noisy diffs
    actual = round_numeric(actual, decimals=2)
    expected = round_numeric(expected, decimals=2)

    # Check for exact match first
    if actual.equals(expected):
        return True, "match", None

    # Try approximate comparison for numeric columns
    try:
        is_close = True
        for col in actual.columns:
            actual_series: pd.Series = actual[col]
            expected_series: pd.Series = expected[col]

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


def run_test(test_case: TestCase, model: ModelConfig) -> TestRunResult:
    """Run a single test case with a specific model. Returns TestRunResult."""
    UI.print(f"[bold]Running:[/bold] {test_case.name} [dim]({model})[/dim]")
    UI.print(f"[dim]  Prompt: {test_case.prompt}[/dim]")

    client = get_client()

    try:
        result = client.run_test(test_case, provider=model.provider, model_id=model.model_id)

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
            details=None,
        )


def save_results(results: list[TestRunResult], output_dir: Path) -> Path:
    """Save test results to JSON file."""
    output_dir.mkdir(parents=True, exist_ok=True)
    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    output_file = output_dir / f"results_{timestamp}.json"

    total_duration_ms = sum(r.duration_ms or 0 for r in results)
    total_tool_calls = sum(r.tool_call_count or 0 for r in results)

    data = {
        "timestamp": datetime.now().isoformat(),
        "results": [asdict(r) for r in results],
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
):
    """Run tests from the tests/ folder.

    Examples:
        nao test
        nao test -m openai:gpt-4.1
        nao test -m openai:gpt-4.1 -m anthropic:claude-sonnet-4-20250514
        nao test --threads 4
    """
    UI.info("\n🧪 Running nao tests...\n")

    config = NaoConfig.try_load(exit_on_error=True)
    assert config is not None

    # Parse models
    model_strs = models if models else DEFAULT_MODELS
    try:
        model_configs = [ModelConfig.parse(m) for m in model_strs]
    except ValueError as e:
        UI.error(str(e))
        return

    project_path = Path.cwd()
    UI.print(f"[dim]Project: {config.project_name}[/dim]")
    UI.print(f"[dim]Tests folder: {project_path / TESTS_FOLDER}[/dim]")
    UI.print(f"[dim]Models: {', '.join(str(m) for m in model_configs)}[/dim]\n")

    test_cases = discover_tests(project_path)

    if not test_cases:
        UI.warn("No tests to run.")
        return

    total_runs = len(test_cases) * len(model_configs)
    UI.print(f"[bold]Found {len(test_cases)} test(s) × {len(model_configs)} model(s) = {total_runs} run(s)[/bold]")
    if threads > 1:
        UI.print(f"[dim]Running with {threads} threads (output may be interleaved)[/dim]")
    UI.print("")

    # Build list of (test_case, model) pairs
    test_runs = [(test_case, model) for model in model_configs for test_case in test_cases]

    results: list[TestRunResult] = []
    if threads == 1:
        # Sequential execution
        for test_case, model in test_runs:
            result = run_test(test_case, model)
            results.append(result)
            UI.print("")
    else:
        # Parallel execution
        with ThreadPoolExecutor(max_workers=threads) as executor:
            futures = {executor.submit(run_test, tc, m): (tc, m) for tc, m in test_runs}
            for future in as_completed(futures):
                result = future.result()
                results.append(result)
                UI.print("")

    # Save results to JSON
    output_file = save_results(results, project_path / TESTS_FOLDER / "outputs")
    UI.print(f"[dim]Results saved to: {output_file}[/dim]\n")

    # Print summary table
    df = pd.DataFrame(
        [
            {
                "Test": r.name,
                "Model": r.model,
                "Status": "[green]✓[/green]" if r.passed else "[red]✗[/red]",
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

    # Print summary
    passed = sum(1 for r in results if r.passed)
    failed = sum(1 for r in results if not r.passed)
    total = len(results)

    UI.print("")
    if failed == 0:
        UI.success(f"All {total} test(s) passed")
    else:
        UI.print(f"[green]{passed} passed[/green], [red]{failed} failed[/red], {total} total")
