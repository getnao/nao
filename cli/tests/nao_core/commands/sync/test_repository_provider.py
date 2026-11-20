"""Unit tests for the repository sync provider."""

from pathlib import Path
from typing import Any
from unittest.mock import MagicMock, patch

import pytest

from nao_core.commands.sync.providers.repositories.provider import (
    RepositorySyncProvider,
    _filter_repo_files,
    _matches_patterns,
    clone_or_pull_repo,
    sync_local_repo,
    sync_repo,
)
from nao_core.config.base import NaoConfig
from nao_core.config.repos import RepoConfig, RepoTarget

FILTERABLE_FILES = {"models/dim.sql": "SELECT 1", "models/schema.yml": "version: 2", "readme.md": "docs"}
PROVIDER_MODULE = "nao_core.commands.sync.providers.repositories.provider"


@pytest.fixture
def git_run():
    with patch(f"{PROVIDER_MODULE}.console"), patch(f"{PROVIDER_MODULE}.subprocess.run") as mock_run:
        yield mock_run


@pytest.fixture
def output_dir(tmp_path: Path) -> Path:
    output = tmp_path / "output"
    output.mkdir()
    return output


def _supports_symlinks(tmp_path: Path) -> bool:
    probe = tmp_path / ".symlink_probe"
    try:
        probe.symlink_to(tmp_path)
    except (OSError, NotImplementedError):
        return False
    probe.unlink()
    return True


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

    def test_rejects_unknown_keys(self):
        with pytest.raises(ValueError, match="targetz"):
            RepoConfig.model_validate({"name": "test", "url": "https://github.com/test/repo", "targetz": []})

    def test_rejects_overlapping_target_sources(self):
        with pytest.raises(ValueError, match="sources 'nao/tests' and 'nao/tests/unit' overlap"):
            RepoConfig(
                name="test",
                url="https://github.com/test/repo",
                targets=[
                    RepoTarget(source="nao/tests", target="tests/all"),
                    RepoTarget(source="nao/tests/unit", target="tests/unit"),
                ],
            )

    def test_normalizes_target_paths(self):
        config = RepoConfig(
            name="test",
            url="https://github.com/test/repo",
            targets=[RepoTarget(source="./nao/tests/", target="tests/analytics/")],
        )
        assert (config.targets[0].source, config.targets[0].target) == ("nao/tests", "tests/analytics")

    @pytest.mark.parametrize(
        ("source", "target", "message"),
        [
            pytest.param("nao/tests", "tests", "must be a subfolder", id="top_folder"),
            pytest.param("nao/tests", "repos/analytics", "inside 'repos/'", id="inside_repos"),
            pytest.param("nao/tests", "databases/analytics", "inside 'databases/'", id="inside_databases"),
            pytest.param("nao/tests", "tests/../../etc", "no '..'", id="target_traversal"),
            pytest.param("nao/tests", "/tmp/tests", "no '..'", id="absolute_target"),
            pytest.param("nao\\tests", "tests/analytics", "forward slashes", id="backslash_source"),
            pytest.param("../secrets", "tests/analytics", "no '..'", id="source_traversal"),
            pytest.param(".", "tests/analytics", "relative path", id="whole_repo"),
        ],
    )
    def test_rejects_invalid_targets(self, source: str, target: str, message: str):
        with pytest.raises(ValueError, match=message):
            RepoConfig(
                name="test", url="https://github.com/test/repo", targets=[RepoTarget(source=source, target=target)]
            )


