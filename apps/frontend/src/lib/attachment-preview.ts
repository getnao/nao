import { fileExtension } from '@nao/shared/attachments';

import { fetchAttachment, fetchAttachmentSize } from '@/lib/attachments';
import { parseDelimitedText } from '@/lib/delimited-text';
import { toSheetTable } from '@/lib/sheet-table';
import { capWorkbookForPreview } from '@/lib/workbook-preview';

/** Rows beyond this are dropped: paging through a million of them is slower than the preview is useful. */
export const MAX_PREVIEW_ROWS = 5000;
export const MAX_TABULAR_PREVIEW_SIZE_MB = 10;

export interface AttachmentSheet {
	name: string;
	columns: string[];
	rows: Record<string, unknown>[];
	/** True when the sheet has more rows than the preview kept. */
	truncated: boolean;
}

export type AttachmentPreview =
	| { kind: 'table'; sheets: AttachmentSheet[] }
	| { kind: 'markdown'; content: string }
	| { kind: 'text'; content: string }
	| { kind: 'pdf'; blob: Blob }
	| { kind: 'too-large' }
	| { kind: 'unsupported' };

type PreviewKind = 'table' | 'workbook' | 'markdown' | 'text' | 'pdf' | 'unsupported';

const PREVIEW_KINDS: Record<string, PreviewKind> = {
	csv: 'table',
	tsv: 'table',
	xlsx: 'workbook',
	pdf: 'pdf',
	md: 'markdown',
	txt: 'text',
	json: 'text',
	jsonl: 'text',
	sql: 'text',
	yaml: 'text',
	yml: 'text',
	xml: 'text',
	html: 'text',
};

export async function loadAttachmentPreview(path: string): Promise<AttachmentPreview> {
	const kind = previewKindOf(path);
	if (kind === 'unsupported') {
		return { kind: 'unsupported' };
	}

	const isTabular = kind === 'table' || kind === 'workbook';
	if (isTabular && (await fetchAttachmentSize(path)) > MAX_TABULAR_PREVIEW_SIZE_MB * 1024 * 1024) {
		return { kind: 'too-large' };
	}

	const blob = await fetchAttachment(path);
	if (isTabular && blob.size > MAX_TABULAR_PREVIEW_SIZE_MB * 1024 * 1024) {
		return { kind: 'too-large' };
	}

	switch (kind) {
		case 'pdf':
			return { kind: 'pdf', blob };
		case 'markdown':
			return { kind: 'markdown', content: await blob.text() };
		case 'text':
			return { kind: 'text', content: await blob.text() };
		case 'table':
			return { kind: 'table', sheets: [readDelimitedSheet(path, await blob.text())] };
		case 'workbook':
			return { kind: 'table', sheets: await readWorkbookSheets(blob) };
	}
}

const previewKindOf = (fileName: string): PreviewKind => {
	return PREVIEW_KINDS[fileExtension(fileName)] ?? 'unsupported';
};

const readDelimitedSheet = (path: string, text: string): AttachmentSheet => {
	const delimiter = fileExtension(path) === 'tsv' ? '\t' : undefined;
	return toSheet(path.split('/').pop() ?? path, parseDelimitedText(text, delimiter, MAX_PREVIEW_ROWS + 1));
};

/** The workbook parser is loaded on demand, since most chats never open a spreadsheet. */
const readWorkbookSheets = async (blob: Blob): Promise<AttachmentSheet[]> => {
	const { default: readXlsxFile } = await import('read-excel-file/browser');
	const sheets = await readXlsxFile(await capWorkbookForPreview(blob, MAX_PREVIEW_ROWS + 1));
	return sheets.map(({ sheet, data }) => toSheet(sheet, data));
};

function toSheet(name: string, cells: unknown[][]): AttachmentSheet {
	const truncated = cells.length > MAX_PREVIEW_ROWS;
	return { name, truncated, ...toSheetTable(truncated ? cells.slice(0, MAX_PREVIEW_ROWS) : cells) };
}
