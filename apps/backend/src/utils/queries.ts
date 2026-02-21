import { Column, sql } from 'drizzle-orm';
import { SQLiteTable, SQLiteUpdateSetSource } from 'drizzle-orm/sqlite-core';

/** Builds a conflict update set when upserting mutliple records. */
export function conflictUpdateSet<TTable extends SQLiteTable>(
	table: TTable,
	columns: (keyof TTable['_']['columns'] & keyof TTable)[],
): SQLiteUpdateSetSource<TTable> {
	return Object.fromEntries(
		columns.map((k) => [k, sql.raw(`excluded.${(table[k] as Column).name}`)]),
	) as SQLiteUpdateSetSource<TTable>;
}

/**
 * Returns the first row of a query promise or throws an error if nothing is returned.
 */
export async function takeFirstOrThrow<T>(
	queryPromise: Promise<T[]>,
	errorMessage: string = 'Query returned no rows.',
): Promise<T> {
	const result = await queryPromise;
	if (result.length === 0) {
		throw new Error(errorMessage);
	}
	return result[0];
}