class TestRepositorySyncProvider:
    def test_provider_properties(self):
        provider = RepositorySyncProvider()
        assert provider.name == "Repositories"
        assert provider.emoji == "📦"
        assert provider.default_output_dir == "repos"

    def test_get_items_returns_repos_from_config(self):
        provider = RepositorySyncProvider()

        items = provider.get_items(_mock_config(_git_repos("repo1", "repo2")))

        assert len(items) == 2
        assert items[0].name == "repo1"
        assert items[1].name == "repo2"

    def test_get_items_returns_empty_list_when_no_repos(self):
        provider = RepositorySyncProvider()

        items = provider.get_items(_mock_config([]))

        assert items == []

    def test_sync_returns_zero_when_no_items(self, tmp_path: Path):
        provider = RepositorySyncProvider()

        result = provider.sync([], tmp_path)

        assert result.provider_name == "Repositories"
        assert result.items_synced == 0

    @patch(f"{PROVIDER_MODULE}.sync_repo")
    @patch(f"{PROVIDER_MODULE}.console")
    def test_sync_counts_successful_repos_and_reports_failures(self, mock_console, mock_sync, tmp_path: Path):
        provider = RepositorySyncProvider()
        mock_sync.side_effect = [True, False, True]

        result = provider.sync(_git_repos("repo1", "repo2", "repo3"), tmp_path)

        assert result.items_synced == 2
        assert result.error == "Failed to sync 1 repository: repo2"

    @patch(f"{PROVIDER_MODULE}.sync_repo", return_value=False)
    @patch(f"{PROVIDER_MODULE}.console")
    def test_sync_reports_failed_repository_names_as_plain_text(self, mock_console, mock_sync, tmp_path: Path):
        repo = RepoConfig(name="my[b]db", url="https://github.com/test/repo")

        result = RepositorySyncProvider().sync([repo], tmp_path)

        assert result.error == "Failed to sync 1 repository: my[b]db"

    @patch(f"{PROVIDER_MODULE}.sync_repo", return_value=True)
    @patch(f"{PROVIDER_MODULE}.console")
    def test_sync_runs_repos_with_threads(self, mock_console, mock_sync, tmp_path: Path):
        provider = RepositorySyncProvider()

        result = provider.sync(_git_repos("repo1", "repo2", "repo3"), tmp_path, threads=2)

        assert result.items_synced == 3
        assert mock_sync.call_count == 3

    def test_should_sync_returns_true_when_repos_exist(self):
        provider = RepositorySyncProvider()

        assert provider.should_sync(_mock_config(_git_repos("repo1"))) is True

    def test_should_sync_returns_false_when_no_repos(self):
        provider = RepositorySyncProvider()

        assert provider.should_sync(_mock_config([])) is False


def git_clone_stub(base_path: Path, repo_name: str, files: dict[str, str] | None = None):
    """subprocess.run side_effect that simulates git clone by creating the .tmp target directory."""

    def _run(*_args, **_kwargs):
        cloned = base_path / f"{repo_name}.tmp"
        cloned.mkdir(parents=True, exist_ok=True)
        _write_files(cloned, files or {})
        return MagicMock(returncode=0)

    return _run


