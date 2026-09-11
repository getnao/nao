import importlib
import json
from unittest.mock import Mock

import pytest

stories_commands = importlib.import_module("nao_core.commands.stories")


def test_create_reads_content_and_omits_unspecified_folder(monkeypatch, capsys, tmp_path):
    content_file = tmp_path / "story.md"
    content_file.write_text("# Sales\n", encoding="utf-8")
    client = Mock()
    client.request.return_value = {"story": {"id": "story-1", "title": "Sales"}}
    client_factory = Mock(return_value=client)
    monkeypatch.setattr(stories_commands, "MigrationClient", client_factory)

    stories_commands.create(
        title="Sales",
        content_file=content_file,
        project_id="project-1",
        json_output=True,
    )

    client_factory.assert_called_once_with(project_id="project-1", noninteractive=True)
    client.request.assert_called_once_with(
        "POST",
        "/stories",
        body={"title": "Sales", "code": "# Sales\n"},
    )
    assert json.loads(capsys.readouterr().out) == {"story": {"id": "story-1", "title": "Sales"}}


def test_update_and_move_keep_explicit_story_id(monkeypatch):
    client = Mock()
    client.request.side_effect = [
        {"story": {"id": "story-1", "title": "Updated"}},
        {"storyId": "story-1", "folderId": None},
    ]
    monkeypatch.setattr(stories_commands, "MigrationClient", Mock(return_value=client))

    stories_commands.update("story-1", title="Updated")
    stories_commands.move("story-1")

    assert client.request.call_args_list[0].args == ("PATCH", "/stories/story-1")
    assert client.request.call_args_list[0].kwargs == {"body": {"title": "Updated"}}
    assert client.request.call_args_list[1].args == ("POST", "/stories/story-1/move")
    assert client.request.call_args_list[1].kwargs == {"body": {"folder_id": None}}


def test_create_folder_distinguishes_default_private_parent_from_public_root(monkeypatch):
    client = Mock()
    client.request.return_value = {"folder": {"id": "folder-1", "name": "Sales"}}
    monkeypatch.setattr(stories_commands, "MigrationClient", Mock(return_value=client))

    stories_commands.create_folder("Sales")
    stories_commands.create_folder("Sales", public_root=True)

    assert client.request.call_args_list[0].kwargs == {"body": {"name": "Sales"}}
    assert client.request.call_args_list[1].kwargs == {"body": {"name": "Sales", "parent_id": None}}


def test_update_rejects_no_fields_and_reports_content_file_errors(monkeypatch, tmp_path):
    client_factory = Mock()
    monkeypatch.setattr(stories_commands, "MigrationClient", client_factory)

    with pytest.raises(stories_commands.MigrationError, match="Provide --title or --content-file"):
        stories_commands.update("story-1")
    with pytest.raises(stories_commands.MigrationError, match="Could not read content file"):
        stories_commands.update("story-1", content_file=tmp_path / "missing.md")

    client_factory.assert_not_called()
