"""`from_file` references, which let a value of nao_config.yaml live in another file of the project.

    databases:
      - name: warehouse
        include:
          from_file: repos/business_context/nao/warehouse_tables.yml

The mapping is replaced by the parsed content of the file before the config is validated. The file is
plain data: it cannot hold secret references or other `from_file` references. It cannot be a dotfile
or sit in a dot folder either, such as `.env` or `.git/config`.
"""

from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass, field
from pathlib import Path, PurePath, PurePosixPath
from typing import Any

import yaml

from .repos.base import normalize_relative_path
from .secrets import contains_secret_reference

MAX_CONFIG_NODES = 100_000
FILE_REFERENCE_KEY = "from_file"
REPOSITORIES_SECTION = "repos"

Location = tuple[str | int, ...]

_MISSING = object()


@dataclass
class FileReferences:
    """Where the references of a loaded config sit, so that saving it writes them back instead of their content."""

    files: dict[Location, str] = field(default_factory=dict)
    missing: set[Location] = field(default_factory=set)

    @property
    def missing_files(self) -> list[str]:
        return [file for location, file in self.files.items() if location in self.missing]

    def restore(self, data: Any) -> list[str]:
        """A value the loaded config holds elsewhere, under a renamed legacy key for instance, cannot be
        traced back to its reference: it stays written inline and its file is reported as lost.
        """
        lost: list[str] = []
        for location, file in self.files.items():
            parent = _node_at(data, location[:-1])
            key = location[-1]
            if _holds_key(parent, key):
                parent[key] = {FILE_REFERENCE_KEY: file}
            else:
                lost.append(file)
        return lost


@dataclass
class _NodeBudget:
    """A YAML alias is parsed into one shared object, which a walk visits again at each of its uses: a few
    lines of nested aliases expand into billions of nodes. The config is refused before any walk that would
    visit them all.
    """

    remaining: int = MAX_CONFIG_NODES

    def spend(self, node: Any) -> None:
        self.remaining -= _count_walked_nodes(node, {})
        if self.remaining < 0:
            raise ValueError(
                f"nao_config.yaml holds more than {MAX_CONFIG_NODES} values, "
                f"once its YAML aliases and its {FILE_REFERENCE_KEY} files are expanded"
            )


def resolve_file_references(
    data: Any, project_path: Path, *, allow_missing: bool = False
) -> tuple[Any, FileReferences]:
    """Replaces every reference found in *data* by the content of its file.

    A file that does not exist fails the load, as a value left out would fall back to its default
    and an empty `include` means every table. With allow_missing=True, each top-level section that
    holds such a value is left out whole instead: `nao sync` reads the others, `repos` first of all,
    before the repositories holding these files are synced. `repos` itself is never left out, as
    syncing an incomplete list would delete the repositories missing from it.
    """
    if is_file_reference(data):
        raise ValueError(f"nao_config.yaml cannot be a single {FILE_REFERENCE_KEY} reference")

    budget = _NodeBudget()
    budget.spend(data)
    references = FileReferences()
    resolved = _resolve_node(data, (), project_path, references, budget)
    if not references.missing or not isinstance(resolved, dict):
        return resolved, references

    missing_files = ", ".join(repr(file) for file in references.missing_files)
    unresolved_sections = {location[0] for location in references.missing}
    if REPOSITORIES_SECTION in unresolved_sections:
        raise ValueError(
            f"{FILE_REFERENCE_KEY} {missing_files} does not exist. A file used in `{REPOSITORIES_SECTION}` "
            "must already be in the project, as that section is read before any repository is synced."
        )
    if not allow_missing:
        raise ValueError(
            f"{FILE_REFERENCE_KEY} {missing_files} does not exist. "
            "If it comes from a synced repository, run `nao sync -p repos` first."
        )
    return {key: value for key, value in resolved.items() if key not in unresolved_sections}, references


def is_file_reference(node: Any) -> bool:
    return isinstance(node, dict) and list(node) == [FILE_REFERENCE_KEY] and isinstance(node[FILE_REFERENCE_KEY], str)


