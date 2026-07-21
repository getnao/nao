import { type DateFormatSettings, formatDateValue, isIsoDateLike } from './date';

export function formatCellValue(value: unknown, dateFormat?: DateFormatSettings | null): string {
	if (typeof value === 'string') {
		if (isIsoDateLike(value)) {
			return formatDateValue(value, dateFormat);
		}
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

export type SortDirection = 'asc' | 'desc';

export function sortTableRows<Row extends Record<string, unknown>>(
	rows: Row[],
	column: string,
	direction: SortDirection,
): Row[] {
	const factor = direction === 'asc' ? 1 : -1;
	return [...rows].sort((a, b) => {
		const left = a[column];
		const right = b[column];
		const leftIsNull = left === null || left === undefined;
		const rightIsNull = right === null || right === undefined;
		if (leftIsNull && rightIsNull) {
			return 0;
		}
		if (leftIsNull) {
			return 1;
		}
		if (rightIsNull) {
			return -1;
		}
		return factor * compareCellValues(left, right);
	});
}

const enum ValueRank {
	Number = 0,
	Boolean = 1,
	Date = 2,
	Text = 3,
}

function compareCellValues(left: unknown, right: unknown): number {
	const leftRank = valueRank(left);
	const rightRank = valueRank(right);
	if (leftRank !== rightRank) {
		return leftRank - rightRank;
	}
	switch (leftRank) {
		case ValueRank.Number:
			return (left as number) - (right as number);
		case ValueRank.Boolean:
			return left === right ? 0 : left ? 1 : -1;
		case ValueRank.Date:
			return new Date(left as string).getTime() - new Date(right as string).getTime();
		default:
			return String(left).localeCompare(String(right), undefined, { numeric: true, sensitivity: 'base' });
	}
}

function valueRank(value: unknown): ValueRank {
	if (typeof value === 'number') {
		return ValueRank.Number;
	}
	if (typeof value === 'boolean') {
		return ValueRank.Boolean;
	}
	if (typeof value === 'string' && isIsoDateLike(value)) {
		return ValueRank.Date;
	}
	return ValueRank.Text;
}

export function formatColumnLabel(column: string): string {
	return column
		.replace(/_/g, ' ')
		.trim()
		.split(/\s+/)
		.filter(Boolean)
		.map((word) => word.charAt(0).toUpperCase() + word.slice(1))
		.join(' ');
}

export function isNumericColumn(rows: Record<string, unknown>[], column: string): boolean {
	return rows
		.filter((row) => row[column] !== null && row[column] !== undefined)
		.every((row) => isNumericValue(row[column]));
}

export function isBooleanColumn(rows: Record<string, unknown>[], column: string): boolean {
	const values = nonNullColumnValues(rows, column);
	return values.length > 0 && values.every((value) => typeof value === 'boolean');
}

export function isStringColumn(rows: Record<string, unknown>[], column: string): boolean {
	const values = nonNullColumnValues(rows, column);
	return values.length > 0 && values.every((value) => typeof value === 'string');
}

export type FormattableColumnType = 'numeric' | 'boolean' | 'string';

/** Classifies a column's data type for choosing which conditional-formatting rules apply. */
export function getFormattableColumnType(
	rows: Record<string, unknown>[],
	column: string,
): FormattableColumnType | null {
	const values = nonNullColumnValues(rows, column);
	if (values.length === 0) {
		return null;
	}
	if (values.every(isNumericValue)) {
		return 'numeric';
	}
	if (values.every((value) => typeof value === 'boolean')) {
		return 'boolean';
	}
	if (values.every((value) => typeof value === 'string')) {
		return 'string';
	}
	return null;
}

function nonNullColumnValues(rows: Record<string, unknown>[], column: string): unknown[] {
	return rows.map((row) => row[column]).filter((value) => value !== null && value !== undefined);
}

function isNumericValue(value: unknown): boolean {
	return typeof value === 'number' && Number.isFinite(value);
}
