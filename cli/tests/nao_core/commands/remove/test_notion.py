"""Tests for `nao remove notion` command."""

import textwrap
from pathlib import Path
from unittest.mock import patch

import pytest


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


def _read_config(config_dir: Path) -> str:
    return (config_dir / "nao_config.yaml").read_text()


class TestRemoveNotion:
    def test_remove_single_page(self, config_dir: Path):
        with patch("nao_core.commands.remove.notion._find_config_path", return_value=config_dir / "nao_config.yaml"):
            from nao_core.commands.remove.notion import notion

            notion(pages=["aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"])

        content = _read_config(config_dir)
        assert "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" not in content
        assert "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb" in content

    def test_remove_page_not_found(self, config_dir: Path):
        with patch("nao_core.commands.remove.notion._find_config_path", return_value=config_dir / "nao_config.yaml"):
            from nao_core.commands.remove.notion import notion

            notion(pages=["cccccccccccccccccccccccccccccccc"])

        content = _read_config(config_dir)
        # Nothing should be removed
        assert "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" in content
        assert "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb" in content

    def test_remove_from_url(self, config_dir: Path):
        url = "https://www.notion.so/naolabs/Page-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
        with patch("nao_core.commands.remove.notion._find_config_path", return_value=config_dir / "nao_config.yaml"):
            from nao_core.commands.remove.notion import notion

            notion(pages=[url])

        content = _read_config(config_dir)
        assert "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" not in content

    def test_remove_invalid_id_shows_error(self, config_dir: Path):
        with patch("nao_core.commands.remove.notion._find_config_path", return_value=config_dir / "nao_config.yaml"):
            from nao_core.commands.remove.notion import notion

            notion(pages=["invalid"])

        content = _read_config(config_dir)
        # Nothing removed
        assert "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" in content
        assert "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb" in content

    def test_env_var_template_preserved(self, config_dir: Path):
        """CRITICAL: env var references must survive the round-trip edit."""
        with patch("nao_core.commands.remove.notion._find_config_path", return_value=config_dir / "nao_config.yaml"):
            from nao_core.commands.remove.notion import notion

            notion(pages=["aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"])

        content = _read_config(config_dir)
        assert "${{ env('NOTION_API_KEY') }}" in content

    def test_no_notion_config_shows_error(self, tmp_path: Path):
        config = tmp_path / "nao_config.yaml"
        config.write_text("project_name: test-project\n")
        with patch("nao_core.commands.remove.notion._find_config_path", return_value=config):
            with patch("nao_core.commands.remove.notion.UI") as mock_ui:
                from nao_core.commands.remove.notion import notion

                notion(pages=["aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"])

        mock_ui.error.assert_called_once_with("No Notion configuration found.")
        # Config unchanged
        assert config.read_text() == "project_name: test-project\n"

    def test_duplicate_input_counted_once(self, config_dir: Path):
        """Passing the same page ID twice should only count as one removal."""
        with patch("nao_core.commands.remove.notion._find_config_path", return_value=config_dir / "nao_config.yaml"):
            with patch("nao_core.commands.remove.notion.UI") as mock_ui:
                from nao_core.commands.remove.notion import notion

                notion(pages=["aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"])

        mock_ui.info.assert_called_once_with("1 page(s) removed from nao_config.yaml")

    def test_duplicate_config_entries_all_removed(self, tmp_path: Path):
        """If the config has duplicate page IDs, all copies should be removed."""
        config = tmp_path / "nao_config.yaml"
        config.write_text(textwrap.dedent("""\
            project_name: test-project
            notion:
              api_key: test-key
              pages:
                - aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa
                - bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb
                - aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa
        """))
        with patch("nao_core.commands.remove.notion._find_config_path", return_value=config):
            from nao_core.commands.remove.notion import notion

            notion(pages=["aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"])

        content = config.read_text()
        assert "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" not in content
        assert "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb" in content

    def test_remove_multiple_pages(self, config_dir: Path):
        with patch("nao_core.commands.remove.notion._find_config_path", return_value=config_dir / "nao_config.yaml"):
            from nao_core.commands.remove.notion import notion

            notion(pages=["aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"])

        content = _read_config(config_dir)
        assert "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" not in content
        assert "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb" not in content
