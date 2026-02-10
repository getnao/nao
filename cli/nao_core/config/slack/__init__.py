from pydantic import BaseModel, Field

from nao_core.ui import ask_text


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
        bot_token = ask_text("Slack bot token:", password=True, required_field=True)
        signing_secret = ask_text("Slack signing secret:", password=True, required_field=True)

        return SlackConfig(
            bot_token=bot_token,  # type: ignore
            signing_secret=signing_secret,  # type: ignore
        )
