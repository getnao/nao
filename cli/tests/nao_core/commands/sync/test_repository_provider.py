"""Unit tests for the repository sync provider."""

from pathlib import Path
from unittest.mock import MagicMock, patch

from nao_core.commands.sync.providers.repositories.provider import (
    RepositorySyncProvider,
    clone_or_pull_repo,
)
from nao_core.config.base import NaoConfig
from nao_core.config.repos import RepoConfig


class TestRepositorySyncProvider:
    def test_provider_properties(self):
        provider = RepositorySyncProvider()
        assert provider.name == "Repositories"
        assert provider.emoji == "📦"
        assert provider.default_output_dir == "repos"

    def test_get_items_returns_repos_from_config(self):
        provider = RepositorySyncProvider()
        mock_config = MagicMock(spec=NaoConfig)
        mock_config.repos = [
            RepoConfig(name="repo1", url="https://github.com/test/repo1"),
            RepoConfig(name="repo2", url="https://github.com/test/repo2"),
        ]

        items = provider.get_items(mock_config)

        assert len(items) == 2
        assert items[0].name == "repo1"
        assert items[1].name == "repo2"

    def test_get_items_returns_empty_list_when_no_repos(self):
        provider = RepositorySyncProvider()
        mock_config = MagicMock(spec=NaoConfig)
        mock_config.repos = []

        items = provider.get_items(mock_config)

        assert items == []

    def test_sync_returns_zero_when_no_items(self, tmp_path: Path):
        provider = RepositorySyncProvider()

        result = provider.sync([], tmp_path)

        assert result.provider_name == "Repositories"
        assert result.items_synced == 0

    @patch("nao_core.commands.sync.providers.repositories.provider.clone_or_pull_repo")
    @patch("nao_core.commands.sync.providers.repositories.provider.console")
    def test_sync_counts_successful_repos(self, mock_console, mock_clone, tmp_path: Path):
        provider = RepositorySyncProvider()
        repos = [
            RepoConfig(name="repo1", url="https://github.com/test/repo1"),
            RepoConfig(name="repo2", url="https://github.com/test/repo2"),
            RepoConfig(name="repo3", url="https://github.com/test/repo3"),
        ]
        mock_clone.side_effect = [True, False, True]  # 2 successes, 1 failure

        result = provider.sync(repos, tmp_path)

        assert result.items_synced == 2

    def test_should_sync_returns_true_when_repos_exist(self):
        provider = RepositorySyncProvider()
        mock_config = MagicMock(spec=NaoConfig)
        mock_config.repos = [
            RepoConfig(name="repo1", url="https://github.com/test/repo1"),
        ]

        assert provider.should_sync(mock_config) is True

    def test_should_sync_returns_false_when_no_repos(self):
        provider = RepositorySyncProvider()
        mock_config = MagicMock(spec=NaoConfig)
        mock_config.repos = []

        assert provider.should_sync(mock_config) is False


class TestCloneOrPullRepo:
    @patch("nao_core.commands.sync.providers.repositories.provider.subprocess.run")
    @patch("nao_core.commands.sync.providers.repositories.provider.console")
    def test_clones_new_repo(self, mock_console, mock_run, tmp_path: Path):
        repo = RepoConfig(name="new-repo", url="https://github.com/test/new-repo")
        mock_run.return_value = MagicMock(returncode=0)

        result = clone_or_pull_repo(repo, tmp_path)

        assert result is True
        mock_run.assert_called_once()
        call_args = mock_run.call_args
        assert "clone" in call_args[0][0]

    @patch("nao_core.commands.sync.providers.repositories.provider.subprocess.run")
    @patch("nao_core.commands.sync.providers.repositories.provider.console")
    def test_clones_with_branch(self, mock_console, mock_run, tmp_path: Path):
        repo = RepoConfig(
            name="new-repo",
            url="https://github.com/test/new-repo",
            branch="develop",
        )
        mock_run.return_value = MagicMock(returncode=0)

        result = clone_or_pull_repo(repo, tmp_path)

        assert result is True
        call_args = mock_run.call_args[0][0]
        assert "-b" in call_args
        assert "develop" in call_args

    @patch("nao_core.commands.sync.providers.repositories.provider.subprocess.run")
    @patch("nao_core.commands.sync.providers.repositories.provider.console")
    def test_pulls_existing_repo(self, mock_console, mock_run, tmp_path: Path):
        # Create existing repo directory
        repo_path = tmp_path / "existing-repo"
        repo_path.mkdir()

        repo = RepoConfig(name="existing-repo", url="https://github.com/test/existing-repo")
        mock_run.return_value = MagicMock(returncode=0)

        result = clone_or_pull_repo(repo, tmp_path)

        assert result is True
        call_args = mock_run.call_args[0][0]
        assert "pull" in call_args

    @patch("nao_core.commands.sync.providers.repositories.provider.subprocess.run")
    @patch("nao_core.commands.sync.providers.repositories.provider.console")
    def test_pulls_and_checkouts_branch(self, mock_console, mock_run, tmp_path: Path):
        # Create existing repo directory
        repo_path = tmp_path / "existing-repo"
        repo_path.mkdir()

        repo = RepoConfig(
            name="existing-repo",
            url="https://github.com/test/existing-repo",
            branch="feature",
        )
        mock_run.return_value = MagicMock(returncode=0)

        result = clone_or_pull_repo(repo, tmp_path)

        assert result is True
        # Should have called git pull and git checkout
        assert mock_run.call_count == 2

    @patch("nao_core.commands.sync.providers.repositories.provider.subprocess.run")
    @patch("nao_core.commands.sync.providers.repositories.provider.console")
    def test_returns_false_on_clone_failure(self, mock_console, mock_run, tmp_path: Path):
        repo = RepoConfig(name="new-repo", url="https://github.com/test/new-repo")
        mock_run.return_value = MagicMock(returncode=1, stderr="Error cloning")

        result = clone_or_pull_repo(repo, tmp_path)

        assert result is False

    @patch("nao_core.commands.sync.providers.repositories.provider.subprocess.run")
    @patch("nao_core.commands.sync.providers.repositories.provider.console")
    def test_returns_false_on_pull_failure(self, mock_console, mock_run, tmp_path: Path):
        # Create existing repo directory
        repo_path = tmp_path / "existing-repo"
        repo_path.mkdir()

        repo = RepoConfig(name="existing-repo", url="https://github.com/test/existing-repo")
        mock_run.return_value = MagicMock(returncode=1, stderr="Error pulling")

        result = clone_or_pull_repo(repo, tmp_path)

        assert result is False
