from types import SimpleNamespace

import pytest

from nao_core.deps import (
    MissingDependencyError,
    ensure_extras_installed,
    get_missing_extras_for_databases,
    require_database_backend,
)


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


def test_get_missing_extras_for_databases_returns_uninstalled_deduped(monkeypatch):
    monkeypatch.setattr("nao_core.deps._is_extra_installed", lambda extra: extra == "duckdb")

    databases = [
        SimpleNamespace(type="snowflake"),
        SimpleNamespace(type="snowflake"),
        SimpleNamespace(type="duckdb"),
        SimpleNamespace(type="bigquery"),
    ]

    assert get_missing_extras_for_databases(databases) == ["snowflake", "bigquery"]


def test_ensure_extras_installed_returns_true_when_nothing_missing():
    assert ensure_extras_installed([]) is True


def test_ensure_extras_installed_auto_installs_when_assume_yes(monkeypatch):
    installed: list[list[str]] = []
    monkeypatch.setattr("nao_core.deps._install_with_progress", lambda extras: installed.append(extras) or True)

    def fail_if_prompted(*args, **kwargs):
        raise AssertionError("should not prompt when assume_yes is True")

    monkeypatch.setattr("nao_core.ui.ask_confirm", fail_if_prompted)

    assert ensure_extras_installed(["snowflake"], assume_yes=True) is True
    assert installed == [["snowflake"]]


def test_ensure_extras_installed_prompts_and_skips_when_declined(monkeypatch):
    monkeypatch.setattr("nao_core.ui.ask_confirm", lambda *args, **kwargs: False)
    monkeypatch.setattr(
        "nao_core.deps._install_with_progress",
        lambda extras: (_ for _ in ()).throw(AssertionError("should not install when declined")),
    )

    assert ensure_extras_installed(["snowflake"], assume_yes=False) is False
