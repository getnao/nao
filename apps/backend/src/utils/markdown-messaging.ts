import type { SqlOutput } from '../types/messaging-provider';

export const MARKDOWN_TABLE_ROW_LIMIT = 20;
export const TRUNCATION_NOTICE = '\n\n_Response truncated. Open the full result in nao._';

export type LoginCommand = {
	code: string;
};

export type ReactionFeedback = { action: 'upsert'; vote: 'up' | 'down' } | { action: 'delete'; vote: 'up' | 'down' };

export type MessageAuthorType = 'bot' | 'human' | 'unknown';

export function parseLoginCommand(text: string): LoginCommand | null {
	const match = /^\s*\/?login\s+([a-z0-9_-]{8})\s*$/i.exec(text);
	if (!match) {
		return null;
	}
	return { code: match[1].toLowerCase() };
}

export function getLoginCommandForUnlinkedUser(text: string, isAuthorLinked: boolean): LoginCommand | null {
	if (isAuthorLinked) {
		return null;
	}
	return parseLoginCommand(text);
}

export function shouldHandleMessage(input: {
	isDirectMessage: boolean;
	isThreadReply: boolean;
	isMention: boolean;
	hasExistingChat: boolean;
	authorType: MessageAuthorType;
	isOwnMessage: boolean;
}): boolean {
	if (input.authorType === 'bot' || input.isOwnMessage) {
		return false;
	}
	if (input.isMention) {
		return true;
	}
	if (input.authorType === 'unknown') {
		return input.isDirectMessage && !input.isThreadReply;
	}
	if (!input.isDirectMessage) {
		return input.hasExistingChat;
	}
	return !input.isThreadReply || input.hasExistingChat;
}

export async function resolveSqlOutput(input: {
	queryId: string;
	sqlOutputs: Map<string, SqlOutput>;
	loadPersisted: (queryId: string) => Promise<SqlOutput | null>;
}): Promise<SqlOutput | undefined> {
	const inStream = input.sqlOutputs.get(input.queryId);
	if (inStream) {
		return inStream;
	}
	try {
		const persisted = await input.loadPersisted(input.queryId);
		if (!persisted) {
			return undefined;
		}
		input.sqlOutputs.set(input.queryId, persisted);
		return persisted;
	} catch {
		return undefined;
	}
}

export function createMarkdownTable(input: {
	title: string;
	rows: Record<string, unknown>[] | null | undefined;
}): string | null {
	if (!input.rows?.length) {
		return null;
	}
	const allColumns = Object.keys(input.rows[0]);
	if (allColumns.length === 0) {
		return null;
	}
	const columns = allColumns.slice(0, TABLE_COLUMN_LIMIT);
	const fixedLines = [
		`**${formatCell(input.title)}**`,
		'',
		`| ${columns.map(formatCell).join(' | ')} |`,
		`| ${columns.map(() => '---').join(' | ')} |`,
	];
	const dataLines: string[] = [];
	for (const row of input.rows.slice(0, MARKDOWN_TABLE_ROW_LIMIT)) {
		const line = `| ${columns.map((column) => formatCell(row[column])).join(' | ')} |`;
		const omittedRows = input.rows.length - dataLines.length - 1;
		const candidate = [
			...fixedLines,
			...dataLines,
			line,
			...createOmissionLines(omittedRows, allColumns.length - columns.length),
		]
			.join('\n')
			.trim();
		if (candidate.length > TABLE_MAX_LENGTH) {
			break;
		}
		dataLines.push(line);
	}
	return [
		...fixedLines,
		...dataLines,
		...createOmissionLines(input.rows.length - dataLines.length, allColumns.length - columns.length),
	]
		.join('\n')
		.trim();
}

export function truncateMarkdown(markdown: string, maxLength: number, notice = TRUNCATION_NOTICE): string {
	if (markdown.length <= maxLength) {
		return markdown;
	}
	const available = Math.max(maxLength - notice.length, 0);
	const prefix = markdown.slice(0, available);
	const lastLineBreak = prefix.lastIndexOf('\n');
	const safePrefix = prefix.slice(0, lastLineBreak > 0 ? lastLineBreak : available).trimEnd();
	return `${safePrefix}${notice}`.slice(0, maxLength);
}

const TABLE_COLUMN_LIMIT = 20;
const TABLE_CELL_LIMIT = 160;
const TABLE_MAX_LENGTH = 12_000;

function createOmissionLines(omittedRows: number, omittedColumns: number): string[] {
	const lines: string[] = [];
	if (omittedRows > 0) {
		lines.push(`_${omittedRows} ${omittedRows === 1 ? 'row' : 'rows'} omitted. Open the full result in nao._`);
	}
	if (omittedColumns > 0) {
		lines.push(
			`_${omittedColumns} ${omittedColumns === 1 ? 'column' : 'columns'} omitted. Open the full result in nao._`,
		);
	}
	return lines.length > 0 ? ['', ...lines] : lines;
}

function formatCell(value: unknown): string {
	const text = stringifyCell(value).replace(/\r?\n|\r/g, '<br>');
	const truncated = text.length > TABLE_CELL_LIMIT ? `${text.slice(0, TABLE_CELL_LIMIT - 1)}…` : text;
	return truncated.replace(/\|/g, '\\|');
}

function stringifyCell(value: unknown): string {
	if (value === null || value === undefined) {
		return '';
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
