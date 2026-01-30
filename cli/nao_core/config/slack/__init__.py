from pydantic import BaseModel, Field
from rich.console import Console
from rich.prompt import Prompt

from nao_core.config.exceptions import InitError

console = Console()


class SlackConfig(BaseModel):
    """Slack configuration."""

    bot_token: str = Field(description="The bot token to use")
    signing_secret: str = Field(description="The signing secret for verifying requests")
    post_message_url: str = Field(
        default="https://slack.com/api/chat.postMessage",
        description="The Slack API URL for posting messages",
    )

    @classmethod
    def promptConfig(cls) -> "SlackConfig":
        """Interactively prompt the user for Slack configuration."""
        console.print("\n[bold cyan]Slack Configuration[/bold cyan]\n")

        bot_token = Prompt.ask(
            "[bold]Enter your Slack bot token[/bold]",
            password=True,
        )

        if not bot_token:
            raise InitError("Slack bot token cannot be empty.")

        signing_secret = Prompt.ask(
            "[bold]Enter your Slack signing secret[/bold]",
            password=True,
        )

        if not signing_secret:
            raise InitError("Slack signing secret cannot be empty.")

        return SlackConfig(
            bot_token=bot_token,
            signing_secret=signing_secret,
        )
