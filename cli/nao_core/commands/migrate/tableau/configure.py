from typing import cast

import yaml

from nao_core.config import resolve_project_path
from nao_core.config.tableau import TableauConfig
from nao_core.ui import UI, ask_text


def configure() -> None:
    project_path = resolve_project_path()
    config_path = project_path / "nao_config.yaml"

    if not config_path.exists():
        raise ValueError(f"No nao_config.yaml found in {project_path}")

    tableau = TableauConfig(
        server=cast(str, ask_text("Tableau server URL:", required_field=True)),
        site_name=ask_text("Tableau site name:", default="") or "",
        pat_name=cast(str, ask_text("Personal access token name:", required_field=True)),
        pat_value=cast(
            str,
            ask_text(
                "Personal access token secret:",
                password=True,
                required_field=True,
            ),
        ),
        api_version=ask_text("Tableau API version:", default="3.21") or "3.21",
    )

    data = yaml.safe_load(config_path.read_text()) or {}
    data["tableau"] = tableau.model_dump()
    config_path.write_text(yaml.safe_dump(data, sort_keys=False))

    UI.success("Saved Tableau configuration to nao_config.yaml")
    UI.warn("nao_config.yaml contains a plaintext Tableau secret. Do not commit it.")
