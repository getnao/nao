from unittest.mock import patch

from nao_core.config.base import NaoConfig
from nao_core.config.mcp import McpConfig
from nao_core.config.skills import SkillsConfig


@patch("nao_core.config.mcp.ask_confirm")
def test_mcp_prompt_config_returns_config_and_creates_file(mock_confirm, tmp_path, monkeypatch):
    """MCP setup returns config and writes the default JSON file."""
    monkeypatch.chdir(tmp_path)
    mock_confirm.return_value = True

    config = McpConfig.promptConfig("demo")

    created_file = tmp_path / "demo" / "agent" / "mcps" / "mcp.json"
    assert config.json_file_path == "./agent/mcps/mcp.json"
    assert created_file.exists()
    assert "metabase" in created_file.read_text()


@patch("nao_core.config.skills.ask_confirm")
def test_skills_prompt_config_returns_config_and_creates_folder(mock_confirm, tmp_path, monkeypatch):
    """Skills setup returns config and creates the skills folder."""
    monkeypatch.chdir(tmp_path)
    mock_confirm.return_value = False

    config = SkillsConfig.promptConfig("demo")

    skills_folder = tmp_path / "demo" / "agent" / "skills"
    assert config.folder_path == "./agent/skills/"
    assert skills_folder.exists()
    assert (skills_folder / "top-customers.md").exists() is False


@patch("nao_core.config.base.ask_confirm")
@patch("nao_core.config.mcp.McpConfig.promptConfig")
def test_base_prompt_mcp_returns_config(mock_prompt_config, mock_confirm):
    """NaoConfig should persist MCP config when enabled."""
    mock_confirm.return_value = True
    mock_prompt_config.return_value = McpConfig(json_file_path="./agent/mcps/mcp.json")

    result = NaoConfig._prompt_mcp("demo")

    assert result is not None
    assert result.json_file_path == "./agent/mcps/mcp.json"
    mock_prompt_config.assert_called_once_with("demo")


@patch("nao_core.config.base.ask_confirm")
@patch("nao_core.config.skills.SkillsConfig.promptConfig")
def test_base_prompt_skills_returns_config(mock_prompt_config, mock_confirm):
    """NaoConfig should persist Skills config when enabled."""
    mock_confirm.return_value = True
    mock_prompt_config.return_value = SkillsConfig(folder_path="./agent/skills/")

    result = NaoConfig._prompt_skills("demo")

    assert result is not None
    assert result.folder_path == "./agent/skills/"
    mock_prompt_config.assert_called_once_with("demo")


def test_prompt_config_persists_mcp_and_skills():
    """Top-level promptConfig should carry mcp/skills values into NaoConfig."""
    mcp_config = McpConfig(json_file_path="./agent/mcps/mcp.json")
    skills_config = SkillsConfig(folder_path="./agent/skills/")

    with (
        patch.object(NaoConfig, "_prompt_databases", return_value=[]),
        patch.object(NaoConfig, "_prompt_llm", return_value=(None, False)),
        patch.object(NaoConfig, "_configure_ai_summary_accessors", side_effect=lambda dbs, llm, enabled: dbs),
        patch.object(NaoConfig, "_prompt_repos", return_value=[]),
        patch.object(NaoConfig, "_prompt_slack", return_value=None),
        patch.object(NaoConfig, "_prompt_notion", return_value=None),
        patch.object(NaoConfig, "_prompt_mcp", return_value=mcp_config),
        patch.object(NaoConfig, "_prompt_skills", return_value=skills_config),
    ):
        config = NaoConfig.promptConfig("demo")

    assert config.mcp == mcp_config
    assert config.skills == skills_config
