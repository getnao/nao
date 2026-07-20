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
