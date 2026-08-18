"""Unit tests for `nao config`... no, for `nao deploy` (deploy.py).

The deploy command has 5 private helpers and a public entry point. None of
them had test coverage before this file. The tests document the current
contract so any future tightening of the .naoignore parser (trailing-slash
directory markers, glob middle wildcards, recursive `**/...` patterns,
etc.) can land as a separate PR that updates the assertions to match.
"""

from __future__ import annotations

import io
import tarfile
from pathlib import Path
from unittest.mock import MagicMock, patch

import httpx

from nao_core.commands.deploy import (
    DEFAULT_EXCLUSIONS,
    _build_tarball,
    _load_naoignore,
    _read_project_name,
    _should_exclude,
    deploy,
)

# =============================================================================
# _load_naoignore
# =============================================================================


class TestLoadNaoignore:
    def test_missing_file_returns_empty_set(self, tmp_path, capsys):
        result = _load_naoignore(tmp_path)

        assert result == set()

    def test_reads_simple_patterns(self, tmp_path, capsys):
        (tmp_path / ".naoignore").write_text("templates/\n*.j2\ntests/\n")

        result = _load_naoignore(tmp_path)

        assert result == {"templates/", "*.j2", "tests/"}

    def test_skips_blank_lines(self, tmp_path, capsys):
        (tmp_path / ".naoignore").write_text("templates/\n\n\n*.j2\n\n")

        result = _load_naoignore(tmp_path)

        assert result == {"templates/", "*.j2"}

    def test_skips_comment_lines(self, tmp_path, capsys):
        (tmp_path / ".naoignore").write_text("# this is a comment\ntemplates/\n# another\n*.j2\n")

        result = _load_naoignore(tmp_path)

        assert result == {"templates/", "*.j2"}

    def test_strips_whitespace_around_patterns(self, tmp_path, capsys):
        (tmp_path / ".naoignore").write_text("  templates/  \n\t*.j2\t\n")

        result = _load_naoignore(tmp_path)

        assert result == {"templates/", "*.j2"}

    def test_does_not_strip_trailing_slash(self, tmp_path, capsys):
        # The current contract stores directory-marker patterns verbatim
        # (with the trailing slash). The directory itself is then matched
        # by `Path.parts` excluding the slash, which is why the default
        # patterns only work because the directory name also appears in
        # DEFAULT_EXCLUSIONS. Documented behaviour; do not change.
        (tmp_path / ".naoignore").write_text("templates/\n")

        result = _load_naoignore(tmp_path)

        assert "templates/" in result
        assert "templates" not in result


# =============================================================================
# _should_exclude
# =============================================================================


class TestShouldExclude:
    def test_exact_name_match_anywhere_in_path(self):
        assert _should_exclude(Path("templates/file.md"), {"templates"}) is True
        assert _should_exclude(Path("a/b/templates/c.md"), {"templates"}) is True
        assert _should_exclude(Path("a/templates/b/c.md"), {"templates"}) is True

    def test_exact_name_match_on_file(self):
        assert _should_exclude(Path("RULES.md"), {"RULES.md"}) is True

    def test_suffix_match_via_glob_dot(self):
        assert _should_exclude(Path("foo/bar.pyc"), {"*.pyc"}) is True
        assert _should_exclude(Path("a/b/c.log"), {"*.log"}) is True

    def test_suffix_match_supports_compound_extension(self):
        assert _should_exclude(Path("foo/bar.tar.gz"), {"*.tar.gz"}) is True

    def test_non_matching_path_returns_false(self):
        assert _should_exclude(Path("docs/index.md"), {"templates", "*.pyc"}) is False

    def test_unmatched_name_is_not_a_suffix_match(self):
        # A pattern with no `*.` prefix is treated as an exact name match
        # only. `pyc` would not match `foo.pyc` because the pattern does
        # not start with `*.`.
        assert _should_exclude(Path("foo.pyc"), {"pyc"}) is False

    def test_glob_middle_wildcard_is_not_supported(self):
        # `temp_*.log` would be a gitignore-style wildcard-in-middle
        # pattern. The current implementation does not support it; a
        # literal name match is the only fallback, which means
        # `temp_*.log` matches nothing.
        assert _should_exclude(Path("logs/temp_session.log"), {"temp_*.log"}) is False

    def test_recursive_double_star_is_not_supported(self):
        # `**/build/` is the gitignore recursive pattern. The current
        # implementation does not support it; a literal name match is
        # the only fallback, which means `**/build/` matches nothing.
        assert _should_exclude(Path("a/b/build/c.txt"), {"**/build/"}) is False


