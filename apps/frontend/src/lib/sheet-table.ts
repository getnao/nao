export interface SheetTable {
	columns: string[];
	rows: Record<string, unknown>[];
}

/**
 * Turns a grid of cells into rows a table can render.
 *
 * The first row becomes the header when it reads like one — a filled label in every column, the way
 * an export writes it. A workbook opens on a title or a spacer row just as often, so the fallback is
 * the spreadsheet's own column letters, which keeps every row visible rather than eating one.
 */
export function toSheetTable(cells: unknown[][]): SheetTable {
	const width = cells.reduce((widest, row) => Math.max(widest, row.length), 0);
	const [firstRow = []] = cells;
	const hasHeader = looksLikeHeader(firstRow, width);

	const columns = hasHeader ? toHeaderNames(firstRow, width) : toColumnLetters(width);
	const rows = (hasHeader ? cells.slice(1) : cells).map((row) => {
		return Object.fromEntries(columns.map((column, index) => [column, toCellValue(row[index])]));
	});

	return { columns, rows };
}

const looksLikeHeader = (row: unknown[], width: number): boolean => {
	return (
		width > 0 &&
		row.length === width &&
		Array.from({ length: width }, (_, index) => row[index]).every(
			(cell) => typeof cell === 'string' && cell.trim() !== '',
		)
	);
};

/** A repeated label still needs a name of its own, since the rows are keyed by it. */
function toHeaderNames(row: unknown[], width: number): string[] {
	const taken = new Set<string>();

	return Array.from({ length: width }, (_, index) => {
		const label = String(row[index] ?? '').trim() || toColumnLetter(index);
		let name = label;
		for (let suffix = 2; taken.has(name); suffix++) {
			name = `${label} (${suffix})`;
		}
		taken.add(name);
		return name;
	});
}

const toColumnLetters = (width: number): string[] => {
	return Array.from({ length: width }, (_, index) => toColumnLetter(index));
};

const toColumnLetter = (index: number): string => {
	let letters = '';
	for (let remaining = index; remaining >= 0; remaining = Math.floor(remaining / 26) - 1) {
		letters = String.fromCharCode(65 + (remaining % 26)) + letters;
	}
	return letters;
};

/** A workbook hands back real dates, which the table renders from their ISO form. */
const toCellValue = (value: unknown): unknown => {
	if (value === undefined) {
		return null;
	}
	return value instanceof Date ? value.toISOString() : value;
};
