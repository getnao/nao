"""Validation tests for the Confluence configuration model."""

from unittest.mock import patch

import pytest
from pydantic import ValidationError

from nao_core.config.confluence import ConfluenceConfig


def test_cloud_config_requires_email_and_token():
    with pytest.raises(ValidationError):
        ConfluenceConfig(base_url="https://acme.atlassian.net/wiki", deployment="cloud", pages=["100"])


def test_cloud_config_is_valid_with_email_and_token():
    config = ConfluenceConfig(
        base_url="https://acme.atlassian.net/wiki",
        deployment="cloud",
        email="me@acme.com",
        api_token="secret",
        spaces=["ENG"],
    )
    assert config.deployment == "cloud"


def test_server_config_accepts_a_personal_access_token():
    config = ConfluenceConfig(
        base_url="https://confluence.acme.com",
        deployment="server",
        personal_access_token="pat",
        pages=["100"],
    )
    assert config.personal_access_token == "pat"


def test_server_config_accepts_username_and_password():
    config = ConfluenceConfig(
        base_url="https://confluence.acme.com",
        deployment="server",
        username="user",
        password="pass",
        pages=["100"],
    )
    assert config.username == "user"


def test_server_config_requires_some_credential():
    with pytest.raises(ValidationError):
        ConfluenceConfig(base_url="https://confluence.acme.com", deployment="server", pages=["100"])


def test_config_requires_some_content_selector():
    with pytest.raises(ValidationError):
        ConfluenceConfig(
            base_url="https://acme.atlassian.net/wiki",
            deployment="cloud",
            email="me@acme.com",
            api_token="secret",
        )


def test_config_accepts_page_trees_or_labels_alone():
    trees = ConfluenceConfig(
        base_url="https://acme.atlassian.net/wiki",
        deployment="cloud",
        email="me@acme.com",
        api_token="secret",
        page_trees=["164100"],
    )
    labels = ConfluenceConfig(
        base_url="https://acme.atlassian.net/wiki",
        deployment="cloud",
        email="me@acme.com",
        api_token="secret",
        labels=["DATA:glossary"],
    )
    assert trees.page_trees == ["164100"]
    assert labels.labels == ["DATA:glossary"]


@pytest.mark.parametrize("base_url", ["", "   ", "acme.atlassian.net/wiki", "ftp://acme.atlassian.net"])
def test_config_rejects_a_non_absolute_http_base_url(base_url):
    with pytest.raises(ValidationError):
        ConfluenceConfig(
            base_url=base_url,
            deployment="cloud",
            email="me@acme.com",
            api_token="secret",
            spaces=["ENG"],
        )


@pytest.mark.parametrize("selectors", [{"pages": ["100", ""]}, {"spaces": ["  "]}, {"labels": ["ENG:glossary", ""]}])
def test_config_rejects_blank_selector_entries(selectors):
    with pytest.raises(ValidationError):
        ConfluenceConfig(
            base_url="https://acme.atlassian.net/wiki",
            deployment="cloud",
            email="me@acme.com",
            api_token="secret",
            **selectors,
        )


@patch("nao_core.config.confluence.UI")
@patch("nao_core.config.confluence.ask_text")
def test_prompt_reasks_content_selectors_until_one_is_provided(mock_ask_text, _mock_ui):
    """A first empty pass through the selectors should re-prompt instead of crashing."""
    empty_round = ["", "", "", ""]
    filled_round = ["", "", "", "ENG"]
    mock_ask_text.side_effect = [*empty_round, *filled_round]

    pages, page_trees, labels, spaces = ConfluenceConfig._promptContentSelectors()

    assert (pages, page_trees, labels) == ([], [], [])
    assert spaces == ["ENG"]
    assert mock_ask_text.call_count == 8
