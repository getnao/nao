import ast
import locale
from pathlib import Path

import pytest

from nao_core.text_files import read_text

NAO_CORE = Path(__file__).resolve().parents[2] / "nao_core"
# Modules whose `.open()` is not a text file open.
NON_FILE_OPENERS = {"webbrowser", "tarfile", "zipfile", "gzip", "os", "io", "subprocess", "urllib"}


def _constant(node: ast.expr | None) -> object:
    return node.value if isinstance(node, ast.Constant) else None


def _is_binary_mode(call: ast.Call, mode_index: int) -> bool:
    mode = _constant(call.args[mode_index]) if len(call.args) > mode_index else None
    for keyword in call.keywords:
        if keyword.arg == "mode":
            mode = _constant(keyword.value)
    return isinstance(mode, str) and "b" in mode


def _declares_encoding(call: ast.Call) -> bool:
    return any(keyword.arg == "encoding" and _constant(keyword.value) is not None for keyword in call.keywords)


def _unsafe_text_io(source: str) -> list[int]:
    """Line numbers of text file reads/writes that rely on the locale encoding."""
    lines = []
    for node in ast.walk(ast.parse(source)):
        if not isinstance(node, ast.Call) or _declares_encoding(node):
            continue
        func = node.func
        if isinstance(func, ast.Attribute) and func.attr in {"read_text", "write_text"}:
            lines.append(node.lineno)
        elif isinstance(func, ast.Name) and func.id == "open" and not _is_binary_mode(node, mode_index=1):
            lines.append(node.lineno)
        elif isinstance(func, ast.Attribute) and func.attr == "open":
            receiver = func.value
            if isinstance(receiver, ast.Name) and receiver.id in NON_FILE_OPENERS:
                continue
            if not _is_binary_mode(node, mode_index=0):
                lines.append(node.lineno)
    return lines


def test_nao_core_never_relies_on_the_locale_encoding():
    offenders = [
        f"{path.relative_to(NAO_CORE.parent)}:{line}"
        for path in sorted(NAO_CORE.rglob("*.py"))
        if path.name != "text_files.py"
        for line in _unsafe_text_io(path.read_text(encoding="utf-8"))
    ]
    assert not offenders, "Text file I/O without an explicit encoding:\n" + "\n".join(offenders)


@pytest.mark.parametrize(
    ("source", "unsafe"),
    [
        ('Path("notes.md").open("w")', True),
        ('self.path.open("w")', True),
        ("open(path, encoding=None)", True),
        ("path.read_text()", True),
        ("path.write_text(content, encoding=None)", True),
        ('open(path, "rb")', False),
        ('path.open(mode="wb")', False),
        ('path.write_text(content, encoding="utf-8")', False),
        ("webbrowser.open(url)", False),
        ("tarfile.open(archive)", False),
    ],
)
def test_guard_flags_locale_encoded_text_io(source: str, unsafe: bool):
    assert bool(_unsafe_text_io(source)) is unsafe


def test_read_text_reads_utf8(tmp_path: Path):
    path = tmp_path / "products.md"
    path.write_text("Particle Size 71μm", encoding="utf-8")

    assert read_text(path) == "Particle Size 71μm"


def test_read_text_falls_back_to_the_locale_encoding(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setattr(locale, "getpreferredencoding", lambda do_setlocale=True: "cp1252")
    path = tmp_path / "nao_config.yaml"
    path.write_bytes("project_name: café\n".encode("cp1252"))

    assert read_text(path) == "project_name: café\n"
