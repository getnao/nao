"""Unit tests for PowerBIXmlaConfig and XmlaClient internals.

Tests cover:
- resolve_env_vars: ${VAR} expansion in credential fields
- _parse_execute_response: XML parsing + XSD column-name mapping
- _render_measures_md: table ID resolution
- column → table join in sync_powerbi_xmla (via table_name_by_id logic)
"""

from __future__ import annotations

import os
from textwrap import dedent
from unittest.mock import patch


# ---------------------------------------------------------------------------
# resolve_env_vars
# ---------------------------------------------------------------------------


def test_resolve_env_vars_expands_credentials():
    from nao_core.config.databases.powerbi_xmla import PowerBIXmlaConfig

    with patch.dict(os.environ, {"MY_TENANT": "abc-123", "MY_SECRET": "s3cr3t"}):
        config = PowerBIXmlaConfig(
            name="test",
            workspace="My Workspace",
            dataset="My Dataset",
            tenant_id="${MY_TENANT}",
            client_id="literal-client-id",
            client_secret="${MY_SECRET}",
        )

    assert config.tenant_id == "abc-123"
    assert config.client_id == "literal-client-id"
    assert config.client_secret == "s3cr3t"


def test_resolve_env_vars_missing_env_becomes_empty():
    from nao_core.config.databases.powerbi_xmla import PowerBIXmlaConfig

    with patch.dict(os.environ, {}, clear=False):
        os.environ.pop("MISSING_VAR", None)
        config = PowerBIXmlaConfig(
            name="test",
            workspace="W",
            dataset="D",
            tenant_id="${MISSING_VAR}",
            client_id="cid",
            client_secret="sec",
        )

    assert config.tenant_id == ""


def test_resolve_env_vars_literal_value_unchanged():
    from nao_core.config.databases.powerbi_xmla import PowerBIXmlaConfig

    config = PowerBIXmlaConfig(
        name="test",
        workspace="W",
        dataset="D",
        tenant_id="literal-tenant",
        client_id="literal-client",
        client_secret="literal-secret",
    )

    assert config.tenant_id == "literal-tenant"
    assert config.client_secret == "literal-secret"


# ---------------------------------------------------------------------------
# xmla_endpoint_url
# ---------------------------------------------------------------------------


def test_xmla_endpoint_url_explicit_takes_priority():
    from nao_core.config.databases.powerbi_xmla import PowerBIXmlaConfig

    config = PowerBIXmlaConfig(
        name="test",
        workspace="My Workspace",
        dataset="My Dataset",
        tenant_id="t",
        client_id="c",
        client_secret="s",
        xmla_endpoint="https://custom.analysis.windows.net/xmla",
    )

    assert config.xmla_endpoint_url() == "https://custom.analysis.windows.net/xmla"


def test_xmla_endpoint_url_constructed_when_not_provided():
    from nao_core.config.databases.powerbi_xmla import PowerBIXmlaConfig

    config = PowerBIXmlaConfig(
        name="test",
        workspace="My Workspace",
        dataset="My Dataset",
        tenant_id="t",
        client_id="c",
        client_secret="s",
    )

    url = config.xmla_endpoint_url()
    assert "api.powerbi.com" in url
    assert "My%20Workspace" in url  # workspace name is URL-encoded


# ---------------------------------------------------------------------------
# _parse_execute_response
# ---------------------------------------------------------------------------

# Minimal but realistic XMLA Execute response.
# The XSD schema embedded in <root> provides the xml_name → real_column_name mapping
# via the sql:field attribute; row values are nested inside <row> elements.
_EXECUTE_RESPONSE_XML = dedent("""\
    <?xml version="1.0" encoding="UTF-8"?>
    <SOAP-ENV:Envelope xmlns:SOAP-ENV="http://schemas.xmlsoap.org/soap/envelope/">
      <SOAP-ENV:Body>
        <ExecuteResponse xmlns="urn:schemas-microsoft-com:xml-analysis">
          <return>
            <root xmlns="urn:schemas-microsoft-com:xml-analysis:rowset"
                  xmlns:xsd="http://www.w3.org/2001/XMLSchema"
                  xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
                  xmlns:sql="urn:schemas-microsoft-com:xml-sql">
              <xsd:schema targetNamespace="urn:schemas-microsoft-com:xml-analysis:rowset">
                <xsd:complexType name="row">
                  <xsd:sequence>
                    <xsd:element name="C0" sql:field="[Sales].[Date]" type="xsd:string" minOccurs="0"/>
                    <xsd:element name="C1" sql:field="[Sales].[Amount]" type="xsd:decimal" minOccurs="0"/>
                  </xsd:sequence>
                </xsd:complexType>
              </xsd:schema>
              <row>
                <C0>2024-01-01</C0>
                <C1>999.50</C1>
              </row>
              <row>
                <C0>2024-01-02</C0>
                <C1>1200.00</C1>
              </row>
            </root>
          </return>
        </ExecuteResponse>
      </SOAP-ENV:Body>
    </SOAP-ENV:Envelope>
""")

