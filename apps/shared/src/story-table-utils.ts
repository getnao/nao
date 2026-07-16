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

function isNumericValue(value: unknown): boolean {
	return typeof value === 'number' && Number.isFinite(value);
}
