"""Render dbt Charts boards while routing every SQL query through a nao database connection.

dbt Charts (https://github.com/dbt-labs/dbt-charts) compiles a YAML board into SQL queries and
Vega-Lite charts. Instead of letting it open warehouse connections through dbt adapters, nao plugs a
custom adapter into its execution layer: the board's queries (with `{{ ref() }}`, `{{ filter() }}`
and variables already rendered) are handed to a caller-provided `SqlRunner`, so they benefit from the
same guards as any other nao query.
"""

from __future__ import annotations

import importlib.util
from dataclasses import dataclass, field
from importlib.metadata import PackageNotFoundError, version
from pathlib import Path
from typing import TYPE_CHECKING, Any, Callable

if TYPE_CHECKING:
    from dbt_charts.core.diagnostics.diagnostic import Diagnostic

SqlRunner = Callable[[str, str], tuple[list[str], list[dict[str, Any]]]]
"""Executes `sql` against the nao database named by the first argument, returning (columns, rows)."""

INSTALL_HINT = 'dbt Charts support requires the optional dependency: pip install "nao-core[dbt-charts]"'

DBT_MANIFEST_RELATIVE_PATH = Path("target/manifest.json")


class DbtChartsUnavailableError(RuntimeError):
    def __init__(self) -> None:
        super().__init__(INSTALL_HINT)


def is_available() -> bool:
    return importlib.util.find_spec("dbt_charts") is not None


def dbt_charts_version() -> str | None:
    try:
        return version("dbt-charts")
    except PackageNotFoundError:
        return None


@dataclass
class BoardDiagnostic:
    code: str
    message: str
    level: str
    fix: str | None = None
    hint: str | None = None
    chart: str | None = None
    query: str | None = None
    path: str | None = None
    line: int | None = None

    @classmethod
    def from_dbt_charts(cls, diagnostic: Diagnostic, level: str) -> BoardDiagnostic:
        return cls(
            code=diagnostic.code,
            message=diagnostic.message,
            level=level,
            fix=diagnostic.fix,
            hint=diagnostic.hint,
            chart=diagnostic.chart,
            query=diagnostic.query,
            path=diagnostic.path,
            line=diagnostic.range.start_line if diagnostic.range else None,
        )

    def to_dict(self) -> dict[str, Any]:
        return {
            "code": self.code,
            "message": self.message,
            "level": self.level,
            "fix": self.fix,
            "hint": self.hint,
            "chart": self.chart,
            "query": self.query,
            "path": self.path,
            "line": self.line,
        }


@dataclass
class BoardControl:
    """A board variable settled into the widget the user should see."""

    name: str
    input: str
    label: str
    value: Any
    options: list[str]
    enabled: bool
    can_unset: bool
    slider_min: float | None = None
    slider_max: float | None = None
    slider_step: float | None = None

    def to_dict(self) -> dict[str, Any]:
        return {
            "name": self.name,
            "input": self.input,
            "label": self.label,
            "value": _json_safe(self.value),
            "options": self.options,
            "enabled": self.enabled,
            "can_unset": self.can_unset,
            "slider_min": self.slider_min,
            "slider_max": self.slider_max,
            "slider_step": self.slider_step,
        }


@dataclass
class BoardValidationResult:
    success: bool
    title: str | None
    errors: list[BoardDiagnostic] = field(default_factory=list)
    warnings: list[BoardDiagnostic] = field(default_factory=list)

    def to_dict(self) -> dict[str, Any]:
        return {
            "success": self.success,
            "title": self.title,
            "errors": [error.to_dict() for error in self.errors],
            "warnings": [warning.to_dict() for warning in self.warnings],
        }


@dataclass
class BoardRenderResult:
    title: str | None
    svg: str | None
    variables: dict[str, Any]
    controls: list[BoardControl] = field(default_factory=list)
    board_error: BoardDiagnostic | None = None
    chart_errors: list[BoardDiagnostic] = field(default_factory=list)
    warnings: list[BoardDiagnostic] = field(default_factory=list)

    def to_dict(self) -> dict[str, Any]:
        return {
            "title": self.title,
            "svg": self.svg,
            "variables": _json_safe(self.variables),
            "controls": [control.to_dict() for control in self.controls],
            "board_error": self.board_error.to_dict() if self.board_error else None,
            "chart_errors": [error.to_dict() for error in self.chart_errors],
            "warnings": [warning.to_dict() for warning in self.warnings],
        }


def validate_board(yaml_text: str, *, default_database: str | None) -> BoardValidationResult:
    """Compile a board without touching any database."""
    _require_dbt_charts()
    from dbt_charts.core.compile import compile as compile_board

    result = compile_board(yaml_text, host_default_source=default_database)
    title = getattr(result.board, "title", None) if result.board is not None else None
    return BoardValidationResult(
        success=result.success,
        title=title,
        errors=[BoardDiagnostic.from_dbt_charts(diagnostic, "error") for diagnostic in result.errors],
        warnings=[BoardDiagnostic.from_dbt_charts(diagnostic, "warning") for diagnostic in result.warnings],
    )


