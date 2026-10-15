"""SQL tagging renders a leading comment with chat/user metadata and rejects
templates that would close the comment early."""

import pytest
from pydantic import ValidationError

from nao_core.config.sql_tagging import DEFAULT_TEMPLATE, SqlTaggingConfig, render_sql_tag, tag_sql


def test_default_template_renders_chat_and_user_ids():
    body = render_sql_tag(SqlTaggingConfig(), chat_id="chat-1", user_id="user-9")
    assert body == "nao chat_id=chat-1 user_id=user-9"


def test_render_returns_none_when_disabled():
    assert render_sql_tag(SqlTaggingConfig(enabled=False), chat_id="c", user_id="u") is None


def test_render_returns_none_when_config_missing():
    assert render_sql_tag(None, chat_id="c", user_id="u") is None


def test_missing_ids_render_as_unknown_so_tags_never_show_empty_values():
    body = render_sql_tag(SqlTaggingConfig(), chat_id=None, user_id=None)
    assert body == "nao chat_id=unknown user_id=unknown"


def test_admin_can_override_template_with_static_context():
    config = SqlTaggingConfig(template="env=prod chat={chat_id}")
    body = render_sql_tag(config, chat_id="abc", user_id="irrelevant")
    assert body == "env=prod chat=abc"


def test_template_supports_project_id_variable():
    config = SqlTaggingConfig(template="project={project_id} chat={chat_id}")
    body = render_sql_tag(config, chat_id="c", user_id="u", project_id="p42")
    assert body == "project=p42 chat=c"


def test_template_with_comment_terminator_is_rejected_at_validation():
    with pytest.raises(ValidationError) as info:
        SqlTaggingConfig(template="bad */ smuggled")
    assert "*/" in str(info.value)


def test_rendered_tag_dropping_closes_safely_even_if_a_value_contains_terminator():
    # Belt-and-braces: pydantic rejects it in the template, but a value coming through
    # could in principle contain '*/' if an upstream rule changes. In that case we drop
    # the tag rather than emit a comment that would break the following SQL.
    body = render_sql_tag(SqlTaggingConfig(), chat_id="danger */ --", user_id="u")
    assert body is None


def test_tag_sql_prepends_comment_on_its_own_line():
    out = tag_sql("SELECT 1", "nao chat_id=c user_id=u")
    assert out == "/* nao chat_id=c user_id=u */\nSELECT 1"


def test_tag_sql_passthrough_when_tag_is_none():
    assert tag_sql("SELECT 1", None) == "SELECT 1"


def test_default_template_is_the_published_one():
    # Pin the default so an accidental edit of DEFAULT_TEMPLATE surfaces in review.
    assert DEFAULT_TEMPLATE == "nao chat_id={chat_id} user_id={user_id}"
