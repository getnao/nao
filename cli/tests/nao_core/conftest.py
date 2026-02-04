import pytest


@pytest.fixture
def clean_env(monkeypatch):
    """Remove environment variables that interfere with chat command tests."""
    monkeypatch.delenv("BETTER_AUTH_SECRET", raising=False)
    monkeypatch.delenv("NAO_DEFAULT_PROJECT_PATH", raising=False)


@pytest.fixture
def create_config(tmp_path, monkeypatch):
    """Factory fixture to create a nao config file and chdir to tmp_path."""

    def _create(content: str = "project_name: test-project\n"):
        config_file = tmp_path / "nao_config.yaml"
        config_file.write_text(content)
        monkeypatch.chdir(tmp_path)
        return config_file

    return _create
