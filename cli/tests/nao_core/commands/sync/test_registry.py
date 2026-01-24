"""Unit tests for sync accessor registry."""

from nao_core.commands.sync.accessors import (
    ColumnsAccessor,
    PreviewAccessor,
)
from nao_core.commands.sync.registry import get_accessors
from nao_core.config import AccessorType


class TestGetAccessors:
    def test_returns_accessors_for_valid_types(self):
        accessor_types = [AccessorType.COLUMNS, AccessorType.PREVIEW]
        accessors = get_accessors(accessor_types)

        assert len(accessors) == 2
        assert isinstance(accessors[0], ColumnsAccessor)
        assert isinstance(accessors[1], PreviewAccessor)

    def test_returns_empty_list_for_empty_input(self):
        accessors = get_accessors([])
        assert accessors == []

    def test_all_accessor_types(self):
        all_types = [
            AccessorType.COLUMNS,
            AccessorType.PREVIEW,
            AccessorType.DESCRIPTION,
            AccessorType.PROFILING,
        ]
        accessors = get_accessors(all_types)

        assert len(accessors) == 4
