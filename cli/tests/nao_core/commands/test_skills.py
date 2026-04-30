from unittest.mock import MagicMock, patch

import pytest

from nao_core.commands.skills import _run_npx_skills, skills


class TestSkillsCommand:
    """Tests for the `nao skills` wrapper around `npx skills`."""

    def test_exits_when_npx_is_missing(self):
        with patch("nao_core.commands.skills.shutil.which", return_value=None):
            with patch("nao_core.commands.skills.UI") as mock_ui:
                with pytest.raises(SystemExit) as exc_info:
                    skills()

        assert exc_info.value.code == 1
        mock_ui.error.assert_called_once()
        assert "npx" in mock_ui.error.call_args[0][0]

    def test_forwards_no_args_to_npx_skills(self):
        with patch("nao_core.commands.skills.shutil.which", return_value="/usr/local/bin/npx"):
            with patch("nao_core.commands.skills.subprocess.run") as mock_run:
                mock_run.return_value = MagicMock(returncode=0)
                skills()

        mock_run.assert_called_once()
        cmd = mock_run.call_args.args[0]
        assert cmd == ["npx", "--yes", "skills"]

    def test_forwards_positional_and_flag_args(self):
        with patch("nao_core.commands.skills.shutil.which", return_value="/usr/local/bin/npx"):
            with patch("nao_core.commands.skills.subprocess.run") as mock_run:
                mock_run.return_value = MagicMock(returncode=0)
                skills(["add", "getnao/nao", "-a", "claude-code", "-y"])

        cmd = mock_run.call_args.args[0]
        assert cmd == ["npx", "--yes", "skills", "add", "getnao/nao", "-a", "claude-code", "-y"]

    def test_propagates_non_zero_exit_code(self):
        with patch("nao_core.commands.skills.shutil.which", return_value="/usr/local/bin/npx"):
            with patch("nao_core.commands.skills.subprocess.run") as mock_run:
                mock_run.return_value = MagicMock(returncode=2)
                with pytest.raises(SystemExit) as exc_info:
                    skills(["list"])

        assert exc_info.value.code == 2

    def test_returns_cleanly_on_zero_exit_code(self):
        with patch("nao_core.commands.skills.shutil.which", return_value="/usr/local/bin/npx"):
            with patch("nao_core.commands.skills.subprocess.run") as mock_run:
                mock_run.return_value = MagicMock(returncode=0)
                skills(["list"])


class TestRunNpxSkills:
    """Tests for the private `_run_npx_skills` helper."""

    def test_keyboard_interrupt_maps_to_exit_130(self):
        with patch("nao_core.commands.skills.subprocess.run", side_effect=KeyboardInterrupt):
            with pytest.raises(SystemExit) as exc_info:
                _run_npx_skills(["list"])

        assert exc_info.value.code == 130

    def test_file_not_found_maps_to_exit_1(self):
        with patch("nao_core.commands.skills.UI"):
            with patch("nao_core.commands.skills.subprocess.run", side_effect=FileNotFoundError):
                with pytest.raises(SystemExit) as exc_info:
                    _run_npx_skills([])

        assert exc_info.value.code == 1
