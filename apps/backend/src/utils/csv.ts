export type CsvValue = string | number | null;

export function buildCsv(header: string[], rows: CsvValue[][]): string {
	return [header, ...rows].map((row) => row.map(formatCsvCell).join(',')).join('\n');
}

function formatCsvCell(value: CsvValue): string {
	if (value === null) {
		return '';
	}
	if (typeof value === 'number') {
		return String(value);
	}
	const safe = neutralizeFormula(value);
	return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

/** Spreadsheets evaluate text cells starting with these characters as formulas. */
function neutralizeFormula(value: string): string {
	return /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
}
