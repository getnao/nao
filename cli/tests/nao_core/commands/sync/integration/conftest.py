"""Shared fixtures for database sync integration tests."""

from pathlib import Path

import pytest
from dotenv import load_dotenv

import nao_core.templates.engine as engine_module

# Auto-load .env sitting next to this conftest so env vars are available
# before pytest collects test modules (where skipif reads them).
load_dotenv(Path(__file__).parent / ".env")


@pytest.fixture(autouse=True)
def reset_template_engine():
    """Reset the global template engine between tests."""
    engine_module._engine = None
    yield
    engine_module._engine = None
