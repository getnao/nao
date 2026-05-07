export function escapeCsvCell(value: unknown): string {
	const str = value === null || value === undefined ? '' : String(value);
	const sanitized = /^[=+\-@]/.test(str.trimStart()) ? `'${str}` : str;
	return /[,"\n]/.test(sanitized) ? `"${sanitized.replace(/"/g, '""')}"` : sanitized;
}

function inferColumnsFromRows(rows: Record<string, unknown>[]): string[] {
	const seen = new Set<string>();
	const columns: string[] = [];
	for (const row of rows) {
		for (const key of Object.keys(row)) {
			if (!seen.has(key)) {
				seen.add(key);
				columns.push(key);
			}
		}
	}
	return columns;
}

export function resolveTabularColumns(columns: string[] | undefined, rows: Record<string, unknown>[]): string[] {
	if (columns && columns.length > 0) {
		return columns;
	}
	return inferColumnsFromRows(rows);
}

export function rowsToCsvString(columns: string[] | undefined, rows: Record<string, unknown>[]): string {
	const cols = resolveTabularColumns(columns, rows);
	if (cols.length === 0) {
		return '';
	}
	const header = cols.map(escapeCsvCell).join(',');
	const bodyRows = rows.map((row) => cols.map((col) => escapeCsvCell(row[col])).join(','));
	return bodyRows.length > 0 ? [header, ...bodyRows].join('\n') : header;
}

const INVALID_DOWNLOAD_BASENAME_CHARS = /[/\\?%*:|"<>]/g;

export function sanitizeCsvBasename(rawTitle: string | undefined, fallback: string): string {
	const trimmed = (rawTitle ?? '').trim();
	const base = (trimmed || fallback).replace(INVALID_DOWNLOAD_BASENAME_CHARS, '-').trim();
	const clipped = base.slice(0, 180);
	return clipped || fallback;
}
