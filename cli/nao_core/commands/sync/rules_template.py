"""Python mirror of the RULES.md group conditionals in apps/shared/src/rules-template.ts.

It renders RULES.md for a user who belongs to no group, so the output only holds text
every user can see. It must match the backend line for line: both are checked against
apps/shared/src/rules-template.fixtures.json. Character classes are spelled out because
JavaScript and Python disagree on `\\s`, `\\d`, `.`, `trim()` and line splitting.
"""

from __future__ import annotations

import json
import re
from dataclasses import dataclass
from typing import Literal

JS_WHITESPACE = "\t\n\v\f\r                  　﻿"
_WS = "[" + "".join(f"\\u{ord(character):04x}" for character in JS_WHITESPACE) + "]"
_NOT_LINE_TERMINATOR = r"[^\n\r  ]"

_LINE = re.compile(r"[^\r\n]*(?:\r\n|\n|\r|\Z)")
_LINE_ENDING = re.compile(r"(?:\r\n|\n|\r)\Z")
_BLOCKQUOTE = re.compile(r"\A {0,3}> ?")
_LIST_ITEM = re.compile(r"\A {0,3}(?:[*+-]|[0-9]{1,9}[.)]) {1,4}")
_FENCE = re.compile(r"\A {0,3}(`{3,}|~{3,})")
_DIRECTIVE = re.compile(rf"\A\{{%-?{_WS}*({_NOT_LINE_TERMINATOR}*?){_WS}*-?%\}}\Z")
_ENDIF_PREFIX = re.compile(r"\Aendif\b", re.ASCII)
_IF_PREFIX = re.compile(r"\Aif\b", re.ASCII)
_IF_GROUP = re.compile(rf"\Aif{_WS}+group\(({_NOT_LINE_TERMINATOR}*)\)\Z")


class RulesTemplateError(ValueError):
    """RULES.md has a conditional directive the backend would reject."""


@dataclass(frozen=True)
class RenderedLine:
    text: str
    source_line_number: int
    fenced: bool


def render_rules_for_no_group(source: str) -> list[RenderedLine]:
    """Keep the lines outside every group conditional block, like the backend for a user in no group."""
    rendered: list[RenderedLine] = []
    depth = 0
    fence: _Fence | None = None

    for line_number, line in enumerate(_split_lines(source), start=1):
        line_body = _LINE_ENDING.sub("", line)
        container_line = _parse_container_line(line_body)

        if fence is not None:
            if _is_closing_fence(line_body, fence):
                fence = None
            if depth == 0:
                rendered.append(RenderedLine(line, line_number, fenced=True))
            continue

        fence = _parse_fence_marker(container_line)
        if fence is not None:
            if depth == 0:
                rendered.append(RenderedLine(line, line_number, fenced=True))
            continue

        directive = _parse_directive(container_line.content)
        if directive is None:
            if depth == 0:
                rendered.append(RenderedLine(line, line_number, fenced=False))
        elif directive == "endif":
            if depth == 0:
                raise RulesTemplateError("RULES.md contains an unmatched endif directive.")
            depth -= 1
        else:
            depth += 1

    if depth > 0:
        raise RulesTemplateError("RULES.md contains a conditional block without a matching endif directive.")
    return rendered


@dataclass(frozen=True)
class _Container:
    kind: Literal["blockquote", "list"]
    continuation_indent: int = 0


@dataclass(frozen=True)
class _ContainerLine:
    content: str
    containers: tuple[_Container, ...]


@dataclass(frozen=True)
class _Fence:
    character: str
    length: int
    containers: tuple[_Container, ...]


def _split_lines(source: str) -> list[str]:
    return [line for line in _LINE.findall(source) if line]


def _parse_container_line(line: str) -> _ContainerLine:
    content = _expand_markdown_tabs(line)
    containers: list[_Container] = []
    while True:
        blockquote = _BLOCKQUOTE.match(content)
        if blockquote:
            content = content[blockquote.end() :]
            containers.append(_Container("blockquote"))
            continue
        list_item = _LIST_ITEM.match(content)
        if list_item:
            content = content[list_item.end() :]
            containers.append(_Container("list", continuation_indent=list_item.end()))
            continue
        return _ContainerLine(content, tuple(containers))


