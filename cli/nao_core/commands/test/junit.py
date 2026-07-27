"""Write ``nao test`` results as a JUnit XML report for CI consumption.

The schema follows the de-facto JUnit format consumed by GitHub Actions
(``dorny/test-reporter``), GitLab CI's ``artifacts:reports:junit:`` block,
Jenkins JUnit Plugin, and Buildkite. One ``<testsuite>`` per test case, one
``<testcase>`` per (test, model) run, with the standard ``<failure>`` /
``<error>`` / ``<skipped>`` children and a ``<system-out>`` carrying the
token / cost / duration summary.
"""

from __future__ import annotations

import xml.etree.ElementTree as ET
from datetime import datetime, timezone
from pathlib import Path
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from .runner import TestRunResult

CLASS_NAME = "nao-test"


def save_results_junit(results: list[TestRunResult], output_dir: Path) -> Path:
    """Write ``results`` to a JUnit XML file in ``output_dir``.

    The filename is ``results_<UTC timestamp>.xml``; the directory is
    created if it does not exist. Returns the path of the written file.
    """
    output_dir.mkdir(parents=True, exist_ok=True)
    timestamp = datetime.now(timezone.utc).strftime("%Y%m%d_%H%M%S")
    output_file = output_dir / f"results_{timestamp}.xml"

    root = _build_testsuites(results)
    ET.ElementTree(root).write(output_file, encoding="utf-8", xml_declaration=True)
    return output_file


def _build_testsuites(results: list[TestRunResult]) -> ET.Element:
    tests = len(results)
    failures = sum(1 for r in results if _is_failure(r))
    errors = sum(1 for r in results if _is_error(r))
    skipped = sum(1 for r in results if _is_skipped(r))
    total_time = sum((r.duration_ms or 0) for r in results) / 1000.0

    root = ET.Element(
        "testsuites",
        attrib={
            "name": "nao-test",
            "tests": str(tests),
            "failures": str(failures),
            "errors": str(errors),
            "skipped": str(skipped),
            "time": f"{total_time:.3f}",
        },
    )
    for result in results:
        root.append(_build_testsuite(result))
    return root


def _build_testsuite(result: TestRunResult) -> ET.Element:
    duration_s = (result.duration_ms or 0) / 1000.0
    suite = ET.Element(
        "testsuite",
        attrib={
            "name": result.name,
            "tests": "1",
            "failures": "1" if _is_failure(result) else "0",
            "errors": "1" if _is_error(result) else "0",
            "skipped": "1" if _is_skipped(result) else "0",
            "time": f"{duration_s:.3f}",
        },
    )
    suite.append(_build_testcase(result))
    return suite


def _build_testcase(result: TestRunResult) -> ET.Element:
    duration_s = (result.duration_ms or 0) / 1000.0
    case = ET.Element(
        "testcase",
        attrib={
            "name": result.model,
            "classname": CLASS_NAME,
            "time": f"{duration_s:.3f}",
        },
    )
    if _is_failure(result):
        case.append(_failure_element(result))
    elif _is_error(result):
        case.append(_error_element(result))
    elif _is_skipped(result):
        case.append(_skipped_element(result))
    case.append(_system_out(result))
    return case


def _failure_element(result: TestRunResult) -> ET.Element:
    body = result.message
    if result.details and result.details.comparison:
        body = f"{body}\n\n{result.details.comparison}"
    element = ET.Element("failure", attrib={"message": result.message, "type": "failure"})
    element.text = body
    return element


def _error_element(result: TestRunResult) -> ET.Element:
    message = result.error or result.message
    element = ET.Element("error", attrib={"message": message, "type": "error"})
    element.text = message
    return element


def _skipped_element(result: TestRunResult) -> ET.Element:
    return ET.Element("skipped", attrib={"message": result.message or "no verification"})


def _system_out(result: TestRunResult) -> ET.Element:
    element = ET.Element("system-out")
    element.text = _format_summary(result)
    return element


def _format_summary(result: TestRunResult) -> str:
    return " ".join(
        [
            f"tokens={result.tokens or 0}",
            f"cost={result.cost or 0}",
            f"duration_ms={result.duration_ms or 0}",
            f"tool_calls={result.tool_call_count or 0}",
        ]
    )


def _is_failure(result: TestRunResult) -> bool:
    return not result.passed and not result.error


def _is_error(result: TestRunResult) -> bool:
    return not result.passed and bool(result.error)


def _is_skipped(result: TestRunResult) -> bool:
    return result.passed and result.message == "no verification"
