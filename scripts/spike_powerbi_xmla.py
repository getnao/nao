"""
Phase-0 spike: authenticate with MSAL (service principal) and list tables via XMLA DMV.

Prerequisites (install in a venv):
    pip install msal httpx

Required env vars:
    AZURE_TENANT_ID, AZURE_CLIENT_ID, AZURE_CLIENT_SECRET
    POWERBI_WORKSPACE  — exact workspace name as shown in Power BI Service
    POWERBI_DATASET    — dataset / semantic model name

Usage:
    AZURE_TENANT_ID=xxx ... python scripts/spike_powerbi_xmla.py
"""

from __future__ import annotations

import html
import os
import sys
from xml.etree import ElementTree as ET


def _require_env(name: str) -> str:
    value = os.environ.get(name)
    if not value:
        print(f"[error] Missing required env var: {name}")
        sys.exit(1)
    return value


def acquire_token(tenant_id: str, client_id: str, client_secret: str) -> str:
    try:
        import msal
    except ImportError:
        print("[error] Run: pip install msal")
        sys.exit(1)

    app = msal.ConfidentialClientApplication(
        client_id,
        authority=f"https://login.microsoftonline.com/{tenant_id}",
        client_credential=client_secret,
    )
    result = app.acquire_token_for_client(
        scopes=["https://analysis.windows.net/powerbi/api/.default"]
    )
    if "error" in result:
        print(f"[error] MSAL: {result.get('error_description', result['error'])}")
        sys.exit(1)
    return result["access_token"]  # type: ignore[return-value]


_DISCOVER_SOAP = """\
<?xml version="1.0" encoding="UTF-8"?>
<SOAP-ENV:Envelope xmlns:SOAP-ENV="http://schemas.xmlsoap.org/soap/envelope/">
  <SOAP-ENV:Body>
    <xmla:Discover xmlns:xmla="urn:schemas-microsoft-com:xml-analysis">
      <xmla:RequestType>{request_type}</xmla:RequestType>
      <xmla:Restrictions>
        <xmla:RestrictionList>
          <DatabaseName>{dataset}</DatabaseName>
        </xmla:RestrictionList>
      </xmla:Restrictions>
      <xmla:Properties>
        <xmla:PropertyList>
          <Catalog>{dataset}</Catalog>
        </xmla:PropertyList>
      </xmla:Properties>
    </xmla:Discover>
  </SOAP-ENV:Body>
</SOAP-ENV:Envelope>"""


def xmla_discover(token: str, workspace: str, dataset: str, request_type: str) -> list[dict]:
    try:
        import httpx
    except ImportError:
        print("[error] Run: pip install httpx")
        sys.exit(1)

    from urllib.parse import quote

    url = f"https://api.powerbi.com/v1.0/myorg/{quote(workspace, safe='')}"
    soap = _DISCOVER_SOAP.format(request_type=html.escape(request_type), dataset=html.escape(dataset))

    response = httpx.post(
        url,
        content=soap.encode("utf-8"),
        headers={
            "Content-Type": "text/xml;charset=UTF-8",
            "SOAPAction": f"urn:schemas-microsoft-com:xml-analysis:Discover",
            "Authorization": f"Bearer {token}",
        },
        timeout=30.0,
    )

    if not response.is_success:
        print(f"[error] XMLA HTTP {response.status_code}: {response.text[:500]}")
        sys.exit(1)

    rowset_ns = "urn:schemas-microsoft-com:xml-analysis:rowset"
    root = ET.fromstring(response.text)
    rows = root.findall(f".//{{{rowset_ns}}}row")

    results = []
    for row in rows:
        entry = {}
        for child in row:
            tag = child.tag.split("}")[-1] if "}" in child.tag else child.tag
            entry[tag] = child.text
        results.append(entry)
    return results


def main() -> None:
    tenant_id = _require_env("AZURE_TENANT_ID")
    client_id = _require_env("AZURE_CLIENT_ID")
    client_secret = _require_env("AZURE_CLIENT_SECRET")
    workspace = _require_env("POWERBI_WORKSPACE")
    dataset = _require_env("POWERBI_DATASET")

    print(f"Acquiring token for tenant={tenant_id} client={client_id}...")
    token = acquire_token(tenant_id, client_id, client_secret)
    print("✓ Token acquired\n")

    print(f"Discovering tables in dataset='{dataset}' workspace='{workspace}'...")
    tables = xmla_discover(token, workspace, dataset, "TMSCHEMA_TABLES")

    if not tables:
        print("[warn] No tables returned — check workspace/dataset name and SP permissions.")
        return

    print(f"✓ Found {len(tables)} tables:\n")
    for t in tables:
        hidden = t.get("IsHidden", "false")
        print(f"  {'(hidden) ' if hidden == 'true' else ''}{t.get('Name', '?')}")

    print(f"\nDiscovering measures...")
    measures = xmla_discover(token, workspace, dataset, "TMSCHEMA_MEASURES")
    print(f"✓ Found {len(measures)} measures")

    print(f"\nDiscovering relationships...")
    rels = xmla_discover(token, workspace, dataset, "TMSCHEMA_RELATIONSHIPS")
    print(f"✓ Found {len(rels)} relationships")


if __name__ == "__main__":
    main()
