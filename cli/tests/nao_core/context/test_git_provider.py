"""Tests for the git context provider."""

import shutil
import subprocess
from pathlib import Path

import pytest

from nao_core.context import get_context_provider
from nao_core.context.git import GitContextProvider, resolve_repo_root

GIT = ["git", "-c", "user.email=test@example.com", "-c", "user.name=Test"]


def _git(*args: str, cwd: Path) -> None:
    subprocess.run([*GIT, *args], cwd=cwd, check=True, capture_output=True, text=True)


@pytest.fixture
def origin(tmp_path: Path) -> Path:
    """Local repo with a nao project in a ``nao/`` subdirectory."""
    repo = tmp_path / "origin"
    (repo / "nao" / "agent" / "skills").mkdir(parents=True)
    (repo / "other").mkdir()
    _git("init", "-b", "main", cwd=repo)
    (repo / "README.md").write_text("repo root\n")
    (repo / "other" / "y.md").write_text("sibling\n")
    (repo / "nao" / "nao_config.yaml").write_text("project_name: test\n")
    (repo / "nao" / "RULES.md").write_text("initial\n")
    (repo / "nao" / "agent" / "skills" / "x.md").write_text("skill\n")
    _git("add", "-A", cwd=repo)
    _git("commit", "-m", "init", cwd=repo)
    return repo


def test_resolve_repo_root_no_subpath(tmp_path: Path) -> None:
    assert resolve_repo_root(tmp_path / "clone", None) == tmp_path / "clone"
    assert resolve_repo_root(tmp_path / "clone", "") == tmp_path / "clone"


def test_resolve_repo_root_strips_subpath_appended_by_entrypoint(tmp_path: Path) -> None:
    assert resolve_repo_root(tmp_path / "clone" / "nao", "nao") == tmp_path / "clone"


def test_resolve_repo_root_keeps_clone_named_like_subpath(tmp_path: Path) -> None:
    clone = tmp_path / "clone" / "nao"
    (clone / "nao").mkdir(parents=True)
    _git("init", "-b", "main", cwd=clone)
    (clone / "nao" / "nao_config.yaml").write_text("project_name: test\n")

    assert resolve_repo_root(clone, "nao") == clone

    provider = GitContextProvider(repo_url="unused", target_path=clone, subpath="nao")
    assert provider.repo_root == clone
    assert provider.target_path == clone / "nao"


def test_resolve_repo_root_nested_subpath(tmp_path: Path) -> None:
    assert resolve_repo_root(tmp_path / "clone" / "services" / "nao", "services/nao") == (tmp_path / "clone")


def test_resolve_repo_root_unrelated_subpath(tmp_path: Path) -> None:
    assert resolve_repo_root(tmp_path / "clone", "nao") == tmp_path / "clone"


@pytest.mark.parametrize("target", ["clone", "clone/nao"])
def test_init_from_entrypoint_target_or_clone_root(origin: Path, tmp_path: Path, target: str) -> None:
    provider = GitContextProvider(repo_url=str(origin), target_path=tmp_path / target, subpath="nao")

    provider.init()

    assert provider.is_initialized()
    assert provider.validate()
    assert provider.repo_root == tmp_path / "clone"
    assert provider.target_path == tmp_path / "clone" / "nao"
    assert (provider.target_path / "agent" / "skills" / "x.md").exists()
    assert not (tmp_path / "clone" / "other").exists()


def test_refresh_preserves_untracked_generated_context(origin: Path, tmp_path: Path) -> None:
    provider = GitContextProvider(repo_url=str(origin), target_path=tmp_path / "clone", subpath="nao")
    provider.init()

    preview = provider.target_path / "databases" / "schema=x" / "table=y" / "preview.md"
    preview.parent.mkdir(parents=True)
    preview.write_text("generated\n")

    (origin / "nao" / "RULES.md").write_text("updated\n")
    _git("commit", "-am", "update rules", cwd=origin)

    assert provider.refresh() is True
    assert (provider.target_path / "RULES.md").read_text() == "updated\n"
    assert preview.exists()

    assert provider.refresh() is False


