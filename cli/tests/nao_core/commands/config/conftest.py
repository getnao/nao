"""Shared fixtures for `nao config` subcommand tests."""

from __future__ import annotations

from pathlib import Path

import pytest


@pytest.fixture
def config_file(tmp_path, monkeypatch):
    """Factory that writes `nao_config.yaml` to a tmp dir and chdirs into it.

    Returns a callable: ``config_file(content: str) -> Path``.
    Default content is a minimal valid config.
    """

    def _write(content: str = "project_name: test-project\n") -> Path:
        path = tmp_path / "nao_config.yaml"
        path.write_text(content)
        monkeypatch.chdir(tmp_path)
        return path

    return _write
