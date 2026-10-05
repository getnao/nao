from __future__ import annotations

import sys
from pathlib import Path

import pytest

CLI_ROOT = Path(__file__).resolve().parents[1]


@pytest.fixture(scope="session")
def repo_root() -> Path:
    return CLI_ROOT.parent


# Ensure `import nao_core` resolves to the local source tree (`cli/nao_core`)
# rather than an unrelated installed distribution.
if str(CLI_ROOT) not in sys.path:
    sys.path.insert(0, str(CLI_ROOT))