class TestCloneOrPullRepo:
    def test_clones_new_repo(self, git_run, tmp_path: Path):
        repo = RepoConfig(name="new-repo", url="https://github.com/test/new-repo")
        git_run.side_effect = git_clone_stub(tmp_path, "new-repo")

        result = clone_or_pull_repo(repo, tmp_path)

        assert result is True
        git_run.assert_called_once()
        assert git_run.call_args[0][0][:5] == ["git", "clone", "--depth", "1", "--single-branch"]

    def test_clones_with_branch(self, git_run, tmp_path: Path):
        repo = RepoConfig(
            name="new-repo",
            url="https://github.com/test/new-repo",
            branch="develop",
        )
        git_run.side_effect = git_clone_stub(tmp_path, "new-repo")

        result = clone_or_pull_repo(repo, tmp_path)

        assert result is True
        call_args = git_run.call_args[0][0]
        assert "-b" in call_args
        assert "develop" in call_args

    def test_reclones_existing_repo(self, git_run, tmp_path: Path):
        """Re-sync always re-clones fresh rather than pulling in-place."""
        (tmp_path / "existing-repo").mkdir()
        repo = RepoConfig(name="existing-repo", url="https://github.com/test/existing-repo")
        git_run.side_effect = git_clone_stub(tmp_path, "existing-repo")

        result = clone_or_pull_repo(repo, tmp_path)

        assert result is True
        assert git_run.call_count == 1
        assert "clone" in git_run.call_args[0][0]

    def test_reclones_existing_repo_with_branch(self, git_run, tmp_path: Path):
        """Re-sync with branch uses a single clone -b, not pull + checkout."""
        (tmp_path / "existing-repo").mkdir()
        repo = RepoConfig(
            name="existing-repo",
            url="https://github.com/test/existing-repo",
            branch="feature",
        )
        git_run.side_effect = git_clone_stub(tmp_path, "existing-repo")

        result = clone_or_pull_repo(repo, tmp_path)

        assert result is True
        assert git_run.call_count == 1
        call_args = git_run.call_args[0][0]
        assert "-b" in call_args
        assert "feature" in call_args

    def test_strips_git_directory_after_clone(self, git_run, tmp_path: Path):
        """Core fix: .git/ must be removed so parent repo tracks files, not a gitlink."""
        repo = RepoConfig(name="my-repo", url="https://github.com/test/my-repo")
        git_run.side_effect = git_clone_stub(
            tmp_path, "my-repo", {".git/HEAD": "ref: refs/heads/main", "README.md": "hello"}
        )

        result = clone_or_pull_repo(repo, tmp_path)

        assert result is True
        assert not (tmp_path / "my-repo" / ".git").exists()
        assert (tmp_path / "my-repo" / "README.md").exists()

    def test_respects_include_patterns(self, git_run, tmp_path: Path):
        """include globs must be applied to url repos, not only local_path repos."""
        repo = RepoConfig(
            name="filtered-repo",
            url="https://github.com/test/filtered-repo",
            include=["models/*.sql"],
        )
        git_run.side_effect = git_clone_stub(tmp_path, "filtered-repo", FILTERABLE_FILES)

        result = clone_or_pull_repo(repo, tmp_path)

        assert result is True
        assert (tmp_path / "filtered-repo" / "models" / "dim.sql").exists()
        assert not (tmp_path / "filtered-repo" / "models" / "schema.yml").exists()
        assert not (tmp_path / "filtered-repo" / "readme.md").exists()

    def test_respects_exclude_patterns(self, git_run, tmp_path: Path):
        """exclude globs must be applied to url repos, pruning emptied directories."""
        repo = RepoConfig(
            name="excluded-repo",
            url="https://github.com/test/excluded-repo",
            exclude=["**/*.pyc", "cache/**"],
        )
        git_run.side_effect = git_clone_stub(
            tmp_path,
            "excluded-repo",
            {"model.sql": "SELECT 1", "build.pyc": "bytecode", "cache/data.bin": "junk"},
        )

        result = clone_or_pull_repo(repo, tmp_path)

        assert result is True
        assert (tmp_path / "excluded-repo" / "model.sql").exists()
        assert not (tmp_path / "excluded-repo" / "build.pyc").exists()
        assert not (tmp_path / "excluded-repo" / "cache").exists()

    def test_no_filters_keeps_all_files(self, git_run, tmp_path: Path):
        repo = RepoConfig(name="full-repo", url="https://github.com/test/full-repo")
        git_run.side_effect = git_clone_stub(tmp_path, "full-repo", {"a.sql": "SELECT 1", "b.md": "docs"})

        result = clone_or_pull_repo(repo, tmp_path)

        assert result is True
        assert (tmp_path / "full-repo" / "a.sql").exists()
        assert (tmp_path / "full-repo" / "b.md").exists()

    def test_rejects_path_traversal_repo_name(self, git_run, tmp_path: Path):
        """Security: repo.name like '../evil' must be rejected before any git call."""
        repo = RepoConfig(name="../evil", url="https://github.com/test/evil")

        result = clone_or_pull_repo(repo, tmp_path)

        assert result is False
        git_run.assert_not_called()

    def test_returns_false_on_clone_failure(self, git_run, tmp_path: Path):
        repo = RepoConfig(name="new-repo", url="https://github.com/test/new-repo")
        git_run.return_value = MagicMock(returncode=1, stderr="Error cloning")

        result = clone_or_pull_repo(repo, tmp_path)

        assert result is False

    def test_returns_false_on_reclone_failure(self, git_run, tmp_path: Path):
        (tmp_path / "existing-repo").mkdir()
        repo = RepoConfig(name="existing-repo", url="https://github.com/test/existing-repo")
        git_run.return_value = MagicMock(returncode=1, stderr="Error cloning")

        result = clone_or_pull_repo(repo, tmp_path)

        assert result is False


