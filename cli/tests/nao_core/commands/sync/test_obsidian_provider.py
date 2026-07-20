"""Unit tests for the Obsidian sync provider."""

from pathlib import Path

import pytest

from nao_core.commands.sync.providers.obsidian.provider import ObsidianSyncProvider
from nao_core.config.obsidian import ObsidianConfig


def test_sync_notes_preserves_directory_structure(tmp_path: Path):
    vault_path = tmp_path / "vault"
    (vault_path / "Projects").mkdir(parents=True)
    (vault_path / "Projects" / "roadmap.md").write_text("# Roadmap", encoding="utf-8")
    (vault_path / "Inbox.md").write_text("# Inbox", encoding="utf-8")

    provider = ObsidianSyncProvider()
    config = ObsidianConfig(path=str(vault_path))

    result = provider.sync([config], tmp_path / "output")

    assert result.items_synced == 2
    assert (tmp_path / "output" / "Projects" / "roadmap.md").read_text(encoding="utf-8") == "# Roadmap"
    assert (tmp_path / "output" / "Inbox.md").read_text(encoding="utf-8") == "# Inbox"


def test_sync_notes_ignores_obsidian_metadata(tmp_path: Path):
    vault_path = tmp_path / "vault"
    (vault_path / ".obsidian").mkdir(parents=True)
    (vault_path / ".obsidian" / "workspace.md").write_text("# Hidden", encoding="utf-8")
    (vault_path / "Visible.md").write_text("# Visible", encoding="utf-8")

    provider = ObsidianSyncProvider()
    config = ObsidianConfig(path=str(vault_path))

    result = provider.sync([config], tmp_path / "output")

    assert result.items_synced == 1
    assert (tmp_path / "output" / "Visible.md").exists()
    assert not (tmp_path / "output" / ".obsidian" / "workspace.md").exists()


def test_sync_notes_removes_stale_files(tmp_path: Path):
    vault_path = tmp_path / "vault"
    vault_path.mkdir()
    (vault_path / "Current.md").write_text("# Current", encoding="utf-8")

    output_path = tmp_path / "output"
    (output_path / "Old.md").parent.mkdir(parents=True, exist_ok=True)
    (output_path / "Old.md").write_text("# Old", encoding="utf-8")

    provider = ObsidianSyncProvider()
    config = ObsidianConfig(path=str(vault_path))

    result = provider.sync([config], output_path)

    assert result.items_synced == 1
    assert not (output_path / "Old.md").exists()
    assert (output_path / "Current.md").exists()


def test_sync_notes_requires_existing_directory(tmp_path: Path):
    provider = ObsidianSyncProvider()
    config = ObsidianConfig(path=str(tmp_path / "missing"))

    with pytest.raises(FileNotFoundError, match="Obsidian vault path does not exist"):
        provider.sync([config], tmp_path / "output")
