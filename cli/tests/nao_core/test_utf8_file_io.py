"""Guard: every text file read/write in nao_core must pass encoding="utf-8".

Without it Python uses the locale encoding (cp1252 on Windows) and `nao sync`
crashes on non-ASCII data such as "μ" (getnao/nao#2674).
"""

import ast
from pathlib import Path

NAO_CORE = Path(__file__).resolve().parents[2] / "nao_core"
TEXT_METHODS = {"read_text", "write_text"}
BINARY_MODES = {"rb", "wb", "ab", "r+b", "w+b"}


def _has_encoding(call: ast.Call) -> bool:
    return any(keyword.arg == "encoding" for keyword in call.keywords)


def _is_binary_open(call: ast.Call, mode_index: int) -> bool:
    mode = None
    if len(call.args) > mode_index and isinstance(call.args[mode_index], ast.Constant):
        mode = call.args[mode_index].value
    for keyword in call.keywords:
        if keyword.arg == "mode" and isinstance(keyword.value, ast.Constant):
            mode = keyword.value.value
    return isinstance(mode, str) and "b" in mode


def _offending_calls(tree: ast.AST) -> list[int]:
    lines = []
    for node in ast.walk(tree):
        if not isinstance(node, ast.Call) or _has_encoding(node):
            continue
        func = node.func
        if isinstance(func, ast.Attribute) and func.attr in TEXT_METHODS:
            lines.append(node.lineno)
        elif isinstance(func, ast.Name) and func.id == "open":
            if not _is_binary_open(node, mode_index=1):
                lines.append(node.lineno)
        elif isinstance(func, ast.Attribute) and func.attr == "open" and isinstance(func.value, ast.Name):
            # Path.open(mode) style; skip modules like webbrowser/tarfile/os.
            if func.value.id in {"webbrowser", "tarfile", "os", "io", "gzip", "zipfile"}:
                continue
            if not _is_binary_open(node, mode_index=0):
                lines.append(node.lineno)
    return lines


def test_text_file_io_declares_utf8_encoding():
    offenders = []
    for path in sorted(NAO_CORE.rglob("*.py")):
        tree = ast.parse(path.read_text(encoding="utf-8"))
        offenders += [f"{path.relative_to(NAO_CORE.parent)}:{line}" for line in _offending_calls(tree)]
    assert not offenders, "Text file I/O without encoding='utf-8':\n" + "\n".join(offenders)