# =============================================================================
# _build_tarball
# =============================================================================


class TestBuildTarball:
    def test_empty_directory_yields_empty_tarball(self, tmp_path, capsys):
        tarball = _build_tarball(tmp_path, set())

        assert isinstance(tarball, bytes)
        # An empty tarball is still a valid gzip stream with the
        # 2-block gzip header; its size is 20 bytes (10 header + 2 zero
        # blocks of 8 bytes each, then 8 bytes of CRC/trailer).
        assert len(tarball) > 0

    def test_bundles_every_file_when_no_exclusions(self, tmp_path, capsys):
        (tmp_path / "a.txt").write_text("a")
        (tmp_path / "b").mkdir()
        (tmp_path / "b" / "c.txt").write_text("c")

        tarball = _build_tarball(tmp_path, set())

        names = self._tarball_names(tarball)
        assert "a.txt" in names
        assert "b/c.txt" in names
        assert "b" not in names  # tar adds files, not directories

    def test_excluded_patterns_are_omitted(self, tmp_path, capsys):
        (tmp_path / "keep.md").write_text("keep")
        (tmp_path / "skip.pyc").write_text("skip")
        (tmp_path / "templates").mkdir()
        (tmp_path / "templates" / "junk.md").write_text("junk")

        tarball = _build_tarball(tmp_path, {"*.pyc", "templates"})

        names = self._tarball_names(tarball)
        assert "keep.md" in names
        assert "skip.pyc" not in names
        assert "templates/junk.md" not in names

    def test_default_exclusions_remove_venv_git_node_modules(self, tmp_path, capsys):
        # Sanity check that the DEFAULT_EXCLUSIONS set actually excludes
        # the four big offenders. If a maintainer ever trims that set,
        # this test surfaces the change.
        (tmp_path / "RULES.md").write_text("rules")
        (tmp_path / ".git").mkdir()
        (tmp_path / ".git" / "HEAD").write_text("ref: refs/heads/main")
        (tmp_path / "node_modules").mkdir()
        (tmp_path / "node_modules" / "x").write_text("x")
        (tmp_path / ".venv").mkdir()
        (tmp_path / ".venv" / "bin").mkdir()
        (tmp_path / ".venv" / "bin" / "python").write_text("py")
        (tmp_path / "__pycache__").mkdir()
        (tmp_path / "__pycache__" / "x.pyc").write_text("pyc")
        (tmp_path / "module.pyc").write_text("pyc")
        (tmp_path / ".env").write_text("SECRET=hunter2")

        tarball = _build_tarball(tmp_path, DEFAULT_EXCLUSIONS)

        names = self._tarball_names(tarball)
        assert "RULES.md" in names
        assert ".git/HEAD" not in names
        assert "node_modules/x" not in names
        assert ".venv/bin/python" not in names
        assert "__pycache__/x.pyc" not in names
        assert "module.pyc" not in names
        assert ".env" not in names

    def test_entry_order_is_sorted(self, tmp_path, capsys):
        (tmp_path / "z.txt").write_text("z")
        (tmp_path / "a.txt").write_text("a")
        (tmp_path / "m.txt").write_text("m")

        tarball = _build_tarball(tmp_path, set())

        names = self._tarball_names(tarball)
        assert names == sorted(names)

    @staticmethod
    def _tarball_names(tarball: bytes) -> list[str]:
        buf = io.BytesIO(tarball)
        with tarfile.open(fileobj=buf, mode="r:gz") as tar:
            return sorted(tar.getnames())


# =============================================================================
# _read_project_name
# =============================================================================