class TestRepoTargets:
    def test_moves_target_out_of_the_repo_and_replaces_its_folder(self, git_run, tmp_path: Path):
        repos = tmp_path / "repos"
        _write_files(tmp_path / "tests" / "analytics", {"removed_upstream.yml": "prompt: old"})
        git_run.side_effect = git_clone_stub(repos, "analytics", ANALYTICS_FILES)

        assert clone_or_pull_repo(_analytics_repo(), repos) is True

        assert sorted(_list_files(tmp_path / "tests" / "analytics")) == ["nested/refunds.yml", "orders.yml"]
        assert _list_files(repos / "analytics") == ["models/orders.sql"]

    def test_leaves_project_untouched_when_a_source_is_missing(self, git_run, tmp_path: Path):
        repos = tmp_path / "repos"
        _write_files(repos / "analytics", {"models/orders.sql": "SELECT 0"})
        _write_files(tmp_path / "tests" / "analytics", {"orders.yml": "prompt: production"})
        repo = _analytics_repo(targets=[{"source": "nao/tests", "target": "tests/analytics"}, _MISSING_TARGET])
        git_run.side_effect = git_clone_stub(repos, "analytics", ANALYTICS_FILES)

        assert clone_or_pull_repo(repo, repos) is False

        assert (tmp_path / "tests" / "analytics" / "orders.yml").read_text() == "prompt: production"
        assert (repos / "analytics" / "models" / "orders.sql").read_text() == "SELECT 0"
        assert not (repos / "analytics.tmp").exists()

    def test_refuses_a_source_removed_by_the_filters(self, git_run, tmp_path: Path):
        repos = tmp_path / "repos"
        git_run.side_effect = git_clone_stub(repos, "analytics", ANALYTICS_FILES)

        assert clone_or_pull_repo(_analytics_repo(include=["models/**"]), repos) is False
        assert not (tmp_path / "tests").exists()

    def test_moves_targets_of_a_local_repo(self, tmp_path: Path):
        source = _write_files(tmp_path / "source", ANALYTICS_FILES)
        project = tmp_path / "project"
        repo = RepoConfig(
            name="analytics",
            local_path=str(source),
            targets=[RepoTarget(source="nao/tests", target="tests/analytics")],
        )

        assert sync_local_repo(repo, project / "repos") is True

        assert sorted(_list_files(project / "tests" / "analytics")) == ["nested/refunds.yml", "orders.yml"]
        assert _list_files(project / "repos" / "analytics") == ["models/orders.sql"]
        assert (source / "nao" / "tests" / "orders.yml").exists()


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


class TestFilterRepoFilesSymlinks:
    def test_removes_excluded_symlink(self, tmp_path: Path):
        if not _supports_symlinks(tmp_path):
            pytest.skip("platform does not support symlinks")

        repo_dir = tmp_path / "repo"
        repo_dir.mkdir()
        (repo_dir / "keep.sql").write_text("SELECT 1")
        target = tmp_path / "outside.env"
        target.write_text("SECRET")
        (repo_dir / "secret.env").symlink_to(target)

        _filter_repo_files(repo_dir, include=[], exclude=["*.env"])

        assert (repo_dir / "keep.sql").exists()
        assert not (repo_dir / "secret.env").is_symlink()
        assert not (repo_dir / "secret.env").exists()
        assert target.exists()

    def test_prune_does_not_crash_on_surviving_directory_symlink(self, tmp_path: Path):
        """A directory symlink that passes the filters must not make prune raise NotADirectoryError."""
        if not _supports_symlinks(tmp_path):
            pytest.skip("platform does not support symlinks")

        repo_dir = tmp_path / "repo"
        repo_dir.mkdir()
        (repo_dir / "cache.pyc").write_text("bytecode")
        real_dir = tmp_path / "real"
        real_dir.mkdir()
        (real_dir / "inner.txt").write_text("data")
        (repo_dir / "linked").symlink_to(real_dir)

        _filter_repo_files(repo_dir, include=[], exclude=["*.pyc"])

        assert not (repo_dir / "cache.pyc").exists()
        assert (repo_dir / "linked").is_symlink()
        assert real_dir.exists()
        assert (real_dir / "inner.txt").exists()


