import { Parser } from 'node-sql-parser';
import { describe, expect, it } from 'vitest';

import { getScopedViews } from '../src/db/app-db-views';
import dbConfig, { Dialect } from '../src/db/dbConfig';

describe('scoped app-db views', () => {
	it('exposes exactly the columns it declares', () => {
		for (const view of getScopedViews()) {
			expect({ view: view.name, columns: selectListNames(view.body) }).toEqual({
				view: view.name,
				columns: view.columns,
			});
		}
	});
});

interface SelectColumn {
	as: string | null;
	expr?: { value?: string; column?: string | { expr: { value: string } } };
}

/** Output names of a SELECT's top-level select list, in order. */
function selectListNames(body: string): string[] {
	const parser = new Parser();
	const database = dbConfig.dialect === Dialect.Postgres ? 'postgresql' : 'sqlite';
	const ast = parser.astify(body, { database }) as unknown as { columns: SelectColumn[] };
	return ast.columns.map(outputName);
}

/**
 * The parsers describe a bare column differently per dialect (a quoted string
 * expression in SQLite, a nested column ref in Postgres), so cover both shapes.
 */
function outputName({ as, expr }: SelectColumn): string {
	if (as) {
		return as;
	}
	const column = expr?.column;
	if (typeof column === 'string') {
		return column;
	}
	return column?.expr?.value ?? expr?.value ?? '';
}
