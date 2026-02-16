"""Unit tests for the repository sync provider."""

import importlib
from pathlib import Path
from unittest.mock import MagicMock, patch

from nao_core.commands.sync.providers.repositories.provider import (
    RepositorySyncProvider,
    clone_or_pull_repo,
    pre_compile_dbt_docs,
)
from nao_core.config.base import NaoConfig
from nao_core.config.repos import RepoConfig

repo_provider = importlib.import_module("nao_core.commands.sync.providers.repositories.provider")


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

    @patch.object(repo_provider, "clone_or_pull_repo")
    @patch.object(repo_provider, "pre_compile_dbt_docs")
    @patch.object(repo_provider, "console")
    def test_sync_counts_successful_repos(self, mock_console, mock_precompile, mock_clone, tmp_path: Path):
        provider = RepositorySyncProvider()
        repos = [
            RepoConfig(name="repo1", url="https://github.com/test/repo1"),
            RepoConfig(name="repo2", url="https://github.com/test/repo2"),
            RepoConfig(name="repo3", url="https://github.com/test/repo3"),
        ]
        mock_clone.side_effect = [True, False, True]  # 2 successes, 1 failure

        result = provider.sync(repos, tmp_path)

        assert result.items_synced == 2
        assert mock_precompile.call_count == 2

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
    @patch.object(repo_provider.subprocess, "run")
    @patch.object(repo_provider, "console")
    def test_clones_new_repo(self, mock_console, mock_run, tmp_path: Path):
        repo = RepoConfig(name="new-repo", url="https://github.com/test/new-repo")
        mock_run.return_value = MagicMock(returncode=0)

        result = clone_or_pull_repo(repo, tmp_path)

        assert result is True
        mock_run.assert_called_once()
        call_args = mock_run.call_args
        assert "clone" in call_args[0][0]

    @patch.object(repo_provider.subprocess, "run")
    @patch.object(repo_provider, "console")
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

    @patch.object(repo_provider.subprocess, "run")
    @patch.object(repo_provider, "console")
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

    @patch.object(repo_provider.subprocess, "run")
    @patch.object(repo_provider, "console")
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

    @patch.object(repo_provider.subprocess, "run")
    @patch.object(repo_provider, "console")
    def test_returns_false_on_clone_failure(self, mock_console, mock_run, tmp_path: Path):
        repo = RepoConfig(name="new-repo", url="https://github.com/test/new-repo")
        mock_run.return_value = MagicMock(returncode=1, stderr="Error cloning")

        result = clone_or_pull_repo(repo, tmp_path)

        assert result is False

    @patch.object(repo_provider.subprocess, "run")
    @patch.object(repo_provider, "console")
    def test_returns_false_on_pull_failure(self, mock_console, mock_run, tmp_path: Path):
        # Create existing repo directory
        repo_path = tmp_path / "existing-repo"
        repo_path.mkdir()

        repo = RepoConfig(name="existing-repo", url="https://github.com/test/existing-repo")
        mock_run.return_value = MagicMock(returncode=1, stderr="Error pulling")

        result = clone_or_pull_repo(repo, tmp_path)

        assert result is False


class TestPreCompileDbtDocs:
    @patch.object(repo_provider.subprocess, "run")
    @patch.object(repo_provider.shutil, "which")
    @patch.object(repo_provider, "console")
    def test_skips_when_compile_flag_is_false(self, mock_console, mock_which, mock_run, tmp_path: Path):
        repo = RepoConfig(name="dbt-repo", url="https://github.com/test/dbt-repo", compile_dbt_docs=False)

        result = pre_compile_dbt_docs(repo, tmp_path)

        assert result is True
        mock_which.assert_not_called()
        mock_run.assert_not_called()

    @patch.object(repo_provider.subprocess, "run")
    @patch.object(repo_provider.shutil, "which")
    @patch.object(repo_provider, "console")
    def test_skips_when_repo_is_not_dbt_project(self, mock_console, mock_which, mock_run, tmp_path: Path):
        repo = RepoConfig(name="repo", url="https://github.com/test/repo", compile_dbt_docs=True)
        (tmp_path / "repo").mkdir()

        result = pre_compile_dbt_docs(repo, tmp_path)

        assert result is True
        mock_which.assert_not_called()
        mock_run.assert_not_called()

    @patch.object(repo_provider.subprocess, "run")
    @patch.object(repo_provider.shutil, "which")
    @patch.object(repo_provider, "console")
    def test_skips_when_dbt_binary_not_found(self, mock_console, mock_which, mock_run, tmp_path: Path):
        repo = RepoConfig(name="dbt-repo", url="https://github.com/test/dbt-repo", compile_dbt_docs=True)
        repo_path = tmp_path / "dbt-repo"
        repo_path.mkdir()
        (repo_path / "dbt_project.yml").write_text("name: demo")
        mock_which.return_value = None

        result = pre_compile_dbt_docs(repo, tmp_path)

        assert result is True
        mock_run.assert_not_called()

    @patch.object(repo_provider.subprocess, "run")
    @patch.object(repo_provider.shutil, "which")
    @patch.object(repo_provider, "console")
    def test_runs_dbt_docs_generate(self, mock_console, mock_which, mock_run, tmp_path: Path):
        repo = RepoConfig(
            name="dbt-repo",
            url="https://github.com/test/dbt-repo",
            compile_dbt_docs=True,
            dbt_profiles_dir="/profiles",
        )
        repo_path = tmp_path / "dbt-repo"
        target_path = repo_path / "target"
        target_path.mkdir(parents=True)
        (repo_path / "dbt_project.yml").write_text("name: demo")
        (target_path / "catalog.json").write_text("{}")
        (target_path / "manifest.json").write_text("{}")
        mock_which.return_value = "dbt"
        mock_run.return_value = MagicMock(returncode=0, stdout="", stderr="")

        result = pre_compile_dbt_docs(repo, tmp_path)

        assert result is True
        mock_run.assert_called_once()
        cmd = mock_run.call_args[0][0]
        assert cmd[:4] == ["dbt", "docs", "generate", "--project-dir"]
        assert "--profiles-dir" in cmd
        assert "/profiles" in cmd
