import yaml

from nao_core.commands.migrate.tableau.configure import update_tableau_section
from nao_core.config import TableauConfig


def test_update_tableau_section_preserves_comments() -> None:
    source = """# Project guidance
project_name: example # Keep this note
tableau:
  # Connection guidance
  server: https://old.example.com # Server note
  site_name: old-site
  pat_name: old-name
  pat_value: old-secret # Secret note
  api_version: "3.20"
# LLM guidance
llm:
  provider: anthropic
"""
    tableau = TableauConfig(
        server="https://tableau.example.com",
        site_name="new-site",
        pat_name="new-name",
        pat_value="new-secret",
        api_version="3.21",
    )

    updated = update_tableau_section(source, tableau)

    for comment in (
        "# Project guidance",
        "# Keep this note",
        "# Connection guidance",
        "# Server note",
        "# Secret note",
        "# LLM guidance",
    ):
        assert comment in updated
    assert yaml.safe_load(updated)["tableau"] == tableau.model_dump()
    assert yaml.safe_load(updated)["llm"] == {"provider": "anthropic"}


def test_update_tableau_section_appends_without_rewriting_existing_yaml() -> None:
    source = """# Project guidance
project_name: example
"""
    tableau = TableauConfig(
        server="https://tableau.example.com",
        pat_name="name",
        pat_value="secret",
    )

    updated = update_tableau_section(source, tableau)

    assert updated.startswith(source)
    assert yaml.safe_load(updated)["tableau"] == tableau.model_dump()
