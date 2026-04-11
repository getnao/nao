"""Tests for `nao add notion` command."""

import textwrap
from pathlib import Path
from unittest.mock import patch

import pytest


@pytest.fixture()
def config_dir(tmp_path: Path) -> Path:
    """Create a temp directory with a minimal nao_config.yaml."""
    config = tmp_path / "nao_config.yaml"
    config.write_text(
        textwrap.dedent("""\
        project_name: test-project
        notion:
          api_key: ${{ env('NOTION_API_KEY') }}
          pages:
            - aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa
    """)
    )
    return tmp_path


@pytest.fixture()
def config_no_notion(tmp_path: Path) -> Path:
    """Config without notion section."""
    config = tmp_path / "nao_config.yaml"
    config.write_text(
        textwrap.dedent("""\
        project_name: test-project
    """)
    )
    return tmp_path


@pytest.fixture()
def config_notion_null(tmp_path: Path) -> Path:
    """Config with notion: null."""
    config = tmp_path / "nao_config.yaml"
    config.write_text(
        textwrap.dedent("""\
        project_name: test-project
        notion: null
    """)
    )
    return tmp_path


def _read_config(config_dir: Path) -> str:
    return (config_dir / "nao_config.yaml").read_text()


class TestAddNotion:
    def test_add_single_page(self, config_dir: Path):
        from nao_core.commands.add.notion import notion

        with patch("nao_core.commands.add.notion._find_config_path", return_value=config_dir / "nao_config.yaml"):
            with patch("nao_core.commands.add.notion._run_notion_sync"):
                notion(pages=["bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"], sync=False)

        content = _read_config(config_dir)
        assert "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb" in content

    def test_add_duplicate_skipped(self, config_dir: Path):
        with patch("nao_core.commands.add.notion._find_config_path", return_value=config_dir / "nao_config.yaml"):
            with patch("nao_core.commands.add.notion._run_notion_sync"):
                from nao_core.commands.add.notion import notion

                notion(pages=["aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"], sync=False)

        content = _read_config(config_dir)
        # Should still have exactly one occurrence
        assert content.count("aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa") == 1

    def test_add_from_url(self, config_dir: Path):
        url = "https://www.notion.so/naolabs/Page-cccccccccccccccccccccccccccccccc"
        with patch("nao_core.commands.add.notion._find_config_path", return_value=config_dir / "nao_config.yaml"):
            with patch("nao_core.commands.add.notion._run_notion_sync"):
                from nao_core.commands.add.notion import notion

                notion(pages=[url], sync=False)

        content = _read_config(config_dir)
        assert "cccccccccccccccccccccccccccccccc" in content

    def test_add_invalid_page_shows_error(self, config_dir: Path, capsys):
        with patch("nao_core.commands.add.notion._find_config_path", return_value=config_dir / "nao_config.yaml"):
            with patch("nao_core.commands.add.notion._run_notion_sync"):
                from nao_core.commands.add.notion import notion

                notion(pages=["not-valid"], sync=False)

        content = _read_config(config_dir)
        # Should not have added anything new
        assert "not-valid" not in content

    def test_add_multiple_pages(self, config_dir: Path):
        with patch("nao_core.commands.add.notion._find_config_path", return_value=config_dir / "nao_config.yaml"):
            with patch("nao_core.commands.add.notion._run_notion_sync"):
                from nao_core.commands.add.notion import notion

                notion(
                    pages=[
                        "dddddddddddddddddddddddddddddddd",
                        "eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee",
                    ],
                    sync=False,
                )

        content = _read_config(config_dir)
        assert "dddddddddddddddddddddddddddddddd" in content
        assert "eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee" in content

    def test_env_var_template_preserved(self, config_dir: Path):
        """CRITICAL: env var references must survive the round-trip edit."""
        with patch("nao_core.commands.add.notion._find_config_path", return_value=config_dir / "nao_config.yaml"):
            with patch("nao_core.commands.add.notion._run_notion_sync"):
                from nao_core.commands.add.notion import notion

                notion(pages=["bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"], sync=False)

        content = _read_config(config_dir)
        assert "${{ env('NOTION_API_KEY') }}" in content

    def test_no_config_file_shows_error(self, tmp_path: Path):
        with patch(
            "nao_core.commands.add.notion._find_config_path",
            side_effect=FileNotFoundError("No nao_config.yaml found. Run `nao init` first."),
        ):
            from nao_core.commands.add.notion import notion

            # Should not raise, just print error
            notion(pages=["aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"], sync=False)

    def test_no_notion_section_prompts_api_key(self, config_no_notion: Path):
        with patch("nao_core.commands.add.notion._find_config_path", return_value=config_no_notion / "nao_config.yaml"):
            with patch("nao_core.commands.add.notion._run_notion_sync"):
                from nao_core.commands.add.notion import notion

                notion(
                    pages=["aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"],
                    sync=False,
                    api_key="test-key-123",
                )

        content = _read_config(config_no_notion)
        assert "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" in content
        assert "test-key-123" in content

    def test_notion_null_prompts_api_key(self, config_notion_null: Path):
        with patch(
            "nao_core.commands.add.notion._find_config_path", return_value=config_notion_null / "nao_config.yaml"
        ):
            with patch("nao_core.commands.add.notion._run_notion_sync"):
                from nao_core.commands.add.notion import notion

                notion(
                    pages=["aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"],
                    sync=False,
                    api_key="test-key-456",
                )

        content = _read_config(config_notion_null)
        assert "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" in content

    def test_sync_skipped_when_extras_missing(self, config_dir: Path):
        with patch("nao_core.commands.add.notion._find_config_path", return_value=config_dir / "nao_config.yaml"):
            with patch("nao_core.deps._is_extra_installed", return_value=False):
                from nao_core.commands.add.notion import notion

                # Should not crash even with sync=True
                notion(pages=["bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"], sync=True)

        content = _read_config(config_dir)
        assert "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb" in content


class TestAddNotionMixedInput:
    def test_mix_valid_and_invalid(self, config_dir: Path):
        with patch("nao_core.commands.add.notion._find_config_path", return_value=config_dir / "nao_config.yaml"):
            with patch("nao_core.commands.add.notion._run_notion_sync"):
                from nao_core.commands.add.notion import notion

                notion(
                    pages=["bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb", "invalid", "cccccccccccccccccccccccccccccccc"],
                    sync=False,
                )

        content = _read_config(config_dir)
        assert "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb" in content
        assert "cccccccccccccccccccccccccccccccc" in content
        assert "invalid" not in content
