from typing import Optional

from pydantic import BaseModel, Field
from rich.console import Console
from rich.prompt import Prompt

console = Console()


class RepoConfig(BaseModel):
    """Repository configuration."""

    name: str = Field(description="The name of the repository")
    url: str = Field(description="The URL of the repository")
    branch: Optional[str] = Field(default=None, description="The branch of the repository")

    @classmethod
    def promptConfig(cls) -> "RepoConfig":
        """Interactively prompt the user for repository configuration."""
        console.print("\n[bold cyan]Git Repository Configuration[/bold cyan]\n")

        name = Prompt.ask("[bold]Repository name[/bold]")
        url = Prompt.ask("[bold]Repository URL[/bold]")

        return RepoConfig(name=name, url=url)
