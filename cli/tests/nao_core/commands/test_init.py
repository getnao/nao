"""Unit tests for the init command."""

from pathlib import Path
from unittest.mock import MagicMock, patch

import pytest

from nao_core.commands.init import (
    CreatedFile,
    EmptyApiKeyError,
    EmptyProjectNameError,
    ProjectExistsError,
    create_empty_structure,
    setup_project_name,
)
from nao_core.config.exceptions import InitError


class TestExceptions:
    """Tests for init command exceptions."""

    def test_empty_project_name_error_message(self):
        """EmptyProjectNameError has correct message."""
        error = EmptyProjectNameError()
        assert str(error) == "Project name cannot be empty."

    def test_project_exists_error_message(self):
        """ProjectExistsError includes project name in message."""
        error = ProjectExistsError("my-project")
        assert error.project_name == "my-project"
        assert "my-project" in str(error)
        assert "already exists" in str(error)

    def test_empty_api_key_error_message(self):
        """EmptyApiKeyError has correct message."""
        error = EmptyApiKeyError()
        assert str(error) == "API key cannot be empty."

    def test_exceptions_inherit_from_init_error(self):
        """All custom exceptions inherit from InitError."""
        assert isinstance(EmptyProjectNameError(), InitError)
        assert isinstance(ProjectExistsError("test"), InitError)
        assert isinstance(EmptyApiKeyError(), InitError)


class TestCreatedFile:
    """Tests for CreatedFile dataclass."""

    def test_created_file_with_content(self):
        """CreatedFile stores path and content."""
        file = CreatedFile(path=Path("test.md"), content="# Test")
        assert file.path == Path("test.md")
        assert file.content == "# Test"

    def test_created_file_without_content(self):
        """CreatedFile can have None content."""
        file = CreatedFile(path=Path("empty.txt"), content=None)
        assert file.path == Path("empty.txt")
        assert file.content is None


class TestCreateEmptyStructure:
    """Tests for create_empty_structure function."""

    def test_creates_expected_folders(self, tmp_path: Path):
        """Creates all expected project folders."""
        folders, files = create_empty_structure(tmp_path)

        expected_folders = [
            "databases",
            "queries",
            "docs",
            "semantics",
            "repos",
            "agent/tools",
            "agent/mcps",
        ]

        for folder in expected_folders:
            assert (tmp_path / folder).exists()
            assert (tmp_path / folder).is_dir()

        assert set(folders) == set(expected_folders)

    def test_creates_rules_md_file(self, tmp_path: Path):
        """Creates RULES.md file."""
        folders, files = create_empty_structure(tmp_path)

        rules_file = tmp_path / "RULES.md"
        assert rules_file.exists()
        assert rules_file.is_file()

    def test_creates_naoignore_file(self, tmp_path: Path):
        """Creates .naoignore file with templates/ entry."""
        folders, files = create_empty_structure(tmp_path)

        naoignore_file = tmp_path / ".naoignore"
        assert naoignore_file.exists()
        content = naoignore_file.read_text()
        assert "templates/" in content

    def test_returns_created_files_list(self, tmp_path: Path):
        """Returns list of created files."""
        folders, files = create_empty_structure(tmp_path)

        assert len(files) >= 2
        file_paths = [f.path for f in files]
        assert Path("RULES.md") in file_paths
        assert Path(".naoignore") in file_paths

    def test_creates_nested_folders(self, tmp_path: Path):
        """Creates nested folder structures like agent/tools."""
        create_empty_structure(tmp_path)

        assert (tmp_path / "agent").exists()
        assert (tmp_path / "agent" / "tools").exists()
        assert (tmp_path / "agent" / "mcps").exists()

    def test_idempotent_on_existing_folders(self, tmp_path: Path):
        """Does not fail if folders already exist."""
        # Create structure once
        create_empty_structure(tmp_path)
        # Create again - should not raise
        folders, files = create_empty_structure(tmp_path)

        assert len(folders) > 0


