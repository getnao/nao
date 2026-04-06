"""Power BI Semantic Model via XMLA configuration."""

from __future__ import annotations

import threading
from typing import TYPE_CHECKING, Literal
from urllib.parse import quote

from pydantic import Field, model_validator

from nao_core.ui import ask_text

if TYPE_CHECKING:
    import pandas as pd
    from ibis import BaseBackend

from .base import DatabaseConfig

# Module-level MSAL app cache keyed by (tenant_id, client_id, secret_hash).
# Including a hash of the secret ensures a rotated credential gets a fresh MSAL instance
# rather than reusing cached tokens issued for the old secret.
# Secrets are never stored directly; only a one-way hash is kept in memory.
_MSAL_APP_CACHE: dict[tuple[str, str, str], object] = {}
_MSAL_APP_LOCK = threading.Lock()


class PowerBIXmlaConfig(DatabaseConfig):
    """Power BI Semantic Model via XMLA endpoint (service principal auth)."""

    type: Literal["powerbi_xmla"] = "powerbi_xmla"

    workspace: str = Field(description="Exact workspace name as shown in Power BI Service")
    dataset: str = Field(description="Semantic model / dataset name")

    tenant_id: str = Field(description="Azure AD tenant ID (or env var reference)")
    client_id: str = Field(description="Azure AD application (client) ID")
    client_secret: str = Field(description="Azure AD client secret")

    row_limit: int = Field(default=5000, ge=1, le=50000, description="Max rows returned per DAX query")
    timeout_seconds: int = Field(default=30, ge=5, le=300, description="Query timeout in seconds")
    include_hidden: bool = Field(default=False, description="Include hidden tables and columns")
    xmla_endpoint: str | None = Field(
        default=None,
        description=(
            "Explicit XMLA SOAP endpoint URL. Takes priority over the auto-constructed URL. "
            "Required for dedicated capacity or regional deployments that do not use the "
            "default Power BI Premium/Fabric endpoint. "
            "Example: https://wabi-us-north-central-redirect.analysis.windows.net/xmla"
        ),
    )

    @model_validator(mode="after")
    def resolve_env_vars(self) -> "PowerBIXmlaConfig":
        """Expand ${VAR} references in credential fields.

        Raises ValueError immediately if a referenced env var is not set,
        preventing silent empty-string credentials reaching MSAL.
        """
        import os
        import re

        pattern = re.compile(r"^\$\{([^}]+)\}$")
        for field in ("tenant_id", "client_id", "client_secret"):
            value = getattr(self, field)
            m = pattern.match(value)
            if m:
                var_name = m.group(1)
                resolved = os.environ.get(var_name)
                if resolved is None:
                    raise ValueError(
                        f"Environment variable '{var_name}' referenced in '{field}' is not set"
                    )
                object.__setattr__(self, field, resolved)
        return self

    @classmethod
    def promptConfig(cls) -> "PowerBIXmlaConfig":
        name = ask_text("Connection name:", default="powerbi-model") or "powerbi-model"
        workspace = ask_text("Power BI workspace name:", required_field=True)
        dataset = ask_text("Dataset / semantic model name:", required_field=True)
        tenant_id = ask_text("Azure tenant ID (or ${AZURE_TENANT_ID}):", required_field=True)
        client_id = ask_text("Azure client ID (or ${AZURE_CLIENT_ID}):", required_field=True)
        client_secret = ask_text(
            "Azure client secret (or ${AZURE_CLIENT_SECRET}):",
            password=True,
            required_field=True,
        )
        return cls(
            name=name,
            workspace=workspace,
            dataset=dataset,
            tenant_id=tenant_id,
            client_id=client_id,
            client_secret=client_secret,
        )

    def connect(self) -> "BaseBackend":
        raise NotImplementedError(
            "Power BI XMLA does not use an ibis backend. "
            "Use execute_dax() for queries or sync_powerbi_xmla() for sync."
        )

    def get_database_name(self) -> str:
        return self.dataset

    def xmla_endpoint_url(self) -> str:
        """Return the XMLA SOAP endpoint URL.

        If ``xmla_endpoint`` is explicitly configured it is used as-is.
        Otherwise a best-effort URL is constructed for Power BI Premium/Fabric workspaces.
        Set ``xmla_endpoint`` explicitly if connections fail — the correct URL is
        workspace-specific and may differ across regions or dedicated capacity tenants.
        """
        if self.xmla_endpoint:
            return self.xmla_endpoint
        return f"https://api.powerbi.com/v1.0/myorg/{quote(self.workspace, safe='')}"

    def acquire_token(self) -> str:
        """Acquire an Azure AD token via MSAL service principal flow.

        ``ConfidentialClientApplication`` is cached per (tenant_id, client_id) so that
        MSAL's internal token cache is reused across requests, avoiding a round-trip to
        Azure AD on every query.
        """
        import hashlib

        from nao_core.deps import require_dependency

        require_dependency("msal", "powerbi_xmla", "for Power BI authentication")
        import msal  # type: ignore[import-untyped]

        secret_hash = hashlib.sha256(self.client_secret.encode()).hexdigest()[:16]
        cache_key = (self.tenant_id, self.client_id, secret_hash)
        with _MSAL_APP_LOCK:
            if cache_key not in _MSAL_APP_CACHE:
                _MSAL_APP_CACHE[cache_key] = msal.ConfidentialClientApplication(
                    self.client_id,
                    authority=f"https://login.microsoftonline.com/{self.tenant_id}",
                    client_credential=self.client_secret,
                )
            app = _MSAL_APP_CACHE[cache_key]

        result = app.acquire_token_for_client(
            scopes=["https://analysis.windows.net/powerbi/api/.default"]
        )
        if "error" in result:
            raise ConnectionError(
                f"MSAL authentication failed: {result.get('error_description', result['error'])}"
            )
        return result["access_token"]  # type: ignore[return-value]

    def execute_dax(self, dax_query: str) -> "pd.DataFrame":
        """Execute a DAX EVALUATE query and return results as a DataFrame."""
        from nao_core.commands.sync.providers.databases.powerbi_xmla.client import XmlaClient

        client = XmlaClient(self)
        return client.execute_dax(dax_query)

    def check_connection(self) -> tuple[bool, str]:
        """Validate connectivity and permissions by running a minimal DMV discovery."""
        try:
            from nao_core.commands.sync.providers.databases.powerbi_xmla.client import XmlaClient

            client = XmlaClient(self)
            tables = client.discover_tables()
            return True, f"Connected — {len(tables)} tables found in '{self.dataset}'"
        except Exception as e:
            return False, str(e)
