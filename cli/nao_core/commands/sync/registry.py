"""Accessor registry for mapping accessor types to implementations."""

from nao_core.config import AccessorType

from .accessors import (
    ColumnsAccessor,
    DataAccessor,
    DescriptionAccessor,
    PreviewAccessor,
    ProfilingAccessor,
)

ACCESSOR_REGISTRY: dict[AccessorType, DataAccessor] = {
    AccessorType.COLUMNS: ColumnsAccessor(),
    AccessorType.PREVIEW: PreviewAccessor(num_rows=10),
    AccessorType.DESCRIPTION: DescriptionAccessor(),
    AccessorType.PROFILING: ProfilingAccessor(),
}


def get_accessors(accessor_types: list[AccessorType]) -> list[DataAccessor]:
    """Get accessor instances for the given types."""
    return [ACCESSOR_REGISTRY[t] for t in accessor_types if t in ACCESSOR_REGISTRY]
