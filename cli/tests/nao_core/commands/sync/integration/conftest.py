"""Shared fixtures for database sync integration tests."""

import sys
from pathlib import Path

# Ensure the CLI project root is on the path so nao_core is importable when run via uv run pytest
_cli_root = Path(__file__).resolve().parents[5]
if str(_cli_root) not in sys.path:
    sys.path.insert(0, str(_cli_root))

import pytest  # noqa: E402
from dotenv import load_dotenv  # noqa: E402
from rich.progress import Progress  # noqa: E402

import nao_core.templates.engine as engine_module  # noqa: E402
from nao_core.commands.sync.providers.databases.provider import sync_database  # noqa: E402

# Auto-load .env sitting next to this conftest so env vars are available
# before pytest collects test modules (where skipif reads them).
load_dotenv(Path(__file__).parent / ".env")


@pytest.fixture(autouse=True)
def reset_template_engine():
    """Reset the global template engine between tests."""
    engine_module._engine = None
    yield
    engine_module._engine = None


@pytest.fixture(scope="module")
def synced(tmp_path_factory, db_config):
    """Run sync once for the whole module and return (state, output_path, config)."""
    output = tmp_path_factory.mktemp(f"{db_config.type}_sync")

    with Progress(transient=True) as progress:
        state = sync_database(db_config, output, progress)

    return state, output, db_config