class TestSetupProjectName:
    """Tests for setup_project_name function."""

    @patch("nao_core.commands.init.Prompt.ask")
    def test_creates_new_project_folder(self, mock_prompt, tmp_path: Path, monkeypatch):
        """Creates project folder when it doesn't exist."""
        monkeypatch.chdir(tmp_path)
        mock_prompt.return_value = "new-project"

        name, path = setup_project_name()

        assert name == "new-project"
        assert path.name == "new-project"
        assert path.exists()

    @patch("nao_core.commands.init.Prompt.ask")
    def test_raises_on_empty_project_name(self, mock_prompt, tmp_path: Path, monkeypatch):
        """Raises EmptyProjectNameError when name is empty."""
        monkeypatch.chdir(tmp_path)
        mock_prompt.return_value = ""

        with pytest.raises(EmptyProjectNameError):
            setup_project_name()

    @patch("nao_core.commands.init.Prompt.ask")
    def test_raises_on_existing_folder_without_force(self, mock_prompt, tmp_path: Path, monkeypatch):
        """Raises ProjectExistsError when folder exists and force=False."""
        monkeypatch.chdir(tmp_path)
        (tmp_path / "existing-project").mkdir()
        mock_prompt.return_value = "existing-project"

        with pytest.raises(ProjectExistsError) as exc_info:
            setup_project_name(force=False)

        assert exc_info.value.project_name == "existing-project"

    @patch("nao_core.commands.init.Prompt.ask")
    def test_allows_existing_folder_with_force(self, mock_prompt, tmp_path: Path, monkeypatch):
        """Allows existing folder when force=True."""
        monkeypatch.chdir(tmp_path)
        (tmp_path / "existing-project").mkdir()
        mock_prompt.return_value = "existing-project"

        name, path = setup_project_name(force=True)

        assert name == "existing-project"
        assert path.exists()

    @patch("nao_core.commands.init.Confirm.ask")
    @patch("nao_core.commands.init.NaoConfig.try_load")
    def test_reinitializes_existing_project(self, mock_try_load, mock_confirm, tmp_path: Path, monkeypatch):
        """Can re-initialize an existing project with config."""
        monkeypatch.chdir(tmp_path)

        # Create existing config file
        (tmp_path / "nao_config.yaml").write_text("project_name: existing\n")

        mock_config = MagicMock()
        mock_config.project_name = "existing"
        mock_try_load.return_value = mock_config
        mock_confirm.return_value = True

        name, path = setup_project_name()

        assert name == "existing"
        assert path == tmp_path

    @patch("nao_core.commands.init.Confirm.ask")
    @patch("nao_core.commands.init.NaoConfig.try_load")
    def test_cancels_when_user_declines_reinit(self, mock_try_load, mock_confirm, tmp_path: Path, monkeypatch):
        """Raises InitError when user declines re-initialization."""
        monkeypatch.chdir(tmp_path)

        (tmp_path / "nao_config.yaml").write_text("project_name: existing\n")

        mock_config = MagicMock()
        mock_config.project_name = "existing"
        mock_try_load.return_value = mock_config
        mock_confirm.return_value = False

        with pytest.raises(InitError) as exc_info:
            setup_project_name()

        assert "cancelled" in str(exc_info.value).lower()


class TestSetupDatabases:
    """Tests for setup_databases function."""

    @patch("nao_core.commands.init.Confirm.ask")
    def test_returns_empty_list_when_user_skips(self, mock_confirm):
        """Returns empty list when user chooses not to set up databases."""
        from nao_core.commands.init import setup_databases

        mock_confirm.return_value = False

        result = setup_databases()

        assert result == []

    @patch("nao_core.commands.init.Confirm.ask")
    @patch("nao_core.commands.init.Prompt.ask")
    @patch("nao_core.commands.init.setup_duckdb")
    def test_adds_duckdb_database(self, mock_setup_duckdb, mock_prompt, mock_confirm):
        """Adds DuckDB database when selected."""
        from nao_core.commands.init import setup_databases

        mock_config = MagicMock()
        mock_config.name = "test-db"
        mock_setup_duckdb.return_value = mock_config

        # First confirm: yes to setup, second confirm: no to add another
        mock_confirm.side_effect = [True, False]
        mock_prompt.return_value = "duckdb"

        result = setup_databases()

        assert len(result) == 1
        assert result[0] == mock_config
        mock_setup_duckdb.assert_called_once()


class TestSetupRepos:
    """Tests for setup_repos function."""

    @patch("nao_core.commands.init.Confirm.ask")
    def test_returns_empty_list_when_user_skips(self, mock_confirm):
        """Returns empty list when user chooses not to set up repos."""
        from nao_core.commands.init import setup_repos

        mock_confirm.return_value = False

        result = setup_repos()

        assert result == []

    @patch("nao_core.commands.init.Confirm.ask")
    @patch("nao_core.commands.init.Prompt.ask")
    def test_adds_repository(self, mock_prompt, mock_confirm):
        """Adds repository when configured."""
        from nao_core.commands.init import setup_repos

        # First confirm: yes to setup, second confirm: no to add another
        mock_confirm.side_effect = [True, False]
        mock_prompt.side_effect = ["my-repo", "https://github.com/org/repo.git"]

        result = setup_repos()

        assert len(result) == 1
        assert result[0].name == "my-repo"
        assert result[0].url == "https://github.com/org/repo.git"


class TestSetupLLM:
    """Tests for setup_llm function."""

    @patch("nao_core.commands.init.Confirm.ask")
    def test_returns_none_when_user_skips(self, mock_confirm):
        """Returns None when user chooses not to set up LLM."""
        from nao_core.commands.init import setup_llm

        mock_confirm.return_value = False

        result = setup_llm()

        assert result is None

    @patch("nao_core.commands.init.Confirm.ask")
    @patch("nao_core.commands.init.Prompt.ask")
    def test_creates_llm_config(self, mock_prompt, mock_confirm):
        """Creates LLM config when configured."""
        from nao_core.commands.init import setup_llm

        mock_confirm.return_value = True
        mock_prompt.side_effect = ["openai", "sk-test-key"]

        result = setup_llm()

        assert result is not None
        assert result.api_key == "sk-test-key"

    @patch("nao_core.commands.init.Confirm.ask")
    @patch("nao_core.commands.init.Prompt.ask")
    def test_raises_on_empty_api_key(self, mock_prompt, mock_confirm):
        """Raises EmptyApiKeyError when API key is empty."""
        from nao_core.commands.init import setup_llm

        mock_confirm.return_value = True
        mock_prompt.side_effect = ["openai", ""]

        with pytest.raises(EmptyApiKeyError):
            setup_llm()


