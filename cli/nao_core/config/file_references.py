"""`from_file` references, which let a value of nao_config.yaml live in another file of the project.

    databases:
      - name: warehouse
        include:
          from_file: repos/business_context/nao/warehouse_tables.yml

The mapping is replaced by the parsed content of the file before the config is validated. The file is
plain data: it cannot hold secret references or other `from_file` references.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import yaml

from .repos.base import normalize_relative_path
from .secrets import contains_secret_reference

FILE_REFERENCE_KEY = "from_file"

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

    def restore(self, data: Any) -> None:
        for location, file in self.files.items():
            parent = _node_at(data, location[:-1])
            key = location[-1]
            reference = {FILE_REFERENCE_KEY: file}
            if isinstance(parent, dict):
                parent[key] = reference
            elif isinstance(parent, list) and isinstance(key, int) and location in self.missing:
                parent.insert(key, reference)
            elif isinstance(parent, list) and isinstance(key, int) and key < len(parent):
                parent[key] = reference


def resolve_file_references(
    data: Any, project_path: Path, *, allow_missing: bool = False
) -> tuple[Any, FileReferences]:
    """Replaces every reference found in *data* by the content of its file.

    A file that does not exist fails the load, as a value left out would fall back to its default
    and an empty `include` means every table. With allow_missing=True the value is left out instead,
    for the commands that run before the repositories holding these files are synced.
    """
    if is_file_reference(data):
        raise ValueError(f"nao_config.yaml cannot be a single {FILE_REFERENCE_KEY} reference")

    references = FileReferences()
    resolved = _resolve_node(data, (), project_path, references)
    if references.missing and not allow_missing:
        raise ValueError(
            f"{FILE_REFERENCE_KEY} {', '.join(repr(file) for file in references.missing_files)} does not exist. "
            "If it comes from a synced repository, run `nao sync -p repos` first."
        )
    return resolved, references


def is_file_reference(node: Any) -> bool:
    return isinstance(node, dict) and list(node) == [FILE_REFERENCE_KEY] and isinstance(node[FILE_REFERENCE_KEY], str)


def _resolve_node(node: Any, location: Location, project_path: Path, references: FileReferences) -> Any:
    if is_file_reference(node):
        file = node[FILE_REFERENCE_KEY]
        references.files[location] = file
        content = _read_referenced_file(project_path, file)
        if content is _MISSING:
            references.missing.add(location)
        return content

    if isinstance(node, dict):
        resolved = {
            key: _resolve_node(child, (*location, key), project_path, references) for key, child in node.items()
        }
        return {key: child for key, child in resolved.items() if child is not _MISSING}

    if isinstance(node, list):
        children = [
            _resolve_node(child, (*location, index), project_path, references) for index, child in enumerate(node)
        ]
        return [child for child in children if child is not _MISSING]

    return node


def _read_referenced_file(project_path: Path, file: str) -> Any:
    project_root = project_path.resolve()
    file_path = (project_root / normalize_relative_path(file, FILE_REFERENCE_KEY)).resolve()
    if not file_path.is_relative_to(project_root):
        raise ValueError(f"{FILE_REFERENCE_KEY} '{file}' points outside the project")
    if not file_path.is_file():
        return _MISSING

    content = file_path.read_text()
    if contains_secret_reference(content):
        raise ValueError(
            f"{FILE_REFERENCE_KEY} '{file}' holds a secret reference such as {{{{ env('NAME') }}}}, "
            "which only nao_config.yaml itself can use"
        )

    try:
        value = yaml.safe_load(content)
    except yaml.YAMLError as error:
        raise ValueError(f"{FILE_REFERENCE_KEY} '{file}' is not valid YAML: {error}") from error

    if _holds_file_reference(value):
        raise ValueError(
            f"{FILE_REFERENCE_KEY} '{file}' holds another {FILE_REFERENCE_KEY} reference, which is not supported"
        )
    return value


def _holds_file_reference(node: Any) -> bool:
    if is_file_reference(node):
        return True
    children = node.values() if isinstance(node, dict) else node if isinstance(node, list) else ()
    return any(_holds_file_reference(child) for child in children)


def _node_at(data: Any, location: Location) -> Any:
    node = data
    for key in location:
        try:
            node = node[key]
        except (KeyError, IndexError, TypeError):
            return None
    return node
