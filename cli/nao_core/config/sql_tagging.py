"""SQL query tagging: prepend a comment with chat/user metadata to every warehouse query.

The default template is used when an admin leaves `sql_tagging` out of `nao_config.yaml`.
When present, admins can override `template` to add their own static context (region, env)
or to leave out the ids. Templates containing `*/` are rejected so an admin cannot
accidentally close the comment early and smuggle SQL into the warehouse.
"""

from __future__ import annotations

from pydantic import BaseModel, Field, field_validator

DEFAULT_TEMPLATE = "nao chat_id={chat_id} user_id={user_id}"
_COMMENT_TERMINATOR = "*/"


class SqlTaggingConfig(BaseModel):
    """Admin-controlled SQL comment injection for warehouse queries.

    When `enabled` is true (the default), nao prepends a `/* ... */` comment to every
    query sent to the warehouse. The comment lands in the warehouse's query history
    (e.g. BigQuery INFORMATION_SCHEMA.JOBS_BY_PROJECT, Snowflake QUERY_HISTORY), so
    the audit log can attribute a query to a specific nao chat and user.
    """

    enabled: bool = Field(default=True, description="Whether to prepend a tag comment to each query.")
    template: str = Field(
        default=DEFAULT_TEMPLATE,
        min_length=1,
        max_length=1_000,
        description="Comment body template. Supported variables: {chat_id}, {user_id}, {project_id}.",
    )

    @field_validator("template")
    @classmethod
    def reject_comment_terminator(cls, value: str) -> str:
        if _COMMENT_TERMINATOR in value:
            raise ValueError("sql_tagging.template must not contain '*/' (would close the SQL comment early).")
        return value


def render_sql_tag(
    config: SqlTaggingConfig | None,
    *,
    chat_id: str | None,
    user_id: str | None,
    project_id: str | None = None,
) -> str | None:
    """Render the comment body for the current request, or None if tagging is off.

    Missing ids render as the literal "unknown" rather than an empty string, so a
    stray tag like `chat_id= user_id=abc` never shows up in the warehouse logs.
    """
    if config is None or not config.enabled:
        return None
    rendered = (
        config.template.replace("{chat_id}", chat_id or "unknown")
        .replace("{user_id}", user_id or "unknown")
        .replace("{project_id}", project_id or "unknown")
    )
    if _COMMENT_TERMINATOR in rendered:
        return None
    return rendered


def tag_sql(sql: str, tag_body: str | None) -> str:
    """Prepend `/* tag_body */` to `sql`, or return `sql` unchanged when tagging is off.

    The leading comment is kept on its own line so BigQuery/Snowflake/Postgres captures
    the original query shape in their logs without an extra prefix on the first SQL line.
    """
    if tag_body is None:
        return sql
    return f"/* {tag_body} */\n{sql}"
