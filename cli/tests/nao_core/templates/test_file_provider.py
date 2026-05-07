"""Unit tests for the FileProvider class."""

import json
from pathlib import Path

import pytest
import yaml

from nao_core.templates.context import FileProvider


@pytest.fixture()
def project_dir(tmp_path: Path) -> Path:
    """Create a temporary project directory with test files."""
    (tmp_path / "metadata.yaml").write_text(yaml.dump({"name": "test", "version": 2}))
    (tmp_path / "empty.yaml").write_text("")
    (tmp_path / "config.json").write_text(json.dumps({"key": "value", "items": [1, 2]}))
    (tmp_path / "data.csv").write_text("name,age\nAlice,30\nBob,25\n")
    (tmp_path / "readme.txt").write_text("Hello, world!")
    (tmp_path / "doc.md").write_text("---\ntitle: Test\ntags:\n  - a\n  - b\n---\n\nBody content here.")
    (tmp_path / "plain.md").write_text("Just plain markdown.")

    sub = tmp_path / "schemas"
    sub.mkdir()
    (sub / "users.yaml").write_text(yaml.dump({"table": "users"}))
    (sub / "orders.yaml").write_text(yaml.dump({"table": "orders"}))

    return tmp_path


@pytest.fixture()
def provider(project_dir: Path) -> FileProvider:
    return FileProvider(project_dir)


class TestYaml:
    def test_reads_yaml(self, provider: FileProvider):
        result = provider.yaml("metadata.yaml")
        assert result == {"name": "test", "version": 2}

    def test_empty_yaml_returns_empty_dict(self, provider: FileProvider):
        result = provider.yaml("empty.yaml")
        assert result == {}

    def test_invalid_yaml_raises(self, provider: FileProvider, project_dir: Path):
        (project_dir / "bad.yaml").write_text(":\n  - :\n    invalid: [")
        with pytest.raises(ValueError, match="Failed to parse YAML"):
            provider.yaml("bad.yaml")

    def test_caches_result(self, provider: FileProvider):
        result1 = provider.yaml("metadata.yaml")
        result2 = provider.yaml("metadata.yaml")
        assert result1 is result2


class TestJson:
    def test_reads_json(self, provider: FileProvider):
        result = provider.json("config.json")
        assert result == {"key": "value", "items": [1, 2]}

    def test_invalid_json_raises(self, provider: FileProvider, project_dir: Path):
        (project_dir / "bad.json").write_text("{not valid json")
        with pytest.raises(ValueError, match="Failed to parse JSON"):
            provider.json("bad.json")


class TestCsv:
    def test_reads_csv(self, provider: FileProvider):
        result = provider.csv("data.csv")
        assert len(result) == 2
        assert result[0] == {"name": "Alice", "age": "30"}
        assert result[1] == {"name": "Bob", "age": "25"}


class TestText:
    def test_reads_text(self, provider: FileProvider):
        result = provider.text("readme.txt")
        assert result == "Hello, world!"

    def test_binary_file_raises(self, provider: FileProvider, project_dir: Path):
        (project_dir / "binary.bin").write_bytes(b"\x00\x01\x80\xff" * 100)
        with pytest.raises(ValueError, match="not valid UTF-8"):
            provider.text("binary.bin")


class TestFrontmatter:
    def test_parses_frontmatter(self, provider: FileProvider):
        result = provider.frontmatter("doc.md")
        assert result["meta"] == {"title": "Test", "tags": ["a", "b"]}
        assert result["content"] == "Body content here."

    def test_no_frontmatter(self, provider: FileProvider):
        result = provider.frontmatter("plain.md")
        assert result["meta"] == {}
        assert result["content"] == "Just plain markdown."


class TestGlob:
    def test_glob_pattern(self, provider: FileProvider):
        result = provider.glob("schemas/*.yaml")
        assert "schemas/orders.yaml" in result
        assert "schemas/users.yaml" in result

    def test_glob_no_matches(self, provider: FileProvider):
        result = provider.glob("*.nonexistent")
        assert result == []


class TestExists:
    def test_existing_file(self, provider: FileProvider):
        assert provider.exists("metadata.yaml") is True

    def test_missing_file(self, provider: FileProvider):
        assert provider.exists("nope.yaml") is False

    def test_traversal_returns_false(self, provider: FileProvider):
        assert provider.exists("../../etc/passwd") is False


class TestPathSecurity:
    def test_absolute_path_rejected(self, provider: FileProvider):
        with pytest.raises(ValueError, match="Absolute paths are not allowed"):
            provider.text("/etc/passwd")

    def test_traversal_rejected(self, provider: FileProvider):
        with pytest.raises(ValueError, match="Path traversal is not allowed"):
            provider.text("../../etc/passwd")

    def test_subdirectory_allowed(self, provider: FileProvider):
        result = provider.yaml("schemas/users.yaml")
        assert result == {"table": "users"}

    def test_directory_path_rejected(self, provider: FileProvider):
        with pytest.raises(ValueError, match="is a directory"):
            provider.text("schemas")

    def test_glob_traversal_rejected(self, provider: FileProvider):
        with pytest.raises(ValueError, match="Path traversal is not allowed"):
            provider.glob("../../**/*")


class TestMissingFile:
    def test_file_not_found_with_suggestion(self, provider: FileProvider):
        with pytest.raises(FileNotFoundError, match="Did you mean"):
            provider.text("readmee.txt")

    def test_file_not_found_no_suggestion(self, provider: FileProvider):
        with pytest.raises(FileNotFoundError, match="File not found"):
            provider.text("nonexistent/deep/path.txt")


class TestFileSizeLimit:
    def test_large_file_rejected(self, provider: FileProvider, project_dir: Path):
        big = project_dir / "huge.txt"
        big.write_bytes(b"x" * (10 * 1024 * 1024 + 1))
        with pytest.raises(ValueError, match="exceeds 10MB"):
            provider.text("huge.txt")


class TestPermissionError:
    def test_permission_denied(self, provider: FileProvider, project_dir: Path):
        restricted = project_dir / "secret.txt"
        restricted.write_text("secret")
        restricted.chmod(0o000)
        try:
            with pytest.raises(PermissionError, match="Permission denied"):
                provider.text("secret.txt")
        finally:
            restricted.chmod(0o644)


class TestNoProjectPath:
    def test_nao_context_file_without_project_path(self):
        from unittest.mock import MagicMock

        from nao_core.templates.context import NaoContext

        config = MagicMock()
        ctx = NaoContext(config, project_path=None)
        with pytest.raises(RuntimeError, match="File reading requires a project path"):
            _ = ctx.file
