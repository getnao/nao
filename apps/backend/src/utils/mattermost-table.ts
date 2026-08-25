export const MATTERMOST_POST_MAX_LENGTH = 16_383;
export const MATTERMOST_TABLE_ROW_LIMIT = 20;

const MATTERMOST_TABLE_COLUMN_LIMIT = 20;
const MATTERMOST_TABLE_CELL_LIMIT = 160;
const MATTERMOST_TABLE_MAX_LENGTH = 12_000;

export function createMattermostMarkdownTable(input: {
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
	const columns = allColumns.slice(0, MATTERMOST_TABLE_COLUMN_LIMIT);
	const fixedLines = [
		`**${formatCell(input.title)}**`,
		'',
		`| ${columns.map(formatCell).join(' | ')} |`,
		`| ${columns.map(() => '---').join(' | ')} |`,
	];
	const dataLines: string[] = [];
	for (const row of input.rows.slice(0, MATTERMOST_TABLE_ROW_LIMIT)) {
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
		if (candidate.length > MATTERMOST_TABLE_MAX_LENGTH) {
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

export function truncateMattermostMarkdown(markdown: string, maxLength = MATTERMOST_POST_MAX_LENGTH): string {
	if (markdown.length <= maxLength) {
		return markdown;
	}
	const notice = '\n\n_Response truncated. Open the full result in nao._';
	const available = Math.max(maxLength - notice.length, 0);
	const prefix = markdown.slice(0, available);
	const lastLineBreak = prefix.lastIndexOf('\n');
	const safePrefix = prefix.slice(0, lastLineBreak > 0 ? lastLineBreak : available).trimEnd();
	return `${safePrefix}${notice}`.slice(0, maxLength);
}

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
	const truncated =
		text.length > MATTERMOST_TABLE_CELL_LIMIT ? `${text.slice(0, MATTERMOST_TABLE_CELL_LIMIT - 1)}…` : text;
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