def _parse_fence_marker(line: _ContainerLine) -> _Fence | None:
    match = _FENCE.match(line.content)
    if not match:
        return None
    marker = match.group(1)
    return _Fence(character=marker[0], length=len(marker), containers=line.containers)


def _is_closing_fence(line: str, fence: _Fence) -> bool:
    content = _strip_containers(line, fence.containers)
    if content is None:
        return False
    marker = re.escape(fence.character * fence.length)
    character = re.escape(fence.character)
    return re.match(rf"\A {{0,3}}{marker}{character}* *\Z", content) is not None


def _strip_containers(line: str, containers: tuple[_Container, ...]) -> str | None:
    content = _expand_markdown_tabs(line)
    for container in containers:
        if container.kind == "blockquote":
            blockquote = _BLOCKQUOTE.match(content)
            if not blockquote:
                return None
            content = content[blockquote.end() :]
            continue
        indentation = " " * container.continuation_indent
        if not content.startswith(indentation):
            return None
        content = content[len(indentation) :]
    return content


def _expand_markdown_tabs(line: str) -> str:
    expanded: list[str] = []
    column = 0
    for character in line:
        if character == "\t":
            spaces = 4 - (column % 4)
            expanded.append(" " * spaces)
            column += spaces
            continue
        expanded.append(character)
        column += 1
    return "".join(expanded)


def _parse_directive(line: str) -> Literal["if", "endif"] | None:
    trimmed = line.strip(JS_WHITESPACE)
    if not trimmed.startswith("{%"):
        return None

    tag = _DIRECTIVE.match(trimmed)
    if not tag:
        raise RulesTemplateError("RULES.md contains an unsupported or malformed conditional directive.")

    body = tag.group(1).strip(JS_WHITESPACE)
    if body == "endif":
        return "endif"
    if _ENDIF_PREFIX.match(body):
        raise RulesTemplateError("RULES.md contains a malformed endif directive.")
    if not _IF_PREFIX.match(body):
        raise RulesTemplateError("RULES.md contains an unsupported or malformed conditional directive.")

    group_condition = _IF_GROUP.match(body)
    if not group_condition:
        raise RulesTemplateError("RULES.md contains an unsupported or malformed conditional directive.")
    _validate_group_names(group_condition.group(1))
    return "if"


def _validate_group_names(arguments: str) -> None:
    position = 0
    group_count = 0
    while position < len(arguments):
        position = _skip_whitespace(arguments, position)
        if position >= len(arguments) or arguments[position] != '"':
            raise RulesTemplateError("RULES.md group names must be double-quoted strings.")

        end = _find_string_end(arguments, position)
        try:
            group_name = json.loads(arguments[position : end + 1])
        except ValueError as error:
            raise RulesTemplateError("RULES.md contains an invalid group name.") from error
        if not isinstance(group_name, str) or not group_name:
            raise RulesTemplateError("RULES.md group names cannot be empty.")
        group_count += 1
        position = _skip_whitespace(arguments, end + 1)

        if position == len(arguments):
            break
        if arguments[position] != ",":
            raise RulesTemplateError("RULES.md group names must be separated by commas.")
        position = _skip_whitespace(arguments, position + 1)
        if position == len(arguments):
            raise RulesTemplateError("RULES.md contains a trailing group name separator.")

    if group_count == 0:
        raise RulesTemplateError("RULES.md group conditions require at least one group name.")


def _find_string_end(source: str, start: int) -> int:
    escaped = False
    for position in range(start + 1, len(source)):
        character = source[position]
        if escaped:
            escaped = False
        elif character == "\\":
            escaped = True
        elif character == '"':
            return position
    raise RulesTemplateError("RULES.md contains an unterminated group name.")


def _skip_whitespace(source: str, start: int) -> int:
    position = start
    while position < len(source) and source[position] in JS_WHITESPACE:
        position += 1
    return position
