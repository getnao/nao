"""Tests for `nao remove notion` command."""

import textwrap
from pathlib import Path
from unittest.mock import patch

import pytest


def _read_config(config_dir: Path) -> str:
    return (config_dir / "nao_config.yaml").read_text()


@pytest.fixture()
def config_dir(tmp_path: Path) -> Path:
    """Create a temp directory with a nao_config.yaml with two pages."""
    config = tmp_path / "nao_config.yaml"
    config.write_text(
        textwrap.dedent("""\
        project_name: test-project
        notion:
          api_key: ${{ env('NOTION_API_KEY') }}
          pages:
            - aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa
            - bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb
    """)
    )
    return tmp_path


class TestRemoveNotion:
    def test_remove_single_page(self, config_dir: Path):
        from nao_core.commands.remove.notion import notion

        with patch("nao_core.commands.remove.notion.find_config_path", return_value=config_dir / "nao_config.yaml"):
            notion(pages=["aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"], sync=False)

        content = _read_config(config_dir)
        assert "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" not in content
        assert "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb" in content

    def test_remove_page_not_found(self, config_dir: Path):
        from nao_core.commands.remove.notion import notion

        with patch("nao_core.commands.remove.notion.find_config_path", return_value=config_dir / "nao_config.yaml"):
            notion(pages=["cccccccccccccccccccccccccccccccc"], sync=False)

        content = _read_config(config_dir)
        # Nothing should be removed
        assert "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" in content
        assert "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb" in content

    def test_remove_from_url(self, config_dir: Path):
        from nao_core.commands.remove.notion import notion

        url = "https://www.notion.so/naolabs/Page-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
        with patch("nao_core.commands.remove.notion.find_config_path", return_value=config_dir / "nao_config.yaml"):
            notion(pages=[url], sync=False)

        content = _read_config(config_dir)
        assert "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" not in content

    def test_remove_invalid_id_shows_error(self, config_dir: Path):
        from nao_core.commands.remove.notion import notion

        with patch("nao_core.commands.remove.notion.find_config_path", return_value=config_dir / "nao_config.yaml"):
            notion(pages=["invalid"], sync=False)

        content = _read_config(config_dir)
        # Nothing removed
        assert "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" in content
        assert "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb" in content

    def test_env_var_template_preserved(self, config_dir: Path):
        """CRITICAL: env var references must survive the round-trip edit."""
        from nao_core.commands.remove.notion import notion

        with patch("nao_core.commands.remove.notion.find_config_path", return_value=config_dir / "nao_config.yaml"):
            notion(pages=["aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"], sync=False)

        content = _read_config(config_dir)
        assert "${{ env('NOTION_API_KEY') }}" in content

    def test_no_notion_config_shows_error(self, tmp_path: Path):
        from nao_core.commands.remove.notion import notion

        config = tmp_path / "nao_config.yaml"
        config.write_text("project_name: test-project\n")
        with patch("nao_core.commands.remove.notion.find_config_path", return_value=config):
            with patch("nao_core.commands.remove.notion.UI") as mock_ui:
                notion(pages=["aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"], sync=False)

        mock_ui.error.assert_called_once_with("No Notion configuration found.")
        # Config unchanged
        assert config.read_text() == "project_name: test-project\n"

    def test_duplicate_input_counted_once(self, config_dir: Path):
        """Passing the same page ID twice should only count as one removal."""
        from nao_core.commands.remove.notion import notion

        with patch("nao_core.commands.remove.notion.find_config_path", return_value=config_dir / "nao_config.yaml"):
            with patch("nao_core.commands.remove.notion.UI") as mock_ui:
                notion(pages=["aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"], sync=False)

        mock_ui.info.assert_called_once_with("1 page(s) removed from nao_config.yaml")

    def test_duplicate_config_entries_all_removed(self, tmp_path: Path):
        """If the config has duplicate page IDs, all copies should be removed."""
        from nao_core.commands.remove.notion import notion

        config = tmp_path / "nao_config.yaml"
        config.write_text(
            textwrap.dedent("""\
            project_name: test-project
            notion:
              api_key: test-key
              pages:
                - aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa
                - bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb
                - aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa
        """)
        )
        with patch("nao_core.commands.remove.notion.find_config_path", return_value=config):
            notion(pages=["aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"], sync=False)

        content = config.read_text()
        assert "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" not in content
        assert "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb" in content

    def test_remove_multiple_pages(self, config_dir: Path):
        from nao_core.commands.remove.notion import notion

        with patch("nao_core.commands.remove.notion.find_config_path", return_value=config_dir / "nao_config.yaml"):
            notion(pages=["aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"], sync=False)

        content = _read_config(config_dir)
        assert "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" not in content
        assert "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb" not in content

    def test_sync_runs_after_remove(self, config_dir: Path):
        from nao_core.commands.remove.notion import notion

        with patch("nao_core.commands.remove.notion.find_config_path", return_value=config_dir / "nao_config.yaml"):
            with patch("nao_core.deps._is_extra_installed", return_value=True):
                with patch("nao_core.commands.remove.notion.run_notion_sync") as mock_sync:
                    notion(pages=["aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"], sync=True)

        mock_sync.assert_called_once()
