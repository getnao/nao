"""Unit tests for the repository sync provider."""

from pathlib import Path
from unittest.mock import MagicMock, patch

import pytest

from nao_core.commands.sync.providers.repositories.provider import (
    RepositorySyncProvider,
    _matches_patterns,
    clone_or_pull_repo,
    sync_local_repo,
    sync_repo,
)
from nao_core.config.base import NaoConfig
from nao_core.config.repos import RepoConfig


class TestRepoConfig:
    def test_git_repo_config(self):
        config = RepoConfig(name="test", url="https://github.com/test/repo")
        assert config.url == "https://github.com/test/repo"
        assert config.is_local is False

    def test_local_path_config(self):
        config = RepoConfig(name="test", local_path="/some/path")
        assert config.local_path == "/some/path"
        assert config.is_local is True

    def test_rejects_both_url_and_local_path(self):
        with pytest.raises(ValueError, match="Only one of"):
            RepoConfig(name="test", url="https://github.com/test/repo", local_path="/some/path")

    def test_rejects_neither_url_nor_local_path(self):
        with pytest.raises(ValueError, match="Either 'url' or 'local_path'"):
            RepoConfig(name="test")

    def test_rejects_branch_with_local_path(self):
        with pytest.raises(ValueError, match="'branch' cannot be used"):
            RepoConfig(name="test", local_path="/some/path", branch="main")

    def test_include_exclude_defaults(self):
        config = RepoConfig(name="test", local_path="/some/path")
        assert config.include == []
        assert config.exclude == []

    def test_include_exclude_on_local(self):
        config = RepoConfig(
            name="test",
            local_path="/some/path",
            include=["models/**/*.sql"],
            exclude=["*.pyc"],
        )
        assert config.include == ["models/**/*.sql"]
        assert config.exclude == ["*.pyc"]

    def test_include_exclude_on_git(self):
        config = RepoConfig(
            name="test",
            url="https://github.com/test/repo",
            include=["src/**/*.py"],
            exclude=["tests/**"],
        )
        assert config.include == ["src/**/*.py"]


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

    @patch("nao_core.commands.sync.providers.repositories.provider.sync_repo")
    @patch("nao_core.commands.sync.providers.repositories.provider.console")
    def test_sync_counts_successful_repos(self, mock_console, mock_sync, tmp_path: Path):
        provider = RepositorySyncProvider()
        repos = [
            RepoConfig(name="repo1", url="https://github.com/test/repo1"),
            RepoConfig(name="repo2", url="https://github.com/test/repo2"),
            RepoConfig(name="repo3", url="https://github.com/test/repo3"),
        ]
        mock_sync.side_effect = [True, False, True]

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
        repo_path = tmp_path / "existing-repo"
        repo_path.mkdir()

        repo = RepoConfig(name="existing-repo", url="https://github.com/test/existing-repo")
        mock_run.return_value = MagicMock(returncode=1, stderr="Error pulling")

        result = clone_or_pull_repo(repo, tmp_path)

        assert result is False


class TestMatchesPatterns:
    def test_no_patterns_matches_everything(self):
        assert _matches_patterns("any/file.txt", [], []) is True

    def test_include_pattern_matches(self):
        assert _matches_patterns("models/dim_users.sql", ["models/**/*.sql"], []) is True

    def test_include_pattern_rejects(self):
        assert _matches_patterns("docs/readme.md", ["models/**/*.sql"], []) is False

    def test_exclude_pattern_rejects(self):
        assert _matches_patterns("cache/data.pyc", [], ["*.pyc"]) is False

    def test_exclude_pattern_allows(self):
        assert _matches_patterns("models/dim.sql", [], ["*.pyc"]) is True

    def test_include_and_exclude_combined(self):
        assert _matches_patterns("models/dim.sql", ["models/**/*.sql"], ["models/staging*"]) is True
        assert _matches_patterns("models/staging_raw.sql", ["models/**/*.sql"], ["models/staging*"]) is False

    def test_multiple_include_patterns(self):
        patterns = ["models/**/*.sql", "models/**/*.yml"]
        assert _matches_patterns("models/schema.yml", patterns, []) is True
        assert _matches_patterns("models/dim.sql", patterns, []) is True
        assert _matches_patterns("models/readme.md", patterns, []) is False

    def test_trailing_double_star_matches_all_files(self):
        assert _matches_patterns("__pycache__/foo.pyc", [], ["__pycache__/**"]) is False
        assert _matches_patterns("__pycache__/sub/bar.pyc", [], ["__pycache__/**"]) is False
        assert _matches_patterns("src/__pycache__/foo.pyc", [], ["__pycache__/**"]) is True

    def test_trailing_double_star_in_include(self):
        assert _matches_patterns("docs/guide.md", ["docs/**"], []) is True
        assert _matches_patterns("docs/api/ref.md", ["docs/**"], []) is True
        assert _matches_patterns("src/main.py", ["docs/**"], []) is False