def render_board(
    yaml_text: str,
    *,
    databases: dict[str, str],
    default_database: str | None,
    run_sql: SqlRunner,
    variables: dict[str, Any] | None = None,
    dbt_project_dir: Path | None = None,
    font_url_prefix: str | None = None,
) -> BoardRenderResult:
    """Compile, execute (through `run_sql`) and render a board to SVG.

    `databases` maps nao database names to their nao `type`; a board's `source:` must name one of them.
    `dbt_project_dir` enables `{{ ref() }}` / `{{ source() }}` resolution from `target/manifest.json`.
    """
    _require_dbt_charts()
    from dbt_charts.core.compile import compile as compile_board
    from dbt_charts.core.execute import Executor
    from dbt_charts.core.execute.executor import merge_board_variables
    from dbt_charts.core.render import render

    from .adapter import build_nao_adapter_registry

    compiled = compile_board(yaml_text, host_default_source=default_database)
    if not compiled.success or compiled.board is None:
        return _compile_failure_result(compiled.errors, compiled.warnings, variables or {})

    board = compiled.board
    registry = build_nao_adapter_registry(databases, run_sql, dbt_project_dir)
    executor = Executor(board, registry, query_registry=compiled.query_registry, use_cache=False)
    try:
        rendered = render(board, executor, format="svg", variables=variables or {}, max_workers=1)
        merged_variables = merge_board_variables(board, variables or {})
        controls = _resolve_board_controls(board, merged_variables, executor)
    finally:
        registry.close()

    svg = rendered.output if isinstance(rendered.output, str) else None
    if svg is not None and font_url_prefix is not None:
        svg = _rewrite_font_urls(svg, font_url_prefix)

    return BoardRenderResult(
        title=getattr(board, "title", None),
        svg=svg,
        variables=merged_variables,
        controls=controls,
        board_error=BoardDiagnostic.from_dbt_charts(rendered.board_error, "error") if rendered.board_error else None,
        chart_errors=[BoardDiagnostic.from_dbt_charts(d, "error") for d in rendered.chart_errors],
        warnings=[BoardDiagnostic.from_dbt_charts(d, "warning") for d in [*compiled.warnings, *rendered.warnings]],
    )


def find_dbt_project_dir(project_path: Path, candidate_dirs: list[Path]) -> Path | None:
    """Locate the dbt project whose `target/manifest.json` boards should resolve `ref()` against.

    Configured repos come first, then the nao project itself, then its immediate subfolders.
    """
    subfolders = sorted(child for child in project_path.iterdir() if child.is_dir()) if project_path.is_dir() else []
    for candidate in [*candidate_dirs, project_path, *subfolders]:
        if (candidate / DBT_MANIFEST_RELATIVE_PATH).is_file():
            return candidate
    return None


def font_file_path(file_name: str) -> Path | None:
    """Resolve one of the fonts vendored by dbt Charts, or None when the name is unknown."""
    _require_dbt_charts()
    from dbt_charts.core.fonts import get_fonts_dir

    fonts_dir = get_fonts_dir().resolve()
    candidate = (fonts_dir / file_name).resolve()
    if candidate.parent != fonts_dir or not candidate.is_file():
        return None
    return candidate


def _require_dbt_charts() -> None:
    if not is_available():
        raise DbtChartsUnavailableError()


def _compile_failure_result(
    errors: list[Diagnostic], warnings: list[Diagnostic], variables: dict[str, Any]
) -> BoardRenderResult:
    return BoardRenderResult(
        title=None,
        svg=None,
        variables=variables,
        board_error=BoardDiagnostic.from_dbt_charts(errors[0], "error") if errors else None,
        chart_errors=[BoardDiagnostic.from_dbt_charts(d, "error") for d in errors[1:]],
        warnings=[BoardDiagnostic.from_dbt_charts(d, "warning") for d in warnings],
    )


def _resolve_board_controls(board: Any, merged_variables: dict[str, Any], executor: Any) -> list[BoardControl]:
    from dbt_charts.core.render.variables_resolve import resolve_controls

    variable_defs = board.variable_registry or {}
    if not variable_defs:
        return []
    controls = resolve_controls(variable_defs, merged_variables, executor, board.resolved_style.variables)
    return [
        BoardControl(
            name=control.name,
            input=control.input,
            label=control.label,
            value=control.current,
            options=list(control.option_values),
            enabled=control.enabled,
            can_unset=control.can_unset,
            slider_min=control.slider_min if control.input in ("slider", "range") else None,
            slider_max=control.slider_max if control.input in ("slider", "range") else None,
            slider_step=control.slider_step if control.input in ("slider", "range") else None,
        )
        for control in controls
    ]


def _rewrite_font_urls(svg: str, font_url_prefix: str) -> str:
    from dbt_charts.core.fonts import STATIC_FONT_URL_PREFIX

    prefix = font_url_prefix.rstrip("/")
    return svg.replace(f"url('{STATIC_FONT_URL_PREFIX}/", f"url('{prefix}/").replace(
        f'url("{STATIC_FONT_URL_PREFIX}/', f'url("{prefix}/'
    )


def _json_safe(value: Any) -> Any:
    if isinstance(value, dict):
        return {str(key): _json_safe(item) for key, item in value.items()}
    if isinstance(value, (list, tuple, set, frozenset)):
        return [_json_safe(item) for item in value]
    if value is None or isinstance(value, (str, int, float, bool)):
        return value
    return str(value)
