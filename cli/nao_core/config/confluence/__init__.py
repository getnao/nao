from typing import Literal, Optional
from urllib.parse import urlparse

from pydantic import BaseModel, Field, model_validator

from nao_core.ui import UI, ask_select, ask_text

Deployment = Literal["cloud", "server"]

SELECTOR_FIELDS = ("pages", "page_trees", "labels", "spaces")


class ConfluenceConfig(BaseModel):
    """Confluence configuration."""

    base_url: str = Field(
        description="The Confluence base URL, e.g. https://acme.atlassian.net/wiki (Cloud) "
        "or https://confluence.acme.com (Data Center/Server)"
    )
    deployment: Deployment = Field(
        default="cloud",
        description="Which Confluence flavour to talk to: 'cloud' or 'server' (Data Center/Server)",
    )
    email: Optional[str] = Field(default=None, description="Account email for Confluence Cloud (Basic auth username)")
    api_token: Optional[str] = Field(default=None, description="API token for Confluence Cloud (Basic auth password)")
    personal_access_token: Optional[str] = Field(
        default=None, description="Personal access token for Confluence Data Center/Server (Bearer auth)"
    )
    username: Optional[str] = Field(default=None, description="Username for Data Center/Server Basic auth")
    password: Optional[str] = Field(default=None, description="Password for Data Center/Server Basic auth")
    pages: list[str] = Field(
        default_factory=list, description="The pages to sync, as numeric page IDs or URLs that carry one"
    )
    page_trees: list[str] = Field(
        default_factory=list,
        description="Pages whose whole subtree to sync (the page and all its descendants), as IDs or URLs",
    )
    labels: list[str] = Field(
        default_factory=list,
        description="Labels to sync; every page carrying one is pulled. Scope to a space with 'SPACE:label'",
    )
    spaces: list[str] = Field(default_factory=list, description="The space keys to sync in full, e.g. 'ENG' or 'DATA'")

    @model_validator(mode="after")
    def validate_config(self) -> "ConfluenceConfig":
        self._validate_base_url()

        selectors = [entry for field in SELECTOR_FIELDS for entry in getattr(self, field)]
        if not selectors:
            raise ValueError("Confluence needs at least one of 'pages', 'page_trees', 'labels' or 'spaces' to sync")
        if any(not entry.strip() for entry in selectors):
            raise ValueError(
                "Confluence selectors must not be empty; remove blank entries from "
                "'pages', 'page_trees', 'labels' or 'spaces'"
            )

        if self.deployment == "cloud":
            if not self.email or not self.api_token:
                raise ValueError("Confluence Cloud needs both 'email' and 'api_token'")
        else:
            has_pat = bool(self.personal_access_token)
            has_basic = bool(self.username and self.password)
            if not has_pat and not has_basic:
                raise ValueError(
                    "Confluence Data Center/Server needs either 'personal_access_token' "
                    "or both 'username' and 'password'"
                )

        return self

    def _validate_base_url(self) -> None:
        parsed = urlparse((self.base_url or "").strip())
        if parsed.scheme not in ("http", "https") or not parsed.netloc:
            raise ValueError(
                "Confluence 'base_url' must be a non-empty absolute HTTP(S) URL, e.g. "
                "https://acme.atlassian.net/wiki (Cloud) or https://confluence.acme.com (Data Center/Server)"
            )

    @classmethod
    def promptConfig(cls) -> "ConfluenceConfig":
        """Interactively prompt the user for Confluence configuration."""
        base_url = ask_text("Confluence base URL (e.g. https://acme.atlassian.net/wiki):", required_field=True)
        deployment = ask_select("Confluence deployment:", choices=["cloud", "server"], default="cloud")

        email = api_token = personal_access_token = username = password = None
        if deployment == "cloud":
            email = ask_text("Confluence account email:", required_field=True)
            api_token = ask_text("Confluence API token:", password=True, required_field=True)
        else:
            personal_access_token = ask_text(
                "Personal access token (leave empty to use username/password):", password=True
            )
            if not personal_access_token:
                username = ask_text("Username:", required_field=True)
                password = ask_text("Password:", password=True, required_field=True)

        pages, page_trees, labels, spaces = cls._promptContentSelectors()

        return ConfluenceConfig(
            base_url=base_url,  # type: ignore
            deployment=deployment,  # type: ignore
            email=email,
            api_token=api_token,
            personal_access_token=personal_access_token,
            username=username,
            password=password,
            pages=pages,
            page_trees=page_trees,
            labels=labels,
            spaces=spaces,
        )

    @staticmethod
    def _promptContentSelectors() -> tuple[list[str], list[str], list[str], list[str]]:
        """Prompt for what to sync, re-asking until at least one selector is provided."""
        while True:
            UI.info("Enter Confluence page IDs or URLs to sync (comma-separated, optional):")
            pages = _split(ask_text("Pages:"))

            UI.info("Enter pages whose whole subtree to sync (comma-separated IDs or URLs, optional):")
            page_trees = _split(ask_text("Page trees:"))

            UI.info("Enter labels to sync, optionally scoped as SPACE:label (comma-separated, optional):")
            labels = _split(ask_text("Labels:"))

            UI.info("Enter Confluence space keys to sync in full (comma-separated, optional):")
            spaces = _split(ask_text("Spaces:"))

            if pages or page_trees or labels or spaces:
                return pages, page_trees, labels, spaces

            UI.warn("Confluence needs at least one of pages, page trees, labels or spaces to sync.")


def _split(value: str | None) -> list[str]:
    """Split a comma-separated prompt answer into a clean list."""
    return [item.strip() for item in (value or "").split(",") if item.strip()]