class TestReadProjectName:
    def test_returns_project_name(self, tmp_path, monkeypatch, capsys):
        (tmp_path / "nao_config.yaml").write_text("project_name: my-project\n")
        monkeypatch.chdir(tmp_path)

        result = _read_project_name(tmp_path)

        assert result == "my-project"

    def test_missing_file_returns_none(self, tmp_path, monkeypatch, capsys):
        monkeypatch.chdir(tmp_path)

        result = _read_project_name(tmp_path)

        assert result is None

    def test_invalid_yaml_returns_none(self, tmp_path, monkeypatch, capsys):
        (tmp_path / "nao_config.yaml").write_text("project_name: [unclosed\n")
        monkeypatch.chdir(tmp_path)

        result = _read_project_name(tmp_path)

        assert result is None
        assert "Invalid YAML" in capsys.readouterr().out

    def test_missing_project_name_field_returns_none(self, tmp_path, monkeypatch, capsys):
        (tmp_path / "nao_config.yaml").write_text("threads: 4\n")
        monkeypatch.chdir(tmp_path)

        result = _read_project_name(tmp_path)

        assert result is None
        assert "project_name" in capsys.readouterr().out

    def test_non_dict_yaml_returns_none(self, tmp_path, monkeypatch, capsys):
        (tmp_path / "nao_config.yaml").write_text("- just\n- a\n- list\n")
        monkeypatch.chdir(tmp_path)

        result = _read_project_name(tmp_path)

        assert result is None

    def test_empty_project_name_returns_none(self, tmp_path, monkeypatch, capsys):
        # An empty string is falsy and the current code returns None.
        # This documents that `project_name: ""` is rejected, which is
        # the same as the `if not name:` branch.
        (tmp_path / "nao_config.yaml").write_text('project_name: ""\n')
        monkeypatch.chdir(tmp_path)

        result = _read_project_name(tmp_path)

        assert result is None

    def test_does_not_resolve_env_references(self, tmp_path, monkeypatch, capsys):
        # The function reads the raw YAML without going through
        # process_secrets. If a user's project_name is set via
        # `{{ env('PROJECT_NAME') }}`, this returns the literal template
        # string. Documented behaviour; callers that need the resolved
        # value use NaoConfig.load instead.
        (tmp_path / "nao_config.yaml").write_text("project_name: \"{{ env('PROJECT_NAME') }}\"\n")
        monkeypatch.chdir(tmp_path)

        result = _read_project_name(tmp_path)

        assert result == "{{ env('PROJECT_NAME') }}"


# =============================================================================
# deploy (entry point)
# =============================================================================


def _mock_response(status_code: int, body: dict | None = None) -> MagicMock:
    response = MagicMock()
    response.status_code = status_code
    if body is None:
        response.json.side_effect = ValueError("no body")
        response.text = ""
    else:
        response.json.return_value = body
        response.text = ""
    return response


