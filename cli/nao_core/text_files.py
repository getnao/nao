"""Text file I/O that behaves the same on every platform.

Python opens text files with the locale encoding by default (cp1252 on
Windows), which breaks on non-ASCII data. nao-core always writes UTF-8 and
reads UTF-8, falling back to the locale encoding for files that older
versions wrote on Windows.
"""

import locale
from pathlib import Path

ENCODING = "utf-8"


def read_text(path: Path) -> str:
    """Read a text file as UTF-8, or with the locale encoding if it is not valid UTF-8."""
    try:
        return path.read_text(encoding=ENCODING)
    except UnicodeDecodeError:
        return path.read_text(encoding=locale.getpreferredencoding(False))