class TestSyncLocalRepo:
    def test_copies_all_files_without_filters(self, tmp_path: Path, output_dir: Path):
        source = _write_files(tmp_path / "source", {"file1.txt": "hello", "subdir/file2.txt": "world"})

        repo = RepoConfig(name="local-repo", local_path=str(source))
        result = sync_local_repo(repo, output_dir)

        assert result is True
        assert (output_dir / "local-repo" / "file1.txt").read_text() == "hello"
        assert (output_dir / "local-repo" / "subdir" / "file2.txt").read_text() == "world"

    def test_respects_include_patterns(self, tmp_path: Path, output_dir: Path):
        source = _write_files(tmp_path / "source", FILTERABLE_FILES)

        repo = RepoConfig(name="filtered", local_path=str(source), include=["models/*.sql"])
        result = sync_local_repo(repo, output_dir)

        assert result is True
        assert (output_dir / "filtered" / "models" / "dim.sql").exists()
        assert not (output_dir / "filtered" / "models" / "schema.yml").exists()
        assert not (output_dir / "filtered" / "readme.md").exists()

    def test_respects_exclude_patterns(self, tmp_path: Path, output_dir: Path):
        source = _write_files(tmp_path / "source", {"model.sql": "SELECT 1", "cache.pyc": "bytecode"})

        repo = RepoConfig(name="excluded", local_path=str(source), exclude=["*.pyc"])
        result = sync_local_repo(repo, output_dir)

        assert result is True
        assert (output_dir / "excluded" / "model.sql").exists()
        assert not (output_dir / "excluded" / "cache.pyc").exists()

    def test_replaces_existing_output(self, tmp_path: Path, output_dir: Path):
        source = _write_files(tmp_path / "source", {"new.txt": "new content"})
        _write_files(output_dir / "local-repo", {"old.txt": "stale content"})

        repo = RepoConfig(name="local-repo", local_path=str(source))
        result = sync_local_repo(repo, output_dir)

        assert result is True
        assert (output_dir / "local-repo" / "new.txt").exists()
        assert not (output_dir / "local-repo" / "old.txt").exists()

    def test_strips_git_dir_without_filters(self, tmp_path: Path, output_dir: Path):
        source = _write_files(tmp_path / "source", {"file1.txt": "hello", ".git/HEAD": "ref: refs/heads/main"})

        repo = RepoConfig(name="local-repo", local_path=str(source))
        result = sync_local_repo(repo, output_dir)

        assert result is True
        assert (output_dir / "local-repo" / "file1.txt").read_text() == "hello"
        assert not (output_dir / "local-repo" / ".git").exists()

    def test_strips_git_dir_with_filters(self, tmp_path: Path, output_dir: Path):
        source = _write_files(tmp_path / "source", {"model.sql": "SELECT 1", ".git/HEAD": "ref: refs/heads/main"})

        repo = RepoConfig(name="filtered", local_path=str(source), exclude=["*.pyc"])
        result = sync_local_repo(repo, output_dir)

        assert result is True
        assert (output_dir / "filtered" / "model.sql").exists()
        assert not (output_dir / "filtered" / ".git").exists()

    def test_returns_false_for_missing_path(self, tmp_path: Path, output_dir: Path):
        repo = RepoConfig(name="missing", local_path=str(tmp_path / "nonexistent"))
        result = sync_local_repo(repo, output_dir)

        assert result is False

    def test_returns_false_for_file_not_directory(self, tmp_path: Path, output_dir: Path):
        source = tmp_path / "a_file.txt"
        source.write_text("not a dir")

        repo = RepoConfig(name="notdir", local_path=str(source))
        result = sync_local_repo(repo, output_dir)

        assert result is False


class TestSyncRepo:
    @patch(f"{PROVIDER_MODULE}.sync_local_repo")
    def test_dispatches_to_local(self, mock_local):
        mock_local.return_value = True
        repo = RepoConfig(name="local", local_path="/some/path")
        base = Path("/tmp/repos")

        result = sync_repo(repo, base)

        assert result is True
        mock_local.assert_called_once_with(repo, base)

    @patch(f"{PROVIDER_MODULE}.clone_or_pull_repo")
    def test_dispatches_to_git(self, mock_git):
        mock_git.return_value = True
        repo = RepoConfig(name="git-repo", url="https://github.com/test/repo")
        base = Path("/tmp/repos")

        result = sync_repo(repo, base)

        assert result is True
        mock_git.assert_called_once_with(repo, base)


ANALYTICS_FILES = {
    "models/orders.sql": "SELECT 1",
    "nao/tests/orders.yml": "prompt: orders",
    "nao/tests/nested/refunds.yml": "prompt: refunds",
}
_MISSING_TARGET = {"source": "nao/missing", "target": "docs/analytics"}


def _analytics_repo(**overrides: Any) -> RepoConfig:
    settings = {
        "name": "analytics",
        "url": "https://github.com/test/analytics",
        "targets": [{"source": "nao/tests", "target": "tests/analytics"}],
    }
    return RepoConfig.model_validate({**settings, **overrides})


def _list_files(root: Path) -> list[str]:
    return [path.relative_to(root).as_posix() for path in root.rglob("*") if path.is_file()]


def _write_files(root: Path, files: dict[str, str]) -> Path:
    root.mkdir(parents=True, exist_ok=True)
    for relative_path, content in files.items():
        file_path = root / relative_path
        file_path.parent.mkdir(parents=True, exist_ok=True)
        file_path.write_text(content)
    return root


def _git_repos(*names: str) -> list[RepoConfig]:
    return [RepoConfig(name=name, url=f"https://github.com/test/{name}") for name in names]


def _mock_config(repos: list[RepoConfig]) -> MagicMock:
    config = MagicMock(spec=NaoConfig)
    config.repos = repos
    return config
