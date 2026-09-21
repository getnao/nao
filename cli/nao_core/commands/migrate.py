"""Rewrite nao_config.yaml to the latest configuration shape."""

from typing import Annotated

from cyclopts import Parameter

from nao_core.config import resolve_project_path
from nao_core.config.llm import ProviderConfig
from nao_core.tracking import track_command
from nao_core.ui import UI

MODELS_HINT = (
    "# models:",
    "# - id: your-model-id",
    "#   costs:  # US dollars per million tokens",
    "#     input_no_cache: 3",
    "#     input_cache_read: 0.3",
    "#     input_cache_write: 3.75",
    "#     output: 15",
)


@track_command("migrate")
def migrate(
    dry_run: Annotated[bool, Parameter(name=["--dry-run"])] = False,
):
    """Rewrite nao_config.yaml to the latest configuration shape.

    Moves a single inline `llm` provider under `llm.providers`, so that several providers,
    their models and each model's costs can be configured.

    Parameters
    ----------
    dry_run : bool
        Print the migrated file instead of writing it.
    """
    config_path = resolve_project_path() / "nao_config.yaml"
    if not config_path.exists():
        UI.error(f"No nao_config.yaml found in {config_path.parent}")
        return

    content = config_path.read_text()
    migrated = migrate_llm_block(content)

    if migrated is None:
        UI.success("nao_config.yaml is already using the latest shape")
        return

    if dry_run:
        UI.print(migrated)
        return

    config_path.write_text(migrated)
    UI.success(f"Migrated the `llm` block of {config_path}")
    UI.info(
        "Costs declared under the deprecated `llm.meta` apply to every model. Move them to the "
        "matching entry under a provider's `models` to price each model separately."
    )


def migrate_llm_block(content: str) -> str | None:
    """Nest a legacy single-provider `llm` block into an `llm.providers` list.

    Rewrites the file as text so that comments and `{{ env(...) }}` placeholders survive.
    Returns None when the file already uses the current shape.
    """
    lines = content.splitlines()
    block = _find_block(lines, "llm")
    if not block:
        return None

    start, end = block
    block_lines = lines[start + 1 : end]
    indent = _property_indent(block_lines)
    if indent is None:
        return None

    groups = _group_by_key(block_lines, indent)
    provider_groups = [group for group in groups if group[0] in ProviderConfig.model_fields]
    if not any(key == "provider" for key, _ in provider_groups):
        return None

    other_groups = [group for group in groups if group[0] not in ProviderConfig.model_fields]

    migrated = [
        *lines[: start + 1],
        f"{' ' * indent}providers:",
        *_render_provider(provider_groups, indent),
        *(line for _, group_lines in other_groups for line in group_lines),
        *lines[end:],
    ]

    trailing_newline = "\n" if content.endswith("\n") else ""
    return "\n".join(migrated) + trailing_newline


def _find_block(lines: list[str], key: str) -> tuple[int, int] | None:
    """Return the start and end line indices of a top-level mapping key's block."""
    start = next((i for i, line in enumerate(lines) if _is_top_level_key(line, key)), None)
    if start is None:
        return None

    end = start + 1
    while end < len(lines) and (not lines[end].strip() or _indent_width(lines[end]) > 0):
        end += 1

    # Blank lines after the block belong to whatever follows it.
    while end > start + 1 and not lines[end - 1].strip():
        end -= 1

    return (start, end) if end > start + 1 else None


def _is_top_level_key(line: str, key: str) -> bool:
    prefix = f"{key}:"
    if not line.startswith(prefix):
        return False

    suffix = line[len(prefix) :]
    return not suffix.strip() or (suffix[0].isspace() and suffix.lstrip().startswith("#"))


def _group_by_key(block: list[str], indent: int) -> list[tuple[str, list[str]]]:
    """Split a mapping block into one group per key, keeping nested lines and comments attached."""
    groups: list[tuple[str, list[str]]] = []
    pending: list[str] = []

    for line in block:
        stripped = line.strip()
        is_key = stripped and not stripped.startswith("#") and _indent_width(line) == indent and ":" in stripped

        if is_key:
            groups.append((stripped.split(":", 1)[0], [*pending, line]))
            pending = []
        elif groups and not pending:
            groups[-1][1].append(line)
        else:
            pending.append(line)

    if pending and groups:
        groups[-1][1].extend(pending)
    return groups


def _property_indent(block: list[str]) -> int | None:
    property_line = next(
        (line for line in block if line.strip() and not line.lstrip().startswith("#")),
        None,
    )
    return _indent_width(property_line) if property_line is not None else None


def _render_provider(groups: list[tuple[str, list[str]]], indent: int) -> list[str]:
    """Render provider keys as the first item of the `providers` list."""
    rendered: list[str] = []
    awaiting_dash = True

    for _, group_lines in groups:
        for line in group_lines:
            stripped = line.strip()
            if not stripped:
                rendered.append(line)
            elif awaiting_dash and stripped.startswith("#"):
                rendered.append(f"{' ' * (indent + 2)}{stripped}")
            elif awaiting_dash:
                rendered.append(f"{' ' * indent}- {stripped}")
                awaiting_dash = False
            else:
                rendered.append(f"  {line}")

    rendered.extend(f"{' ' * (indent + 2)}{hint}" for hint in MODELS_HINT)
    return rendered


def _indent_width(line: str) -> int:
    return len(line) - len(line.lstrip())
