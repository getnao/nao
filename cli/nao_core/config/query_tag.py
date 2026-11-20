"""SQL query tag configuration module."""

from enum import Enum

from pydantic import BaseModel, Field


class QueryTagPosition(str, Enum):
    """Where the comment goes in the query."""

    START = "start"
    END = "end"


class QueryTagConfig(BaseModel):
    """Comment added to every SQL query nao sends to a warehouse, to find them in its query history.

    Declared here, the tag is read-only in the app (Settings > Project > Agent > SQL).
    """

    template: str = Field(
        min_length=1,
        max_length=1000,
        description=(
            "Text of the comment. `{{ user_id }}`, `{{ user_email }}`, `{{ user_groups }}`, `{{ project_id }}`, "
            "`{{ chat_id }}`, `{{ source }}` and `{{ database_id }}` are replaced for each query."
        ),
    )
    position: QueryTagPosition = Field(
        default=QueryTagPosition.START,
        description="Put the comment at the `start` or at the `end` of the query. Snowflake drops leading comments.",
    )


__all__ = ["QueryTagConfig", "QueryTagPosition"]
