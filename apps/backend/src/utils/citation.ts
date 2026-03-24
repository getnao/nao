import type { ColumnLineageNode } from '@nao/shared';
import type { AST, Parser } from 'node-sql-parser';

/* eslint-disable @typescript-eslint/no-explicit-any */

export function extractTables(tableList: string[]): Array<{ name: string }> {
	const names = new Set<string>();
	for (const entry of tableList) {
		const parts = entry.split('::');
		const tableName = parts[parts.length - 1];
		if (tableName) {
			names.add(tableName);
		}
	}
	return [...names].map((name) => ({ name }));
}

export function buildColumnLineage(column: string, ast: any, parser: Parser): ColumnLineageNode {
	try {
		const normalized = Array.isArray(ast) ? ast[0] : ast;
		const cteMap = buildCteMap(normalized.with);
		return resolveColumn(column, normalized, cteMap, parser);
	} catch {
		return { name: column, source_name: '', sources: [] };
	}
}

function buildCteMap(withClause: any[] | null): Map<string, any> {
	const map = new Map<string, any>();
	if (!withClause) {
		return map;
	}
	for (const cte of withClause) {
		const name = cte.name?.value ?? cte.name;
		if (name && cte.stmt?.ast) {
			map.set(name, cte.stmt.ast);
		}
	}
	return map;
}

function buildAliasMap(fromClause: any[] | null): Map<string, string> {
	const map = new Map<string, string>();
	if (!fromClause) {
		return map;
	}
	for (const entry of fromClause) {
		if (entry.table && entry.as) {
			map.set(entry.as, entry.table);
		} else if (entry.table) {
			map.set(entry.table, entry.table);
		}
	}
	return map;
}

function resolveColumn(columnName: string, ast: any, cteMap: Map<string, any>, parser: Parser): ColumnLineageNode {
	const columns = ast.columns;
	if (!columns || columns === '*') {
		return { name: columnName, source_name: '', sources: [] };
	}

	const col = findColumn(columnName, columns);
	if (!col) {
		return { name: columnName, source_name: '', sources: [] };
	}

	const aliasMap = buildAliasMap(ast.from);
	const expr = col.expr;
	const expression = exprToSql(expr, parser);

	if (expr.type === 'column_ref') {
		return resolveColumnRef(columnName, expr, aliasMap, cteMap, parser, expression);
	}

	const refs = extractColumnRefs(expr);
	const sources = resolveRefs(refs, aliasMap, cteMap, parser);

	return {
		name: columnName,
		source_name: '',
		expression,
		sources,
	};
}

function findColumn(columnName: string, columns: any[]): any | null {
	return (
		columns.find((c: any) => c.as === columnName) ?? columns.find((c: any) => c.expr?.column === columnName) ?? null
	);
}

function resolveColumnRef(
	columnName: string,
	expr: any,
	aliasMap: Map<string, string>,
	cteMap: Map<string, any>,
	parser: Parser,
	expression?: string,
): ColumnLineageNode {
	const tableAlias = expr.table;
	const realTable = tableAlias ? (aliasMap.get(tableAlias) ?? tableAlias) : '';

	if (cteMap.has(realTable)) {
		const cteAst = cteMap.get(realTable)!;
		const innerLineage = resolveColumn(expr.column, cteAst, cteMap, parser);
		return {
			name: columnName,
			source_name: '',
			expression,
			reference_node_name: realTable,
			sources: [innerLineage],
		};
	}

	return {
		name: expr.column,
		source_name: realTable,
		expression,
		sources: [],
	};
}

function resolveRefs(
	refs: Array<{ table: string; column: string }>,
	aliasMap: Map<string, string>,
	cteMap: Map<string, any>,
	parser: Parser,
): ColumnLineageNode[] {
	return refs.map((ref) => {
		const realTable = ref.table ? (aliasMap.get(ref.table) ?? ref.table) : '';

		if (cteMap.has(realTable)) {
			const cteAst = cteMap.get(realTable)!;
			const innerLineage = resolveColumn(ref.column, cteAst, cteMap, parser);
			return {
				name: ref.column,
				source_name: '',
				reference_node_name: realTable,
				sources: [innerLineage],
			};
		}

		return { name: ref.column, source_name: realTable, sources: [] };
	});
}

function extractColumnRefs(expr: any): Array<{ table: string; column: string }> {
	if (!expr) {
		return [];
	}

	if (expr.type === 'column_ref') {
		return [{ table: expr.table ?? '', column: expr.column }];
	}
	if (expr.type === 'aggr_func') {
		return extractColumnRefs(expr.args?.expr);
	}
	if (expr.type === 'binary_expr') {
		return [...extractColumnRefs(expr.left), ...extractColumnRefs(expr.right)];
	}
	if (expr.type === 'function') {
		const args = expr.args?.value ?? [];
		return args.flatMap((arg: any) => extractColumnRefs(arg));
	}
	if (expr.type === 'cast') {
		return extractColumnRefs(expr.expr);
	}
	if (expr.type === 'case') {
		const results: Array<{ table: string; column: string }> = [];
		for (const arg of expr.args ?? []) {
			results.push(...extractColumnRefs(arg.cond));
			results.push(...extractColumnRefs(arg.result));
		}
		return results;
	}

	return [];
}

function exprToSql(expr: any, parser: Parser): string | undefined {
	if (!expr) {
		return undefined;
	}
	try {
		const wrappedAst = {
			type: 'select',
			columns: [{ expr, as: null }],
			from: null,
			where: null,
			groupby: null,
			having: null,
			orderby: null,
			limit: null,
			with: null,
			options: null,
			distinct: null,
		};
		const sql = parser.sqlify(wrappedAst as unknown as AST);
		return sql
			.replace(/^SELECT\s+/i, '')
			.replace(/\s+FROM\s*$/i, '')
			.trim();
	} catch {
		return undefined;
	}
}
