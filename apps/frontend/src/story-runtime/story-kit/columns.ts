import { toFiniteNumber } from '@nao/shared/chart-values';

export type Row = Record<string, unknown>;

export function columnsOf(rows: Row[]): string[] {
	const columns = new Set<string>();
	for (const row of rows) {
		for (const key of Object.keys(row)) {
			columns.add(key);
		}
	}
	return [...columns];
}

export function isNumericColumn(rows: Row[], column: string): boolean {
	const values = rows.map((row) => row[column]).filter((value) => value !== null && value !== undefined);
	return values.length > 0 && values.every((value) => toFiniteNumber(value) !== null);
}

/** Warehouse drivers often return numerics as strings; shared charts, cards and tables only treat real numbers as numeric. */
export function withNumericValues(rows: Row[], keys: string[]): Row[] {
	return rows.map((row) => {
		const next: Row = { ...row };
		for (const key of keys) {
			next[key] = toFiniteNumber(row[key]) ?? row[key];
		}
		return next;
	});
}