class TestSyncLocalRepo:
    def test_copies_all_files_without_filters(self, tmp_path: Path):
        source = tmp_path / "source"
        source.mkdir()
        (source / "file1.txt").write_text("hello")
        (source / "subdir").mkdir()
        (source / "subdir" / "file2.txt").write_text("world")

        output = tmp_path / "output"
        output.mkdir()

        repo = RepoConfig(name="local-repo", local_path=str(source))
        result = sync_local_repo(repo, output)

        assert result is True
        assert (output / "local-repo" / "file1.txt").read_text() == "hello"
        assert (output / "local-repo" / "subdir" / "file2.txt").read_text() == "world"

    def test_respects_include_patterns(self, tmp_path: Path):
        source = tmp_path / "source"
        source.mkdir()
        (source / "models").mkdir()
        (source / "models" / "dim.sql").write_text("SELECT 1")
        (source / "models" / "schema.yml").write_text("version: 2")
        (source / "readme.md").write_text("docs")

        output = tmp_path / "output"
        output.mkdir()

        repo = RepoConfig(name="filtered", local_path=str(source), include=["models/*.sql"])
        result = sync_local_repo(repo, output)

        assert result is True
        assert (output / "filtered" / "models" / "dim.sql").exists()
        assert not (output / "filtered" / "models" / "schema.yml").exists()
        assert not (output / "filtered" / "readme.md").exists()

    def test_respects_exclude_patterns(self, tmp_path: Path):
        source = tmp_path / "source"
        source.mkdir()
        (source / "model.sql").write_text("SELECT 1")
        (source / "cache.pyc").write_text("bytecode")

        output = tmp_path / "output"
        output.mkdir()

        repo = RepoConfig(name="excluded", local_path=str(source), exclude=["*.pyc"])
        result = sync_local_repo(repo, output)

        assert result is True
        assert (output / "excluded" / "model.sql").exists()
        assert not (output / "excluded" / "cache.pyc").exists()

    def test_replaces_existing_output(self, tmp_path: Path):
        source = tmp_path / "source"
        source.mkdir()
        (source / "new.txt").write_text("new content")

        output = tmp_path / "output"
        output.mkdir()
        stale = output / "local-repo"
        stale.mkdir()
        (stale / "old.txt").write_text("stale content")

        repo = RepoConfig(name="local-repo", local_path=str(source))
        result = sync_local_repo(repo, output)

        assert result is True
        assert (output / "local-repo" / "new.txt").exists()
        assert not (output / "local-repo" / "old.txt").exists()

    def test_returns_false_for_missing_path(self, tmp_path: Path):
        output = tmp_path / "output"
        output.mkdir()

        repo = RepoConfig(name="missing", local_path=str(tmp_path / "nonexistent"))
        result = sync_local_repo(repo, output)

        assert result is False

    def test_returns_false_for_file_not_directory(self, tmp_path: Path):
        source = tmp_path / "a_file.txt"
        source.write_text("not a dir")

        output = tmp_path / "output"
        output.mkdir()

        repo = RepoConfig(name="notdir", local_path=str(source))
        result = sync_local_repo(repo, output)

        assert result is False


class TestSyncRepo:
    @patch("nao_core.commands.sync.providers.repositories.provider.sync_local_repo")
    def test_dispatches_to_local(self, mock_local):
        mock_local.return_value = True
        repo = RepoConfig(name="local", local_path="/some/path")
        base = Path("/tmp/repos")

        result = sync_repo(repo, base)

        assert result is True
        mock_local.assert_called_once_with(repo, base)

    @patch("nao_core.commands.sync.providers.repositories.provider.clone_or_pull_repo")
    def test_dispatches_to_git(self, mock_git):
        mock_git.return_value = True
        repo = RepoConfig(name="git-repo", url="https://github.com/test/repo")
        base = Path("/tmp/repos")

        result = sync_repo(repo, base)

        assert result is True
        mock_git.assert_called_once_with(repo, base)
