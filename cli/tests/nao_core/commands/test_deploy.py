import importlib
from types import SimpleNamespace
from unittest.mock import MagicMock

deploy_module = importlib.import_module("nao_core.commands.deploy")


def test_dry_run_sends_preview_flag_and_renders_summary(tmp_path, monkeypatch):
    (tmp_path / "nao_config.yaml").write_text("project_name: analytics\n")
    response = SimpleNamespace(
        status_code=200,
        json=lambda: {
            "status": "dry-run",
            "projectId": "project-1",
            "userGroups": {
                "summary": {"created": 1, "unchanged": 2},
                "pendingEmails": ["pending@example.com"],
                "accessChanges": ["finance"],
                "budgetChanges": ["all_users"],
                "shareRevocations": {"chats": 1, "stories": 0},
            },
        },
    )
    post = MagicMock(return_value=response)
    print_message = MagicMock()
    warn = MagicMock()
    monkeypatch.setattr(deploy_module.httpx, "post", post)
    monkeypatch.setattr(deploy_module.UI, "print", print_message)
    monkeypatch.setattr(deploy_module.UI, "warn", warn)
    monkeypatch.setattr(deploy_module.UI, "success", MagicMock())

    deploy_module.deploy("https://nao.example", "key", tmp_path, True)

    assert post.call_args.kwargs["params"] == {"dryRun": "true"}
    assert any("created: 1" in str(call.args[0]) for call in print_message.call_args_list)
    assert any("Access changes: finance" in str(call.args[0]) for call in warn.call_args_list)
    assert any("Budget changes: all_users" in str(call.args[0]) for call in warn.call_args_list)