class TestSetupSlack:
    """Tests for setup_slack function."""

    @patch("nao_core.commands.init.Confirm.ask")
    def test_returns_none_when_user_skips(self, mock_confirm):
        """Returns None when user chooses not to set up Slack."""
        from nao_core.commands.init import setup_slack

        mock_confirm.return_value = False

        result = setup_slack()

        assert result is None

    @patch("nao_core.commands.init.Confirm.ask")
    @patch("nao_core.commands.init.Prompt.ask")
    def test_creates_slack_config(self, mock_prompt, mock_confirm):
        """Creates Slack config when configured."""
        from nao_core.commands.init import setup_slack

        mock_confirm.return_value = True
        mock_prompt.side_effect = ["xoxb-bot-token", "signing-secret"]

        result = setup_slack()

        assert result is not None
        assert result.bot_token == "xoxb-bot-token"
        assert result.signing_secret == "signing-secret"

    @patch("nao_core.commands.init.Confirm.ask")
    @patch("nao_core.commands.init.Prompt.ask")
    def test_raises_on_empty_bot_token(self, mock_prompt, mock_confirm):
        """Raises InitError when bot token is empty."""
        from nao_core.commands.init import setup_slack

        mock_confirm.return_value = True
        mock_prompt.side_effect = [""]

        with pytest.raises(InitError):
            setup_slack()

    @patch("nao_core.commands.init.Confirm.ask")
    @patch("nao_core.commands.init.Prompt.ask")
    def test_raises_on_empty_signing_secret(self, mock_prompt, mock_confirm):
        """Raises InitError when signing secret is empty."""
        from nao_core.commands.init import setup_slack

        mock_confirm.return_value = True
        mock_prompt.side_effect = ["xoxb-bot-token", ""]

        with pytest.raises(InitError):
            setup_slack()


class TestInitCommand:
    """Tests for the main init command."""

    @patch("nao_core.commands.init.setup_slack")
    @patch("nao_core.commands.init.setup_llm")
    @patch("nao_core.commands.init.setup_repos")
    @patch("nao_core.commands.init.setup_databases")
    @patch("nao_core.commands.init.setup_project_name")
    @patch("nao_core.commands.init.console")
    def test_init_creates_config_file(
        self,
        mock_console,
        mock_setup_project_name,
        mock_setup_databases,
        mock_setup_repos,
        mock_setup_llm,
        mock_setup_slack,
        tmp_path: Path,
    ):
        """Init command creates nao_config.yaml file."""
        from nao_core.commands.init import init

        project_path = tmp_path / "test-project"
        project_path.mkdir()

        mock_setup_project_name.return_value = ("test-project", project_path)
        mock_setup_databases.return_value = []
        mock_setup_repos.return_value = []
        mock_setup_llm.return_value = None
        mock_setup_slack.return_value = None

        init()

        config_file = project_path / "nao_config.yaml"
        assert config_file.exists()

    @patch("nao_core.commands.init.setup_slack")
    @patch("nao_core.commands.init.setup_llm")
    @patch("nao_core.commands.init.setup_repos")
    @patch("nao_core.commands.init.setup_databases")
    @patch("nao_core.commands.init.setup_project_name")
    @patch("nao_core.commands.init.console")
    def test_init_creates_folder_structure(
        self,
        mock_console,
        mock_setup_project_name,
        mock_setup_databases,
        mock_setup_repos,
        mock_setup_llm,
        mock_setup_slack,
        tmp_path: Path,
    ):
        """Init command creates project folder structure."""
        from nao_core.commands.init import init

        project_path = tmp_path / "test-project"
        project_path.mkdir()

        mock_setup_project_name.return_value = ("test-project", project_path)
        mock_setup_databases.return_value = []
        mock_setup_repos.return_value = []
        mock_setup_llm.return_value = None
        mock_setup_slack.return_value = None

        init()

        assert (project_path / "databases").exists()
        assert (project_path / "queries").exists()
        assert (project_path / "RULES.md").exists()

    @patch("nao_core.commands.init.setup_project_name")
    @patch("nao_core.commands.init.console")
    def test_init_handles_init_error(self, mock_console, mock_setup_project_name):
        """Init command handles InitError gracefully."""
        from nao_core.commands.init import init

        mock_setup_project_name.side_effect = EmptyProjectNameError()

        # Should not raise, just print error
        init()

        # Verify error was printed
        mock_console.print.assert_called()
        calls = [str(c) for c in mock_console.print.call_args_list]
        assert any("cannot be empty" in c for c in calls)
