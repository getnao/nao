"""Project rules and table annotations that the ai_summary prompt must stay consistent with."""

from __future__ import annotations

import re
from collections.abc import Callable
from pathlib import Path

from nao_core.commands.sync.rules_template import RulesTemplateError, render_rules_for_no_group

MAX_PROJECT_RULES_CHARS = 20_000
MAX_TABLE_ANNOTATIONS_CHARS = 10_000
TRUNCATION_NOTICE = "\n[... truncated]"

_FRONT_MATTER = re.compile(r"\A---[ \t]*\r?\n(?:.*?\r?\n)?---[ \t]*(?:\r?\n|\Z)", re.DOTALL)


def load_project_rules(project_path: Path, warn: Callable[[str], None]) -> str | None:
    """Read the RULES.md content that every user sees, bounded in size.

    Blocks wrapped in `{% if group(...) %}` are left out: ai_summary.md is readable by
    every user, so it must not be written from rules restricted to some groups. The file
    is skipped when it cannot be rendered exactly like the backend would.
    """
    rules_file = project_path / "RULES.md"
    if not rules_file.is_file():
        return None
    try:
        rules = render_shared_rules(rules_file.read_text(encoding="utf-8"))
    except (OSError, UnicodeDecodeError, RulesTemplateError) as error:
        warn(f"RULES.md not used in ai_summary prompts: {error}")
        return None
    return _bounded("RULES.md", rules, MAX_PROJECT_RULES_CHARS, warn)


def load_table_annotations(table_path: Path, warn: Callable[[str], None]) -> str | None:
    """Read the manual notes of a table, without their front matter, bounded in size."""
    annotations_file = table_path / "annotations.md"
    if not annotations_file.is_file():
        return None
    try:
        annotations = strip_front_matter(annotations_file.read_text(encoding="utf-8"))
    except (OSError, UnicodeDecodeError) as error:
        warn(f"{annotations_file} not used in the ai_summary prompt: {error}")
        return None
    return _bounded(str(annotations_file), annotations, MAX_TABLE_ANNOTATIONS_CHARS, warn)


def render_shared_rules(source: str) -> str:
    """Render RULES.md for a user in no group, rejecting any directive text left outside code fences.

    A leftover `{%` means the line was read differently than intended, so the whole file is
    rejected rather than risk sending a restricted rule.
    """
    lines = render_rules_for_no_group(source)
    for line in lines:
        if not line.fenced and "{%" in line.text:
            raise RulesTemplateError(
                f"line {line.source_line_number} has `{{%` outside a group directive or a code fence"
            )
    return "".join(line.text for line in lines)


def strip_front_matter(content: str) -> str:
    front_matter = _FRONT_MATTER.match(content)
    return content[front_matter.end() :] if front_matter else content


def _bounded(label: str, text: str, max_chars: int, warn: Callable[[str], None]) -> str | None:
    text = text.strip()
    if not text:
        return None
    if len(text) <= max_chars:
        return text
    warn(f"{label} has {len(text):,} characters; only the first {max_chars:,} are sent to the ai_summary prompt")
    return text[:max_chars] + TRUNCATION_NOTICE
