"""Unit tests for sync providers base classes and utilities."""

from nao_core.commands.sync.providers import (
    SyncResult,
    get_all_providers,
)
from nao_core.commands.sync.providers.databases.provider import DatabaseSyncProvider
from nao_core.commands.sync.providers.notion.provider import NotionSyncProvider
from nao_core.commands.sync.providers.repositories.provider import RepositorySyncProvider


class TestSyncResult:
    def test_get_summary_with_custom_summary(self):
        result = SyncResult(
            provider_name="Test",
            items_synced=5,
            summary="Custom summary message",
        )
        assert result.get_summary() == "Custom summary message"

    def test_get_summary_with_default_summary(self):
        result = SyncResult(
            provider_name="Test",
            items_synced=5,
        )
        assert result.get_summary() == "5 synced"

    def test_get_summary_zero_items(self):
        result = SyncResult(
            provider_name="Test",
            items_synced=0,
        )
        assert result.get_summary() == "0 synced"

    def test_result_with_details(self):
        result = SyncResult(
            provider_name="Databases",
            items_synced=10,
            details={"datasets": 2, "tables": 10},
            summary="10 tables across 2 datasets",
        )
        assert result.details == {"datasets": 2, "tables": 10}
        assert result.get_summary() == "10 tables across 2 datasets"


class TestGetAllProviders:
    def test_returns_list_of_providers(self):
        providers = get_all_providers()

        assert len(providers) == 3
        assert any(isinstance(p.provider, RepositorySyncProvider) for p in providers)
        assert any(isinstance(p.provider, DatabaseSyncProvider) for p in providers)
        assert any(isinstance(p.provider, NotionSyncProvider) for p in providers)

    def test_returns_copy_of_providers(self):
        providers1 = get_all_providers()
        providers2 = get_all_providers()

        assert providers1 is not providers2
