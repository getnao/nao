from dataclasses import dataclass, field
from pathlib import Path

import yaml

from nao_core.ui import UI

from .assertions import Assertion, parse_assertions

TESTS_FOLDER = "tests/"


class InvalidTestFileError(Exception):
    """Raised when one or more test YAML files cannot be loaded."""


@dataclass
class TestCase:
    """A single test case loaded from a YAML file."""

    name: str
    prompt: str
    file_path: Path
    sql: str | None = None
    database: str | None = None
    assertions: list[Assertion] = field(default_factory=list)

    @classmethod
    def from_yaml(cls, file_path: Path) -> "TestCase":
        """Load a test case from a YAML file."""
        with open(file_path) as f:
            data = yaml.safe_load(f)

        return cls(
            name=data.get("name", file_path.stem),
            prompt=data["prompt"],
            sql=data.get("sql"),
            database=data.get("database"),
            file_path=file_path,
            assertions=parse_assertions(data.get("assertions")),
        )


def discover_tests(project_path: Path) -> list[TestCase]:
    """Discover all test cases in the tests/ folder.

    Raises ``InvalidTestFileError`` when any test file fails to load, so that a malformed
    test cannot be silently skipped and leave the run green.
    """
    tests_dir = project_path / TESTS_FOLDER

    if not tests_dir.exists():
        UI.warn(f"Tests folder not found: {tests_dir}")
        return []

    test_files = [
        p
        for p in (*tests_dir.rglob("*.yml"), *tests_dir.rglob("*.yaml"))
        if "outputs" not in p.relative_to(tests_dir).parts
    ]

    if not test_files:
        UI.warn(f"No test files found in {tests_dir}")
        return []

    test_cases: list[TestCase] = []
    load_errors: list[str] = []
    for file_path in sorted(test_files):
        try:
            test_cases.append(TestCase.from_yaml(file_path))
        except Exception as e:
            load_errors.append(f"{file_path.relative_to(tests_dir)}: {e}")

    if load_errors:
        raise InvalidTestFileError(
            "Failed to load test file(s):\n" + "\n".join(f"  - {error}" for error in load_errors)
        )

    return test_cases
