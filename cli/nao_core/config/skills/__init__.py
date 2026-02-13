"""Skills configuration module."""

from pathlib import Path

from pydantic import BaseModel, Field

from nao_core.ui import UI, ask_confirm

from .template import generate_top_customers_skill


class SkillsConfig(BaseModel):
    """Skills configuration."""

    folder_path: str = Field(description="Path to the skills folder")

    @classmethod
    def promptConfig(cls, project_name: str) -> None:
        """Prompt for skills configuration."""
        folder_path = "./agent/skills/"

        # Expand and resolve path
        path = Path(folder_path).expanduser()
        if not path.is_absolute():
            base_path = Path(project_name) if project_name else Path.cwd()
            absolute_path = (base_path / path).resolve()
        else:
            absolute_path = path.resolve()

        # Create folder if doesn't exist
        if not absolute_path.exists():
            absolute_path.mkdir(parents=True, exist_ok=True)

            if ask_confirm(
                "Setup skills folder with top-customers example skill?",
                default=True,
            ):
                # Create top-customers skill file
                skill_file = absolute_path / "top-customers.md"
                skill_file.write_text(generate_top_customers_skill())
                UI.success(f"Created skills folder with top-customers example: {absolute_path}")
            else:
                UI.success(f"Created empty skills folder: {absolute_path}")

        elif not absolute_path.is_dir():
            raise ValueError(f"Skills path exists but is not a directory: {absolute_path}")
