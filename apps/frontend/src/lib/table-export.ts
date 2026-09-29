import writeXlsxFile from 'write-excel-file/universal';
import { formatCellValue } from '@nao/shared/story-table-utils';
import type { DateFormatSettings } from '@nao/shared/date';
import type { Cell, Row } from 'write-excel-file/universal';
import { triggerDownload } from '@/lib/download';

type TableRow = Record<string, unknown>;

const neutralizeFormula = (value: string, preserveNegativeNumericValue = false) =>
	/^[=+\-@\t\r]/.test(value) && !(preserveNegativeNumericValue && value.startsWith('-')) ? `'${value}` : value;

const escapeCsvCell = (value: string, preserveNegativeNumericValue = false) => {
	const safe = neutralizeFormula(value, preserveNegativeNumericValue);
	return /[",\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
};

export function tableToCsv(columns: string[], rows: TableRow[], dateFormat: DateFormatSettings | null): string {
	return [
		columns.map((column) => escapeCsvCell(column)).join(','),
		...rows.map((row) =>
			columns
				.map((column) => {
					const value = row[column];
					return escapeCsvCell(formatCellValue(value, dateFormat), isNegativeNumber(value));
				})
				.join(','),
		),
	].join('\n');
}

export function tableToTsv(columns: string[], rows: TableRow[], dateFormat: DateFormatSettings | null): string {
	const clean = (value: string, preserveNegativeNumericValue = false) =>
		neutralizeFormula(value, preserveNegativeNumericValue).replace(/[\t\n]/g, ' ');
	return [
		columns.map((column) => clean(column)).join('\t'),
		...rows.map((row) =>
			columns
				.map((column) => {
					const value = row[column];
					return clean(formatCellValue(value, dateFormat), isNegativeNumber(value));
				})
				.join('\t'),
		),
	].join('\n');
}

function isNegativeNumber(value: unknown): boolean {
	return typeof value === 'number' && Number.isFinite(value) && value < 0;
}

function tableToXlsxBlob(columns: string[], rows: TableRow[], dateFormat: DateFormatSettings | null): Promise<Blob> {
	const header: Row = columns.map((column) => ({ value: column, fontWeight: 'bold' }));
	const body: Row[] = rows.map((row) => columns.map((column) => toXlsxCell(row[column], dateFormat)));
	return writeXlsxFile([header, ...body]).toBlob();
}

function toXlsxCell(value: unknown, dateFormat: DateFormatSettings | null): Cell {
	if (value === null || value === undefined) {
		return null;
	}
	if (typeof value === 'number') {
		return Number.isFinite(value) ? { type: Number, value } : null;
	}
	if (typeof value === 'boolean') {
		return { type: Boolean, value };
	}
	return { type: String, value: formatCellValue(value, dateFormat) };
}

export function downloadCsv(filename: string, csv: string): void {
	triggerDownload(filename, new Blob([csv], { type: 'text/csv;charset=utf-8;' }));
}

export async function downloadXlsx(
	filename: string,
	columns: string[],
	rows: TableRow[],
	dateFormat: DateFormatSettings | null,
): Promise<void> {
	triggerDownload(filename, await tableToXlsxBlob(columns, rows, dateFormat));
}
