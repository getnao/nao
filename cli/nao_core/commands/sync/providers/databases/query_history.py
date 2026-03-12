"""Query history extraction and analysis for the how_to_use template."""

from __future__ import annotations

import re
from collections import Counter
from dataclasses import dataclass, field

import sqlglot
from sqlglot import exp


@dataclass
class TableUsageStats:
    """Per-table usage statistics computed from query history."""

    usage_count: int = 0
    common_joins: list[tuple[str, int]] = field(default_factory=list)
    top_queries: list[tuple[str, int]] = field(default_factory=list)


def extract_table_references(sql: str, dialect: str | None = None) -> list[str]:
    """Extract table names referenced in FROM/JOIN clauses."""
    tables: set[str] = set()
    try:
        parsed = sqlglot.parse(sql, read=dialect, error_level=sqlglot.ErrorLevel.IGNORE)
    except Exception:
        return _extract_table_references_fallback(sql)

    for statement in parsed:
        if statement is None:
            continue
        for table_node in statement.find_all(exp.Table):
            name = _table_node_to_name(table_node)
            if name:
                tables.add(name.lower())

    return sorted(tables) if tables else _extract_table_references_fallback(sql)


def _table_node_to_name(table_node: exp.Table) -> str | None:
    """Convert a sqlglot Table node to a qualified name string."""
    parts: list[str] = []
    if table_node.catalog:
        parts.append(table_node.catalog)
    if table_node.db:
        parts.append(table_node.db)
    if table_node.name:
        parts.append(table_node.name)
    return ".".join(parts) if parts else None


_TABLE_RE = re.compile(
    r"""(?:FROM|JOIN)\s+"""
    r"""(?:`?(\w+)`?\.)?"""
    r"""`?(\w+)`?""",
    re.IGNORECASE,
)


def _extract_table_references_fallback(sql: str) -> list[str]:
    """Regex fallback when sqlglot parsing yields nothing useful."""
    tables: set[str] = set()
    for match in _TABLE_RE.finditer(sql):
        schema_part, table_part = match.group(1), match.group(2)
        if table_part.upper() in _SQL_KEYWORDS:
            continue
        name = f"{schema_part}.{table_part}" if schema_part else table_part
        tables.add(name.lower())
    return sorted(tables)


_SQL_KEYWORDS = frozenset(
    {
        "SELECT",
        "WHERE",
        "GROUP",
        "ORDER",
        "LIMIT",
        "HAVING",
        "UNION",
        "INSERT",
        "UPDATE",
        "DELETE",
        "SET",
        "VALUES",
        "INTO",
        "AS",
        "ON",
        "AND",
        "OR",
        "NOT",
        "NULL",
        "TRUE",
        "FALSE",
        "CASE",
        "WHEN",
        "THEN",
        "ELSE",
        "END",
        "EXISTS",
        "IN",
        "BETWEEN",
        "LIKE",
        "IS",
        "BY",
        "ALL",
        "ANY",
        "SOME",
        "DISTINCT",
        "LATERAL",
    }
)


def extract_join_pairs(sql: str, dialect: str | None = None) -> list[tuple[str, str]]:
    """Extract (left_table, right_table) pairs from JOIN clauses."""
    pairs: list[tuple[str, str]] = []
    try:
        parsed = sqlglot.parse(sql, read=dialect, error_level=sqlglot.ErrorLevel.IGNORE)
    except Exception:
        return pairs

    for statement in parsed:
        if statement is None:
            continue
        for join_node in statement.find_all(exp.Join):
            right_table = join_node.find(exp.Table)
            if right_table is None:
                continue
            right_name = _table_node_to_name(right_table)
            if not right_name:
                continue

            parent = join_node.parent
            if parent is None:
                continue
            from_clause = parent.find(exp.From)
            if from_clause is None:
                continue
            left_table = from_clause.find(exp.Table)
            if left_table is None:
                continue
            left_name = _table_node_to_name(left_table)
            if not left_name:
                continue

            pairs.append((left_name.lower(), right_name.lower()))

    return pairs


def _matches_table(ref: str, schema: str, table: str) -> bool:
    """Check whether a table reference matches the given schema.table."""
    ref_lower = ref.lower()
    full = f"{schema}.{table}".lower()
    table_lower = table.lower()
    return ref_lower == full or ref_lower == table_lower or ref_lower.endswith(f".{table_lower}")


def compute_table_usage(
    queries: list[str],
    selected_tables: list[tuple[str, str]],
    dialect: str | None = None,
    top_n: int = 5,
) -> dict[str, TableUsageStats]:
    """Compute per-table usage stats from a list of SQL queries.

    Returns a dict keyed by "schema.table" with usage statistics.
    """
    stats: dict[str, TableUsageStats] = {}
    for schema, table in selected_tables:
        stats[f"{schema}.{table}"] = TableUsageStats()

    join_counter: dict[str, Counter[str]] = {k: Counter() for k in stats}
    query_counter: dict[str, Counter[str]] = {k: Counter() for k in stats}

    for sql in queries:
        refs = extract_table_references(sql, dialect=dialect)
        join_pairs = extract_join_pairs(sql, dialect=dialect)

        for key, st in stats.items():
            schema, table = key.split(".", 1)
            if not any(_matches_table(r, schema, table) for r in refs):
                continue

            st.usage_count += 1
            query_counter[key][sql.strip()] += 1

            for left, right in join_pairs:
                if _matches_table(left, schema, table):
                    join_counter[key][right] += 1
                elif _matches_table(right, schema, table):
                    join_counter[key][left] += 1

    for key, st in stats.items():
        st.common_joins = join_counter[key].most_common(top_n)
        st.top_queries = query_counter[key].most_common(top_n)

    return stats
