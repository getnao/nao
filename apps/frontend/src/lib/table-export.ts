import writeXlsxFile from 'write-excel-file/universal';
import { formatCellValue } from '@nao/shared/story-table-utils';
import type { Cell, Row } from 'write-excel-file/universal';

type TableRow = Record<string, unknown>;

const neutralizeFormula = (value: string) => (/^[=+\-@\t\r]/.test(value) ? `'${value}` : value);

const escapeCsvCell = (value: string) => {
	const safe = neutralizeFormula(value);
	return /[",\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
};

export function tableToCsv(columns: string[], rows: TableRow[]): string {
	return [
		columns.map(escapeCsvCell).join(','),
		...rows.map((row) => columns.map((column) => escapeCsvCell(formatCellValue(row[column]))).join(',')),
	].join('\n');
}

export function tableToTsv(columns: string[], rows: TableRow[]): string {
	const clean = (value: string) => neutralizeFormula(value).replace(/[\t\n]/g, ' ');
	return [
		columns.map(clean).join('\t'),
		...rows.map((row) => columns.map((column) => clean(formatCellValue(row[column]))).join('\t')),
	].join('\n');
}

function tableToXlsxBlob(columns: string[], rows: TableRow[]): Promise<Blob> {
	const header: Row = columns.map((column) => ({ value: column, fontWeight: 'bold' }));
	const body: Row[] = rows.map((row) => columns.map((column) => toXlsxCell(row[column])));
	return writeXlsxFile([header, ...body]).toBlob();
}

function toXlsxCell(value: unknown): Cell {
	if (value === null || value === undefined) {
		return null;
	}
	if (typeof value === 'number') {
		return Number.isFinite(value) ? { type: Number, value } : null;
	}
	if (typeof value === 'boolean') {
		return { type: Boolean, value };
	}
	return { type: String, value: formatCellValue(value) };
}

export function downloadCsv(filename: string, csv: string): void {
	triggerDownload(filename, new Blob([csv], { type: 'text/csv;charset=utf-8;' }));
}

export async function downloadXlsx(filename: string, columns: string[], rows: TableRow[]): Promise<void> {
	triggerDownload(filename, await tableToXlsxBlob(columns, rows));
}

function triggerDownload(filename: string, blob: Blob): void {
	const url = URL.createObjectURL(blob);
	const link = document.createElement('a');
	link.href = url;
	link.download = filename;
	link.click();
	URL.revokeObjectURL(url);
}
