import pytest

from nao_core.deps import MissingDependencyError, require_database_backend, require_dependency


def test_require_database_backend_uses_public_extra_for_shared_ibis_backend(monkeypatch):
    def raise_missing_backend(module_name: str):
        assert module_name == "ibis.backends.postgres"
        raise ModuleNotFoundError(module_name)

    monkeypatch.setattr("nao_core.deps.importlib.import_module", raise_missing_backend)

    with pytest.raises(MissingDependencyError) as exc_info:
        require_database_backend("postgres", extra="redshift", database_type="redshift")

    message = str(exc_info.value)
    assert "to connect to redshift databases" in message
    assert "pip install 'nao-core[redshift]'" in message
    assert "uv pip install 'nao-core[redshift]'" in message


def test_missing_dependency_error_keeps_extra_brackets_in_pip_command():
    """Provider extras must keep [name] brackets — callers escape only at render time."""
    message = str(MissingDependencyError("anthropic", "anthropic", "for Anthropic LLM provider"))
    assert "pip install 'nao-core[anthropic]'" in message
    assert "uv pip install 'nao-core[anthropic]'" in message


def test_require_dependency_raises_missing_dependency_with_extra(monkeypatch):
    def raise_import_error(module_name: str):
        raise ImportError(module_name)

    monkeypatch.setattr("nao_core.deps.importlib.import_module", raise_import_error)

    with pytest.raises(MissingDependencyError) as exc_info:
        require_dependency("anthropic", "anthropic", "for Anthropic LLM provider")

    assert "pip install 'nao-core[anthropic]'" in str(exc_info.value)
