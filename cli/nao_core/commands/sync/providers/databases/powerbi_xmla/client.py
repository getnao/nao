"""XMLA SOAP client for Power BI Semantic Models.

Sends SOAP Discover/Execute requests to the Power BI XMLA endpoint over HTTPS.
Auth uses MSAL service principal; no Windows-only drivers required.
"""

from __future__ import annotations

from xml.etree import ElementTree as ET
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    import pandas as pd
    from nao_core.config.databases.powerbi_xmla import PowerBIXmlaConfig


# ---------------------------------------------------------------------------
# SOAP templates
# ---------------------------------------------------------------------------

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

_EXECUTE_SOAP = """\
<?xml version="1.0" encoding="UTF-8"?>
<SOAP-ENV:Envelope xmlns:SOAP-ENV="http://schemas.xmlsoap.org/soap/envelope/">
  <SOAP-ENV:Body>
    <xmla:Execute xmlns:xmla="urn:schemas-microsoft-com:xml-analysis">
      <xmla:Command>
        <xmla:Statement>{statement}</xmla:Statement>
      </xmla:Command>
      <xmla:Properties>
        <xmla:PropertyList>
          <Catalog>{dataset}</Catalog>
          <Format>Tabular</Format>
        </xmla:PropertyList>
      </xmla:Properties>
    </xmla:Execute>
  </SOAP-ENV:Body>
</SOAP-ENV:Envelope>"""

_ROWSET_NS = "urn:schemas-microsoft-com:xml-analysis:rowset"
_XSD_NS = "http://www.w3.org/2001/XMLSchema"
_SQL_NS = "urn:schemas-microsoft-com:xml-sql"


# ---------------------------------------------------------------------------
# Client
# ---------------------------------------------------------------------------


_AUTH_FAILURES: dict[str, int] = {}  # endpoint_url -> consecutive auth failure count
_AUTH_CIRCUIT_OPEN_THRESHOLD = 3


