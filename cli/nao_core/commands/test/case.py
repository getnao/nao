from dataclasses import dataclass
from pathlib import Path

import yaml

from nao_core.ui import UI

TESTS_FOLDER = "tests/"


@dataclass
class TestCase:
    """A single test case loaded from a YAML file."""

    name: str
    prompt: str
    file_path: Path
    sql: str | None = None

    @classmethod
    def from_yaml(cls, file_path: Path) -> "TestCase":
        """Load a test case from a YAML file."""
        with open(file_path) as f:
            data = yaml.safe_load(f)

        return cls(
            name=data.get("name", file_path.stem),
            prompt=data["prompt"],
            sql=data.get("sql"),
            file_path=file_path,
        )


def discover_tests(project_path: Path) -> list[TestCase]:
    """Discover all test cases in the tests/ folder."""
    tests_dir = project_path / TESTS_FOLDER

    if not tests_dir.exists():
        UI.warn(f"Tests folder not found: {tests_dir}")
        return []

    test_files = list(tests_dir.glob("*.yml")) + list(tests_dir.glob("*.yaml"))

    if not test_files:
        UI.warn(f"No test files found in {tests_dir}")
        return []

    test_cases = []
    for file_path in sorted(test_files):
        try:
            test_case = TestCase.from_yaml(file_path)
            test_cases.append(test_case)
        except Exception as e:
            UI.error(f"Failed to load {file_path.name}: {e}")

    return test_cases
