"""Unit tests for the Obsidian template provider."""

from pathlib import Path
from unittest.mock import MagicMock

import pytest

from nao_core.templates.context import NaoContext, ObsidianProvider


@pytest.fixture()
def provider(tmp_path: Path) -> ObsidianProvider:
    notes_dir = tmp_path / "docs" / "obsidian" / "Projects"
    notes_dir.mkdir(parents=True)
    (notes_dir / "roadmap.md").write_text("---\nstatus: draft\n---\n\n# Roadmap", encoding="utf-8")
    return ObsidianProvider(tmp_path)


def test_note_exposes_content_and_metadata(provider: ObsidianProvider):
    note = provider.note("Projects/roadmap.md")

    assert note.path == "Projects/roadmap.md"
    assert note.title == "roadmap"
    assert note.frontmatter == {"status": "draft"}
    assert str(note).endswith("# Roadmap")


def test_note_missing_raises(provider: ObsidianProvider):
    with pytest.raises(FileNotFoundError, match="Obsidian note not found"):
        _ = provider.note("Missing.md").content


def test_note_rejects_path_traversal(provider: ObsidianProvider):
    with pytest.raises(ValueError, match="Path traversal is not allowed"):
        _ = provider.note("../../nao_config.yaml").content


def test_nao_context_obsidian_without_project_path():
    ctx = NaoContext(MagicMock(), project_path=None)

    with pytest.raises(RuntimeError, match="Obsidian note reading requires a project path"):
        _ = ctx.obsidian
