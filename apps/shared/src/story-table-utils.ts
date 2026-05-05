export function formatCellValue(value: unknown): string {
	if (typeof value === 'string') {
		return value;
	}
	if (typeof value === 'number') {
		return Number.isFinite(value) ? String(value) : 'NULL';
	}
	if (typeof value === 'boolean') {
		return value ? 'TRUE' : 'FALSE';
	}
	if (value === null || value === undefined) {
		return 'NULL';
	}
	if (typeof value === 'object') {
		try {
			return JSON.stringify(value);
		} catch {
			return String(value);
		}
	}
	return String(value);
}

export function isNumericColumn(rows: Record<string, unknown>[], column: string): boolean {
	return rows
		.filter((row) => row[column] !== null && row[column] !== undefined)
		.every((row) => isNumericValue(row[column]));
}

function isNumericValue(value: unknown): boolean {
	return typeof value === 'number' && Number.isFinite(value);
}

export type ColumnSortKind = 'numeric' | 'date' | 'string';

export type SortDirection = 'asc' | 'desc';

const DATE_LIKE = /^\d{4}-\d{2}-\d{2}([T ]\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})?)?$/;

export function inferColumnSortKind(rows: Record<string, unknown>[], column: string): ColumnSortKind {
	const present = rows.filter((row) => row[column] !== null && row[column] !== undefined);
	if (present.length === 0) {
		return 'string';
	}
	if (present.every((row) => isNumericValue(row[column]))) {
		return 'numeric';
	}
	if (present.every((row) => typeof row[column] === 'string' && DATE_LIKE.test(row[column] as string))) {
		return 'date';
	}
	return 'string';
}

export function sortRowsByColumn<T extends Record<string, unknown>>(
	rows: T[],
	column: string,
	direction: SortDirection,
	kind: ColumnSortKind,
): T[] {
	const factor = direction === 'asc' ? 1 : -1;
	return rows
		.map((row, index) => ({ row, index }))
		.sort((a, b) => {
			const aNull = a.row[column] === null || a.row[column] === undefined;
			const bNull = b.row[column] === null || b.row[column] === undefined;
			if (aNull && bNull) {
				return a.index - b.index;
			}
			if (aNull) {
				return 1;
			}
			if (bNull) {
				return -1;
			}
			const cmp = compareCells(a.row[column], b.row[column], kind);
			return cmp !== 0 ? cmp * factor : a.index - b.index;
		})
		.map((entry) => entry.row);
}

function compareCells(a: unknown, b: unknown, kind: ColumnSortKind): number {
	if (kind === 'numeric') {
		return (a as number) - (b as number);
	}
	if (kind === 'date') {
		return Date.parse(a as string) - Date.parse(b as string);
	}
	return String(a).localeCompare(String(b));
}
