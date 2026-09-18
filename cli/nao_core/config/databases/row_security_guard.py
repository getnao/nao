from __future__ import annotations

from typing import Any, Literal, Protocol, TypedDict, cast

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


class ActiveRowSecurityPolicy(TypedDict):
    access: Literal["none", "full", "predicate"]
    constraint_columns: list[str]
    predicate: str | None


class BlockedRowSecurityPolicy(TypedDict):
    access: Literal["blocked"]
    constraint_columns: list[str]
    reason: str


RowSecurityPolicy = ActiveRowSecurityPolicy | BlockedRowSecurityPolicy


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
        policy_conditions: list[tuple[exp.Table, exp.Select, exp.Expression]] = []
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
            policy = _lookup_policy(policies, identity)
            if policy is not None and policy["access"] == "blocked":
                raise _blocked(cast(BlockedRowSecurityPolicy, policy)["reason"])
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
                qualifier = _table_qualifier(table_expression)
                _qualify_columns(condition, qualifier)

            policy_conditions.append((table_expression, select, condition))

        for table_expression, select, condition in policy_conditions:
            _inject_policy_condition(table_expression, select, condition)

        return expression.sql(dialect=dialect)
    except RowSecurityGuardError:
        raise
    except Exception as error:
        raise _blocked(str(error)) from error
    finally:
        if owns_connection and conn is not None:
            conn.disconnect()


def _lookup_policy(
    policies: dict[TableIdentity, RowSecurityPolicy],
    identity: TableIdentity,
) -> RowSecurityPolicy | None:
    exact_policy = policies.get(identity)
    if exact_policy is not None:
        return exact_policy

    schema, table = identity
    matches = [
        policy
        for (policy_schema, policy_table), policy in policies.items()
        if policy_schema.casefold() == schema.casefold() and policy_table.casefold() == table.casefold()
    ]
    return matches[0] if len(matches) == 1 else None


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
    if not _every_comparison_branch_is_grounded(expression):
        raise _blocked("every row predicate comparison must reference a constraint column")
    return expression


def _every_comparison_branch_is_grounded(expression: exp.Expression) -> bool:
    if isinstance(expression, (exp.Paren, exp.Not)):
        return _every_comparison_branch_is_grounded(expression.this)
    if isinstance(expression, (exp.And, exp.Or)):
        return _every_comparison_branch_is_grounded(expression.this) and _every_comparison_branch_is_grounded(
            expression.expression
        )
    return isinstance(
        expression,
        (exp.EQ, exp.NEQ, exp.GT, exp.GTE, exp.LT, exp.LTE, exp.Is, exp.In, exp.Between),
    ) and any(expression.find_all(exp.Column))


def _table_qualifier(table_expression: exp.Table) -> exp.Identifier:
    alias = table_expression.args.get("alias")
    qualifier = alias.args.get("this") if isinstance(alias, exp.TableAlias) else table_expression.args.get("this")
    if not isinstance(qualifier, exp.Identifier) or not qualifier.name:
        raise _blocked("a protected table alias could not be resolved")
    return qualifier.copy()


def _qualify_columns(expression: exp.Expression, qualifier: exp.Identifier) -> None:
    for column in expression.find_all(exp.Column):
        column.set("table", qualifier.copy())


def _inject_policy_condition(
    table_expression: exp.Table,
    select: exp.Select,
    condition: exp.Expression,
) -> None:
    joins = select.args.get("joins") or []
    if any(join.side.upper() == "FULL" for join in joins):
        if not isinstance(table_expression.args.get("alias"), exp.TableAlias) and (
            table_expression.args.get("db") or table_expression.args.get("catalog")
        ):
            raise _blocked("qualified tables in FULL JOIN queries require an explicit alias")
        _prefilter_table(table_expression, condition)
        return

    table_join_index = next(
        (index for index, join in enumerate(joins) if join.this is table_expression),
        None,
    )
    if table_join_index is not None and joins[table_join_index].side.upper() == "LEFT":
        if joins[table_join_index].args.get("using"):
            _prefilter_table(table_expression, condition)
            return
        _append_join_condition(joins[table_join_index], condition)
        return

    start = 0 if table_join_index is None else table_join_index + 1
    right_join = next((join for join in joins[start:] if join.side.upper() == "RIGHT"), None)
    if right_join is not None:
        if right_join.args.get("using"):
            _prefilter_table(table_expression, condition)
            return
        _append_join_condition(right_join, condition)
        return

    existing = select.args.get("where")
    combined = condition if existing is None else exp.and_(existing.this, condition)
    select.set("where", exp.Where(this=combined))


def _append_join_condition(join: exp.Join, condition: exp.Expression) -> None:
    existing = join.args.get("on")
    join.set("on", condition if existing is None else exp.and_(existing, condition))


def _prefilter_table(table_expression: exp.Table, condition: exp.Expression) -> None:
    qualifier = _table_qualifier(table_expression)
    outer_alias = table_expression.args.get("alias")
    if not isinstance(outer_alias, exp.TableAlias):
        outer_alias = exp.TableAlias(this=qualifier)
    filtered = exp.select("*").from_(table_expression.copy()).where(condition)
    table_expression.replace(exp.Subquery(this=filtered, alias=outer_alias.copy()))


def _blocked(reason: str) -> RowSecurityGuardError:
    return RowSecurityGuardError("Query blocked because row-level security could not be safely enforced: " + reason)