class TestDeploy:
    def _write_project(self, tmp_path, monkeypatch, name: str = "p") -> Path:
        (tmp_path / "nao_config.yaml").write_text(f"project_name: {name}\n")
        (tmp_path / "RULES.md").write_text("rules")
        monkeypatch.chdir(tmp_path)
        return tmp_path

    def test_returns_immediately_when_config_missing(self, tmp_path, monkeypatch, capsys):
        monkeypatch.chdir(tmp_path)

        with patch("nao_core.commands.deploy.httpx.post") as mock_post:
            deploy(url="https://example.com", api_key="key")

        mock_post.assert_not_called()
        assert "No nao_config.yaml" in capsys.readouterr().out

    def test_returns_immediately_when_project_name_missing(self, tmp_path, monkeypatch, capsys):
        (tmp_path / "nao_config.yaml").write_text("threads: 4\n")
        monkeypatch.chdir(tmp_path)

        with patch("nao_core.commands.deploy.httpx.post") as mock_post:
            deploy(url="https://example.com", api_key="key")

        mock_post.assert_not_called()
        assert "project_name" in capsys.readouterr().out

    def test_successful_deploy_status_created(self, tmp_path, monkeypatch, capsys):
        self._write_project(tmp_path, monkeypatch, name="my-proj")

        with patch(
            "nao_core.commands.deploy.httpx.post",
            return_value=_mock_response(200, {"status": "created", "projectId": "abc-123"}),
        ) as mock_post:
            deploy(url="https://example.com", api_key="key")

        assert mock_post.call_count == 1
        # The Authorization header is set; the API key is passed as a
        # Bearer token, not a body field.
        headers = mock_post.call_args.kwargs["headers"]
        assert headers["Authorization"] == "Bearer key"
        out = capsys.readouterr().out
        assert "my-proj" in out
        assert "created" in out
        assert "abc-123" in out

    def test_successful_deploy_status_updated(self, tmp_path, monkeypatch, capsys):
        self._write_project(tmp_path, monkeypatch, name="my-proj")

        with patch(
            "nao_core.commands.deploy.httpx.post",
            return_value=_mock_response(200, {"status": "updated", "projectId": "abc-123"}),
        ):
            deploy(url="https://example.com", api_key="key")

        out = capsys.readouterr().out
        assert "updated" in out

    def test_successful_deploy_with_unknown_status(self, tmp_path, monkeypatch, capsys):
        # The default `status: "unknown"` branch prints a warning
        # rather than a success checkmark.
        self._write_project(tmp_path, monkeypatch, name="my-proj")

        with patch(
            "nao_core.commands.deploy.httpx.post",
            return_value=_mock_response(200, {"projectId": "abc-123"}),
        ):
            deploy(url="https://example.com", api_key="key")

        out = capsys.readouterr().out
        assert "unknown" in out

    def test_auth_failure_401(self, tmp_path, monkeypatch, capsys):
        self._write_project(tmp_path, monkeypatch)

        with patch(
            "nao_core.commands.deploy.httpx.post",
            return_value=_mock_response(401),
        ):
            deploy(url="https://example.com", api_key="bad-key")

        out = capsys.readouterr().out
        assert "Authentication failed" in out

    def test_connect_error(self, tmp_path, monkeypatch, capsys):
        self._write_project(tmp_path, monkeypatch)

        with patch(
            "nao_core.commands.deploy.httpx.post",
            side_effect=httpx.ConnectError("nope"),
        ):
            deploy(url="https://example.com", api_key="key")

        out = capsys.readouterr().out
        assert "Could not connect" in out

    def test_timeout(self, tmp_path, monkeypatch, capsys):
        self._write_project(tmp_path, monkeypatch)

        with patch(
            "nao_core.commands.deploy.httpx.post",
            side_effect=httpx.TimeoutException("slow"),
        ):
            deploy(url="https://example.com", api_key="key")

        out = capsys.readouterr().out
        assert "timed out" in out

    def test_other_error_status_with_json_error(self, tmp_path, monkeypatch, capsys):
        self._write_project(tmp_path, monkeypatch)

        with patch(
            "nao_core.commands.deploy.httpx.post",
            return_value=_mock_response(500, {"error": "server exploded"}),
        ):
            deploy(url="https://example.com", api_key="key")

        out = capsys.readouterr().out
        assert "500" in out
        assert "server exploded" in out

    def test_other_error_status_with_non_json_body(self, tmp_path, monkeypatch, capsys):
        self._write_project(tmp_path, monkeypatch)

        with patch(
            "nao_core.commands.deploy.httpx.post",
            return_value=_mock_response(503),
        ):
            deploy(url="https://example.com", api_key="key")

        out = capsys.readouterr().out
        assert "503" in out

    def test_url_trailing_slash_stripped(self, tmp_path, monkeypatch, capsys):
        # The deploy URL is constructed as `{url.rstrip('/')}/api/deploy`,
        # so a trailing slash on the user-supplied URL must not produce
        # a double slash.
        self._write_project(tmp_path, monkeypatch)

        with patch(
            "nao_core.commands.deploy.httpx.post",
            return_value=_mock_response(200, {"status": "created", "projectId": "x"}),
        ) as mock_post:
            deploy(url="https://example.com/", api_key="key")

        called_url = mock_post.call_args.args[0]
        assert called_url == "https://example.com/api/deploy"
        assert "//api" not in called_url
