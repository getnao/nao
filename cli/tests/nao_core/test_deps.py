import tomllib
from pathlib import Path

import pytest

from nao_core.deps import MissingDependencyError, require_database_backend


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


def test_snowflake_extra_does_not_pin_connector_directly():
    pyproject_path = Path(__file__).resolve().parents[2] / "pyproject.toml"
    pyproject = tomllib.loads(pyproject_path.read_text())

    snowflake_extra = pyproject["project"]["optional-dependencies"]["snowflake"]

    assert any(dep.startswith("ibis-framework[snowflake]") for dep in snowflake_extra)
    assert all(not dep.startswith("snowflake-connector-python") for dep in snowflake_extra)
