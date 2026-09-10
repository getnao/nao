import importlib
import json
from unittest.mock import Mock

stories_commands = importlib.import_module("nao_core.commands.stories")


def test_create_reads_content_and_omits_unspecified_folder(monkeypatch, capsys, tmp_path):
    content_file = tmp_path / "story.md"
    content_file.write_text("# Sales\n", encoding="utf-8")
    client = Mock()
    client.request.return_value = {"story": {"id": "story-1", "title": "Sales"}}
    monkeypatch.setattr(stories_commands, "DashboardMigrationClient", lambda: client)

    stories_commands.create(title="Sales", content_file=content_file, json_output=True)

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
    monkeypatch.setattr(stories_commands, "DashboardMigrationClient", lambda: client)

    stories_commands.update("story-1", title="Updated")
    stories_commands.move("story-1")

    assert client.request.call_args_list[0].args == ("PATCH", "/stories/story-1")
    assert client.request.call_args_list[0].kwargs == {"body": {"title": "Updated"}}
    assert client.request.call_args_list[1].args == ("POST", "/stories/story-1/move")
    assert client.request.call_args_list[1].kwargs == {"body": {"folder_id": None}}
