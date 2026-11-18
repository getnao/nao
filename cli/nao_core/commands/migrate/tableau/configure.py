import json
from typing import cast

import yaml
from yaml.nodes import MappingNode, ScalarNode

from nao_core.config import resolve_project_path
from nao_core.config.tableau import TableauConfig
from nao_core.ui import UI, ask_text


def configure() -> None:
    project_path = resolve_project_path()
    config_path = project_path / "nao_config.yaml"

    if not config_path.exists():
        raise ValueError(f"No nao_config.yaml found in {project_path}")

    tableau = TableauConfig(
        server=cast(str, ask_text("Tableau server URL:", required_field=True)),
        site_name=ask_text("Tableau site name:", default="") or "",
        pat_name=cast(str, ask_text("Personal access token name:", required_field=True)),
        pat_value=cast(
            str,
            ask_text(
                "Personal access token secret:",
                password=True,
                required_field=True,
            ),
        ),
        api_version=ask_text("Tableau API version:", default="3.21") or "3.21",
    )

    config_path.write_text(update_tableau_section(config_path.read_text(), tableau))

    UI.success("Saved Tableau configuration to nao_config.yaml")
    UI.warn("nao_config.yaml contains a plaintext Tableau secret. Do not commit it.")


def update_tableau_section(source: str, tableau: TableauConfig) -> str:
    values = tableau.model_dump()
    block = yaml.safe_dump({"tableau": values}, sort_keys=False)
    root = yaml.compose(source)
    if root is None:
        separator = "" if not source or source.endswith("\n") else "\n"
        return f"{source}{separator}{block}"
    if not isinstance(root, MappingNode):
        raise ValueError("nao_config.yaml must contain a top-level mapping.")

    sections = [(key, value) for key, value in root.value if isinstance(key, ScalarNode) and key.value == "tableau"]
    if not sections:
        separator = "" if source.endswith("\n") else "\n"
        return f"{source}{separator}{block}"
    if len(sections) > 1:
        raise ValueError("nao_config.yaml contains multiple tableau sections.")

    _, section = sections[0]
    if not isinstance(section, MappingNode) or section.flow_style:
        replacement = json.dumps(values, ensure_ascii=False)
        if section.start_mark.index == section.end_mark.index:
            replacement = f" {replacement}"
        return f"{source[: section.start_mark.index]}{replacement}{source[section.end_mark.index :]}"

    edits: list[tuple[int, int, str]] = []
    existing: set[str] = set()
    for key, value in section.value:
        if not isinstance(key, ScalarNode) or key.value not in values:
            continue
        if key.value in existing:
            raise ValueError(f"nao_config.yaml contains duplicate tableau.{key.value} values.")
        existing.add(key.value)
        edits.append(
            (
                value.start_mark.index,
                value.end_mark.index,
                json.dumps(values[key.value], ensure_ascii=False),
            )
        )

    missing = [key for key in values if key not in existing]
    if missing:
        last_value = section.value[-1][1]
        line_end = source.find("\n", last_value.end_mark.index)
        insertion = len(source) if line_end == -1 else line_end + 1
        indent = " " * (section.value[0][0].start_mark.column if section.value else 2)
        addition = "".join(f"{indent}{key}: {json.dumps(values[key], ensure_ascii=False)}\n" for key in missing)
        edits.append((insertion, insertion, addition))

    for start, end, replacement in sorted(edits, reverse=True):
        source = f"{source[:start]}{replacement}{source[end:]}"
    return source