@pytest.mark.parametrize(
    ("subpath", "expected"),
    [
        (None, "clone"),
        ("", "clone"),
        ("/", "clone"),
        (".", "clone"),
        ("/nao/", "clone"),
        ("nao", "clone"),
        ("/services/nao/", "clone"),
    ],
)
def test_resolve_repo_root_normalizes_subpath(tmp_path: Path, subpath: str | None, expected: str) -> None:
    target = tmp_path / "clone"
    assert resolve_repo_root(target, subpath) == tmp_path / expected
    assert resolve_repo_root(target, subpath) == resolve_repo_root(resolve_repo_root(target, subpath), subpath)


@pytest.mark.parametrize(
    ("subpath", "expected_target"),
    [
        (None, ()),
        ("", ()),
        ("/", ()),
        ("nao/", ("nao",)),
    ],
)
def test_get_context_provider_normalizes_subpath(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path, subpath: str | None, expected_target: tuple[str, ...]
) -> None:
    monkeypatch.setenv("NAO_CONTEXT_SOURCE", "git")
    monkeypatch.setenv("NAO_CONTEXT_GIT_URL", str(tmp_path / "origin"))
    monkeypatch.setenv("NAO_DEFAULT_PROJECT_PATH", str(tmp_path / "clone"))
    if subpath is None:
        monkeypatch.delenv("NAO_CONTEXT_GIT_SUBPATH", raising=False)
    else:
        monkeypatch.setenv("NAO_CONTEXT_GIT_SUBPATH", subpath)

    provider = get_context_provider()

    assert isinstance(provider, GitContextProvider)
    assert provider.repo_root == tmp_path / "clone"
    assert provider.target_path == tmp_path / "clone" / Path(*expected_target)


@pytest.mark.parametrize(("subpath", "sparse"), [(None, False), ("nao", True)])
def test_clone_argv_parity(tmp_path: Path, monkeypatch: pytest.MonkeyPatch, subpath: str | None, sparse: bool) -> None:
    calls: list[list[str]] = []

    def fake_run(cmd: list[str], **kwargs: object) -> subprocess.CompletedProcess:
        calls.append(cmd)
        return subprocess.CompletedProcess(cmd, 0, "", "")

    monkeypatch.setattr(subprocess, "run", fake_run)
    GitContextProvider(repo_url="unused", target_path=tmp_path / "clone", subpath=subpath)._clone()

    clone_cmd = calls[0]
    assert ("--sparse" in clone_cmd) is sparse
    assert ("--filter=blob:none" in clone_cmd) is sparse
    assert [c for c in calls[1:]] == ([["git", "sparse-checkout", "set", "nao"]] if sparse else [])


def test_is_initialized_false_when_subpath_missing_but_true_at_clone_root(tmp_path: Path) -> None:
    clone = tmp_path / "clone"
    (clone / ".git").mkdir(parents=True)

    subpath_provider = GitContextProvider(repo_url="unused", target_path=clone, subpath="nao")
    assert subpath_provider.is_initialized() is False

    root_provider = GitContextProvider(repo_url="unused", target_path=clone)
    assert root_provider.is_initialized() is True


def test_refresh_keeps_clone_when_upstream_removes_project_dir(origin: Path, tmp_path: Path) -> None:
    provider = GitContextProvider(repo_url=str(origin), target_path=tmp_path / "clone", subpath="nao")
    provider.init()

    _git("rm", "-r", "nao", cwd=origin)
    _git("commit", "-m", "drop project", cwd=origin)
    shutil.rmtree(provider.target_path)

    with pytest.raises(RuntimeError, match="upstream project directory"):
        provider.refresh()
    assert (provider.repo_root / ".git").exists()

    (origin / "nao").mkdir()
    (origin / "nao" / "nao_config.yaml").write_text("project_name: test\n")
    _git("add", "-A", cwd=origin)
    _git("commit", "-m", "restore project", cwd=origin)

    assert provider.refresh() is True
    assert provider.target_path.exists()


def test_clone_refuses_to_delete_existing_parent(tmp_path: Path) -> None:
    existing = tmp_path / "clone"
    existing.mkdir()
    (existing / "keep.txt").write_text("mine\n")
    provider = GitContextProvider(repo_url=str(tmp_path / "nope"), target_path=existing, subpath="nao")

    with pytest.raises(RuntimeError, match="(?i)remove it by hand"):
        provider.init()

    assert (existing / "keep.txt").exists()