_EXECUTE_RESPONSE_EMPTY_XML = dedent("""\
    <?xml version="1.0" encoding="UTF-8"?>
    <SOAP-ENV:Envelope xmlns:SOAP-ENV="http://schemas.xmlsoap.org/soap/envelope/">
      <SOAP-ENV:Body>
        <ExecuteResponse xmlns="urn:schemas-microsoft-com:xml-analysis">
          <return>
            <root xmlns="urn:schemas-microsoft-com:xml-analysis:rowset"
                  xmlns:xsd="http://www.w3.org/2001/XMLSchema"
                  xmlns:sql="urn:schemas-microsoft-com:xml-sql">
              <xsd:schema targetNamespace="urn:schemas-microsoft-com:xml-analysis:rowset">
                <xsd:complexType name="row">
                  <xsd:sequence>
                    <xsd:element name="C0" sql:field="[Sales].[Date]" type="xsd:string" minOccurs="0"/>
                  </xsd:sequence>
                </xsd:complexType>
              </xsd:schema>
            </root>
          </return>
        </ExecuteResponse>
      </SOAP-ENV:Body>
    </SOAP-ENV:Envelope>
""")


def test_parse_execute_response_column_mapping():
    """XSD sql:field attribute is used as the column name (not the generic C0/C1 names)."""
    from nao_core.commands.sync.providers.databases.powerbi_xmla.client import XmlaClient

    df = XmlaClient._parse_execute_response(_EXECUTE_RESPONSE_XML)

    assert list(df.columns) == ["[Sales].[Date]", "[Sales].[Amount]"]


def test_parse_execute_response_row_count():
    from nao_core.commands.sync.providers.databases.powerbi_xmla.client import XmlaClient

    df = XmlaClient._parse_execute_response(_EXECUTE_RESPONSE_XML)

    assert len(df) == 2
    assert df.iloc[0]["[Sales].[Date]"] == "2024-01-01"
    assert df.iloc[1]["[Sales].[Amount]"] == "1200.00"


def test_parse_execute_response_empty_result_returns_empty_dataframe():
    """Empty result set: DataFrame with correct columns but zero rows."""
    from nao_core.commands.sync.providers.databases.powerbi_xmla.client import XmlaClient

    df = XmlaClient._parse_execute_response(_EXECUTE_RESPONSE_EMPTY_XML)

    assert len(df) == 0
    assert "[Sales].[Date]" in df.columns


# ---------------------------------------------------------------------------
# _render_measures_md — table name resolution (M3)
# ---------------------------------------------------------------------------


def test_render_measures_md_resolves_table_name():
    from nao_core.commands.sync.providers.databases.powerbi_xmla.sync import _render_measures_md

    measures = [{"Name": "Total Sales", "TableID": "3", "Expression": "SUM(Sales[Amount])"}]
    table_name_by_id = {"3": "Sales"}

    md = _render_measures_md(measures, "MyDataset", table_name_by_id)

    assert "Sales" in md
    assert "3" not in md  # numeric ID must not appear in output


def test_render_measures_md_falls_back_to_raw_id_when_unmapped():
    from nao_core.commands.sync.providers.databases.powerbi_xmla.sync import _render_measures_md

    measures = [{"Name": "Total Sales", "TableID": "99", "Expression": "SUM(...)"}]

    md = _render_measures_md(measures, "MyDataset", {})

    # Falls back to raw ID rather than silently dropping the value
    assert "99" in md


# ---------------------------------------------------------------------------
# column → table join key (M5)
# ---------------------------------------------------------------------------


def test_table_name_by_id_uses_id_field_not_tableid():
    """TMSCHEMA_TABLES rows use 'ID' as their own PK; 'TableID' is for cross-reference DMVs."""
    tables = [
        {"ID": "1", "Name": "Sales"},
        {"ID": "2", "Name": "Date"},
    ]
    table_name_by_id: dict[str, str] = {}
    for t in tables:
        tid = t.get("ID")
        tname = t.get("Name")
        if tid and tname:
            table_name_by_id[tid] = tname
        if tname:
            table_name_by_id[tname] = tname

    # Columns report their parent via TableID (FK)
    columns = [
        {"Name": "Amount", "TableID": "1"},
        {"Name": "Date", "TableID": "2"},
    ]
    cols_by_table: dict[str, list[dict]] = {}
    for col in columns:
        key = col.get("TableID") or col.get("TableName") or "unknown"
        cols_by_table.setdefault(key, []).append(col)

    # Simulate the join as done in sync_powerbi_xmla
    for table in tables:
        table_id = table.get("ID") or table.get("Name")
        resolved = cols_by_table.get(table_id, [])
        assert len(resolved) == 1, f"Expected 1 column for table {table['Name']}, got {len(resolved)}"
