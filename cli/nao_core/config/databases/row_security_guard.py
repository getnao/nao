from __future__ import annotations

from typing import Any, Literal, Protocol, TypedDict

import sqlglot
from sqlglot import exp
from sqlglot.errors import ParseError

from nao_core.config.databases.query_guard import (
    SQLGLOT_DIALECTS,
    base_table_expressions,
    load_schemas,
    match_sql_identifier,
    parse_query,
    resolve_table,
)


class _DatabaseConfigLike(Protocol):
    type: str

    def connect(self) -> Any: ...

    def get_database_name(self) -> str: ...

    def get_schemas(self, conn: Any) -> list[str]: ...


class RowSecurityGuardError(ValueError):
    pass


class RowSecurityPolicy(TypedDict):
    access: Literal["none", "full", "predicate"]
    constraint_columns: list[str]
    predicate: str | None


TableIdentity = tuple[str, str]


def validate_row_security_predicate(
    predicate: str,
    constraint_columns: list[str],
    database_type: str,
) -> str:
    dialect = SQLGLOT_DIALECTS.get(database_type)
    if dialect is None:
        raise _blocked(f"the database dialect '{database_type}' is not supported")
    return _parse_predicate(predicate, constraint_columns, dialect).sql(dialect=dialect)


def enforce_row_security(
    sql: str,
    db_config: _DatabaseConfigLike,
    policies: dict[TableIdentity, RowSecurityPolicy] | None,
    conn: Any | None = None,
) -> str:
    if policies is None:
        return sql

    dialect = SQLGLOT_DIALECTS.get(db_config.type)
    if dialect is None:
        raise _blocked(f"the database dialect '{db_config.type}' is not supported")

    owns_connection = conn is None
    try:
        expression = parse_query(sql, dialect, _blocked)
        table_expressions = base_table_expressions(expression, _blocked)
        if not table_expressions:
            return expression.sql(dialect=dialect)
        if conn is None:
            conn = db_config.connect()

        schemas = load_schemas(conn, db_config, _blocked)
        tables_by_schema: dict[str, list[str]] = {}
        conditions_by_select: dict[int, tuple[exp.Select, list[exp.Expression]]] = {}
        parsed_policies: dict[TableIdentity, exp.Expression] = {}

        for table_expression in table_expressions:
            identity = resolve_table(
                table_expression,
                conn,
                schemas,
                tables_by_schema,
                db_config,
                dialect,
                _blocked,
            )
            policy = policies.get(identity)
            if policy is None or policy["access"] == "full":
                continue

            select = table_expression.find_ancestor(exp.Select)
            if select is None:
                raise _blocked("a protected table is not contained by a SELECT scope")

            if policy["access"] == "none":
                condition: exp.Expression = exp.false()
            else:
                condition = parsed_policies.get(identity)
                if condition is None:
                    condition = _parse_predicate(
                        policy.get("predicate"),
                        policy["constraint_columns"],
                        dialect,
                    )
                    parsed_policies[identity] = condition
                condition = condition.copy()
                qualifier = table_expression.alias_or_name
                if not qualifier:
                    raise _blocked("a protected table alias could not be resolved")
                _qualify_columns(condition, qualifier)

            _, conditions = conditions_by_select.setdefault(id(select), (select, []))
            conditions.append(condition)

        for select, conditions in conditions_by_select.values():
            combined = conditions[0]
            for condition in conditions[1:]:
                combined = exp.and_(combined, condition)
            existing = select.args.get("where")
            if existing is None:
                select.set("where", exp.Where(this=combined))
            else:
                select.set("where", exp.Where(this=exp.and_(existing.this, combined)))

        return expression.sql(dialect=dialect)
    except RowSecurityGuardError:
        raise
    except Exception as error:
        raise _blocked(str(error)) from error
    finally:
        if owns_connection and conn is not None:
            conn.disconnect()


def _parse_predicate(
    predicate: str | None,
    constraint_columns: list[str],
    dialect: str,
) -> exp.Expression:
    if not predicate or ";" in predicate or "--" in predicate or "/*" in predicate or "*/" in predicate:
        raise _blocked("a row predicate is empty or contains a comment")
    try:
        expression = sqlglot.parse_one(predicate, read=dialect, into=exp.Condition)
    except ParseError as error:
        raise _blocked(f"a row predicate could not be parsed: {error}") from error
    if not isinstance(
        expression,
        (
            exp.EQ,
            exp.NEQ,
            exp.GT,
            exp.GTE,
            exp.LT,
            exp.LTE,
            exp.Is,
            exp.In,
            exp.Between,
            exp.And,
            exp.Or,
            exp.Not,
            exp.Paren,
        ),
    ):
        raise _blocked("a row predicate must be a boolean comparison")

    allowed_nodes = (
        exp.EQ,
        exp.NEQ,
        exp.GT,
        exp.GTE,
        exp.LT,
        exp.LTE,
        exp.Is,
        exp.In,
        exp.Between,
        exp.And,
        exp.Or,
        exp.Not,
        exp.Paren,
        exp.Column,
        exp.Identifier,
        exp.Literal,
        exp.Boolean,
        exp.Null,
        exp.Neg,
    )
    for node in expression.walk():
        if not isinstance(node, allowed_nodes):
            raise _blocked(f"row predicate expression '{node.key}' is not allowed")

    available_columns = list(dict.fromkeys(constraint_columns))
    for column in expression.find_all(exp.Column):
        if column.table or column.db or column.catalog:
            raise _blocked("row predicate columns must be unqualified")
        identifier = column.args.get("this")
        if (
            not isinstance(identifier, exp.Identifier)
            or match_sql_identifier(identifier, available_columns, dialect) is None
        ):
            raise _blocked(f"row predicate column '{column.name}' is not a configured constraint column")
    if not any(expression.find_all(exp.Column)):
        raise _blocked("a row predicate must reference a constraint column")
    return expression


def _qualify_columns(expression: exp.Expression, qualifier: str) -> None:
    for column in expression.find_all(exp.Column):
        column.set("table", exp.to_identifier(qualifier))


def _blocked(reason: str) -> RowSecurityGuardError:
    return RowSecurityGuardError("Query blocked because row-level security could not be safely enforced: " + reason)