class XmlaClient:
    """Thin SOAP client for Power BI XMLA endpoints.

    Includes:
    - Circuit breaker: opens after 3 consecutive auth failures (prevents token spam).
    - Selective retry: retries once on HTTP 503 or token-expiry (401); never retries on DAX errors.
    - Row-limit guard enforced after response parse.
    - Secrets never logged: only endpoint URL and status codes appear in exceptions.
    """

    def __init__(self, config: "PowerBIXmlaConfig") -> None:
        self._config = config
        self._token: str | None = None

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    def discover_tables(self) -> list[dict]:
        """Return table metadata from TMSCHEMA_TABLES DMV."""
        rows = self._discover("TMSCHEMA_TABLES")
        if not self._config.include_hidden:
            rows = [r for r in rows if r.get("IsHidden", "false").lower() != "true"]
        return rows

    def discover_columns(self) -> list[dict]:
        """Return column metadata from TMSCHEMA_COLUMNS DMV."""
        rows = self._discover("TMSCHEMA_COLUMNS")
        if not self._config.include_hidden:
            rows = [r for r in rows if r.get("IsHidden", "false").lower() != "true"]
        return rows

    def discover_measures(self) -> list[dict]:
        """Return measure metadata from TMSCHEMA_MEASURES DMV."""
        return self._discover("TMSCHEMA_MEASURES")

    def discover_relationships(self) -> list[dict]:
        """Return relationship metadata from TMSCHEMA_RELATIONSHIPS DMV."""
        return self._discover("TMSCHEMA_RELATIONSHIPS")

    def execute_dax(self, dax_query: str) -> "pd.DataFrame":
        """Execute a DAX EVALUATE query and return results as a DataFrame."""
        import html

        escaped = html.escape(dax_query)
        soap = _EXECUTE_SOAP.format(statement=escaped, dataset=self._config.dataset)
        xml_text = self._post_soap(soap, action="Execute")
        df = self._parse_execute_response(xml_text)

        if len(df) > self._config.row_limit:
            df = df.iloc[: self._config.row_limit]

        return df

    # ------------------------------------------------------------------
    # Internal
    # ------------------------------------------------------------------

    def _get_token(self) -> str:
        if self._token is None:
            url = self._config.xmla_endpoint_url()
            if _AUTH_FAILURES.get(url, 0) >= _AUTH_CIRCUIT_OPEN_THRESHOLD:
                raise ConnectionError(
                    f"XMLA auth circuit open for {url}: "
                    f"{_AUTH_FAILURES[url]} consecutive failures. "
                    "Check Azure AD credentials and SP permissions."
                )
            self._token = self._config.acquire_token()
        return self._token

    def _post_soap(self, soap_body: str, action: str) -> str:
        """POST a SOAP envelope; return response XML text.

        Retries once on HTTP 503 or 401 (token refresh). Never retries on 4xx DAX errors.
        """
        from nao_core.deps import require_dependency

        require_dependency("httpx", "powerbi_xmla", "for XMLA HTTP requests")
        import httpx

        url = self._config.xmla_endpoint_url()
        soap_action = f"urn:schemas-microsoft-com:xml-analysis:{action}"

        for attempt in range(2):
            try:
                response = httpx.post(
                    url,
                    content=soap_body.encode("utf-8"),
                    headers={
                        "Content-Type": "text/xml;charset=UTF-8",
                        "SOAPAction": soap_action,
                        "Authorization": f"Bearer {self._get_token()}",
                    },
                    timeout=float(self._config.timeout_seconds),
                )
            except httpx.TimeoutException as exc:
                raise TimeoutError(
                    f"XMLA request timed out after {self._config.timeout_seconds}s"
                ) from exc

            if response.status_code == 401 and attempt == 0:
                # Token may have expired mid-session — refresh once.
                self._token = None
                _AUTH_FAILURES[url] = _AUTH_FAILURES.get(url, 0) + 1
                continue

            if response.status_code == 503 and attempt == 0:
                # Service temporarily unavailable — retry once.
                continue

            if response.status_code == 401:
                _AUTH_FAILURES[url] = _AUTH_FAILURES.get(url, 0) + 1
                raise ConnectionError(
                    f"XMLA authentication failed (HTTP 401) for {url}. "
                    "Verify tenant_id, client_id, client_secret and SP XMLA permissions."
                )

            # Success: reset auth failure counter.
            _AUTH_FAILURES[url] = 0

            if not response.is_success:
                detail = response.text[:400].replace("\n", " ")
                raise ConnectionError(
                    f"XMLA endpoint returned HTTP {response.status_code}: {detail}"
                )

            self._check_soap_fault(response.text)
            return response.text

        raise ConnectionError(f"XMLA request failed after retry for {url}")

    @staticmethod
    def _check_soap_fault(xml_text: str) -> None:
        root = ET.fromstring(xml_text)
        fault = root.find(".//{http://schemas.xmlsoap.org/soap/envelope/}Fault")
        if fault is not None:
            fstring = fault.findtext("faultstring") or "Unknown SOAP fault"
            detail = fault.findtext(".//Description") or ""
            raise RuntimeError(f"XMLA SOAP fault: {fstring}. {detail}".strip())

    def _discover(self, request_type: str) -> list[dict]:
        soap = _DISCOVER_SOAP.format(
            request_type=request_type, dataset=self._config.dataset
        )
        xml_text = self._post_soap(soap, action="Discover")
        return self._parse_discover_response(xml_text)

    @staticmethod
    def _parse_discover_response(xml_text: str) -> list[dict]:
        root = ET.fromstring(xml_text)
        results = []
        for row in root.findall(f".//{{{_ROWSET_NS}}}row"):
            entry: dict[str, str | None] = {}
            for child in row:
                tag = child.tag.split("}")[-1] if "}" in child.tag else child.tag
                entry[tag] = child.text
            results.append(entry)
        return results

    @staticmethod
    def _parse_execute_response(xml_text: str) -> "pd.DataFrame":
        import pandas as pd

        root = ET.fromstring(xml_text)
        rowset_root = root.find(f".//{{{_ROWSET_NS}}}root")
        if rowset_root is None:
            return pd.DataFrame()

        # Build xml_element_name → real_column_name mapping from embedded XSD schema
        columns_map: dict[str, str] = {}
        schema = rowset_root.find(f"{{{_XSD_NS}}}schema")
        if schema is not None:
            for elem in schema.findall(
                f".//{{{_XSD_NS}}}complexType[@name='row']/{{{_XSD_NS}}}sequence/{{{_XSD_NS}}}element"
            ):
                xml_name = elem.get("name", "")
                real_name = elem.get(f"{{{_SQL_NS}}}field", xml_name)
                columns_map[xml_name] = real_name

        rows: list[dict] = []
        for row_elem in rowset_root.findall(f"{{{_ROWSET_NS}}}row"):
            row: dict[str, str | None] = {}
            for child in row_elem:
                tag = child.tag.split("}")[-1] if "}" in child.tag else child.tag
                real_col = columns_map.get(tag, tag)
                row[real_col] = child.text
            rows.append(row)

        if not rows:
            return pd.DataFrame(columns=list(columns_map.values()))

        return pd.DataFrame(rows)