def _resolve_node(
    node: Any, location: Location, project_path: Path, references: FileReferences, budget: _NodeBudget
) -> Any:
    if is_file_reference(node):
        file = node[FILE_REFERENCE_KEY]
        references.files[location] = file
        content = _read_referenced_file(project_path, file)
        if content is _MISSING:
            references.missing.add(location)
            return None
        budget.spend(content)
        return content

    if isinstance(node, dict):
        return {
            key: _resolve_node(child, (*location, key), project_path, references, budget) for key, child in node.items()
        }

    if isinstance(node, list):
        return [
            _resolve_node(child, (*location, index), project_path, references, budget)
            for index, child in enumerate(node)
        ]

    return node


def _count_walked_nodes(node: Any, counted: dict[int, int]) -> int:
    """A node met again while it is being counted is an alias to one of its own parents, which no walk can finish."""
    if not isinstance(node, dict | list):
        return 1
    if id(node) in counted:
        return counted[id(node)]
    over_budget = MAX_CONFIG_NODES + 1
    counted[id(node)] = over_budget
    count = 1
    for child in _children_of(node):
        count = min(count + _count_walked_nodes(child, counted), over_budget)
    counted[id(node)] = count
    return count


def validate_project_file(file: str, field_name: str) -> str:
    """Refuses a path of nao_config.yaml that could leave the project or name a dotfile, before the file exists."""
    relative_file = normalize_relative_path(file, field_name)
    if _is_hidden(PurePosixPath(relative_file)):
        raise ValueError(f"{field_name} '{file}' is a dotfile or sits in a dot folder, which cannot be read")
    return relative_file


def _read_referenced_file(project_path: Path, file: str) -> Any:
    project_root = project_path.resolve()
    file_path = (project_root / validate_project_file(file, FILE_REFERENCE_KEY)).resolve()
    if not file_path.is_relative_to(project_root):
        raise ValueError(f"{FILE_REFERENCE_KEY} '{file}' points outside the project")
    if _is_hidden(file_path.relative_to(project_root)):
        raise ValueError(f"{FILE_REFERENCE_KEY} '{file}' is a dotfile or sits in a dot folder, which cannot be read")
    if not file_path.is_file():
        return _MISSING

    try:
        value = yaml.safe_load(file_path.read_text())
    except yaml.YAMLError as error:
        raise ValueError(f"{FILE_REFERENCE_KEY} '{file}' is not valid YAML: {error}") from error

    if _any_node(value, _is_secret_reference):
        raise ValueError(
            f"{FILE_REFERENCE_KEY} '{file}' holds a secret reference such as {{{{ env('NAME') }}}}, "
            "which only nao_config.yaml itself can use"
        )
    if _any_node(value, is_file_reference):
        raise ValueError(
            f"{FILE_REFERENCE_KEY} '{file}' holds another {FILE_REFERENCE_KEY} reference, which is not supported"
        )
    return value


def _is_hidden(path: PurePath) -> bool:
    """Checked on the path as written and on the file it leads to, as a link could hide a dotfile behind another name."""
    return any(part.startswith(".") for part in path.parts)


def _is_secret_reference(node: Any) -> bool:
    """Checked on parsed strings, as a YAML escape would hide the reference from a check of the file's text."""
    return isinstance(node, str) and contains_secret_reference(node)


def _any_node(node: Any, predicate: Callable[[Any], bool], visited: set[int] | None = None) -> bool:
    """Visits a node shared through YAML aliases once, whatever the number of its uses."""
    if predicate(node):
        return True
    visited = set() if visited is None else visited
    if not isinstance(node, dict | list) or id(node) in visited:
        return False
    visited.add(id(node))
    return any(_any_node(child, predicate, visited) for child in _children_of(node))


def _children_of(node: dict | list) -> list[Any]:
    return node if isinstance(node, list) else [child for item in node.items() for child in item]


def _holds_key(node: Any, key: str | int) -> bool:
    if isinstance(node, dict):
        return key in node
    return isinstance(node, list) and isinstance(key, int) and key < len(node)


def _node_at(data: Any, location: Location) -> Any:
    node = data
    for key in location:
        try:
            node = node[key]
        except (KeyError, IndexError, TypeError):
            return None
    return node
