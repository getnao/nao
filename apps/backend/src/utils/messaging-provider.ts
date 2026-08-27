import { cardToBlockKit } from '@chat-adapter/slack';
import { pluralize, stripAssistantTags, TOOL_LABELS } from '@nao/shared';
import type { CardChild, CardElement, ModalElement } from 'chat';
import { Actions, Button, Card, CardText, Image, LinkButton, Table } from 'chat';

import { generateMapImage } from '../components/generate-map';
import * as projectQueries from '../queries/project.queries';
import { UIMessagePart } from '../types/chat';
import { StreamState, ToolCallEntry } from '../types/messaging-provider';
import { BudgetExceededError } from './error';
import { logger } from './logger';

export const EXCLUDED_TOOLS = [
	'tool-suggest_follow_ups',
	'tool-display_chart',
	'tool-display_map',
	'tool-clarification',
];

export const createLiveToolCall = (toolGroup: Map<string, ToolCallEntry>): CardChild => {
	const parts = [...countToolsByNoun(toolGroup).entries()].map(
		([noun, count]) => `*${count} ${pluralize(noun, count)}*`,
	);
	return CardText(`_Exploring ${parts.join(', ')}..._`);
};

export const createSummaryToolCalls = (toolGroup: Map<string, ToolCallEntry>): CardChild => {
	const parts = [...countToolsByNoun(toolGroup).entries()].map(
		([noun, count]) => `**${count} ${pluralize(noun, count)}**`,
	);
	return CardText(`_Explored ${parts.join(', ')}._`, { style: 'muted' });
};

const countToolsByNoun = (toolGroup: Map<string, ToolCallEntry>): Map<string, number> => {
	const countByNoun = new Map<string, number>();
	for (const entry of toolGroup.values()) {
		const noun = TOOL_LABELS[entry.type] ?? entry.type.replace('tool-', '');
		countByNoun.set(noun, (countByNoun.get(noun) ?? 0) + 1);
	}
	return countByNoun;
};

export const FEEDBACK_MODAL_CALLBACK_ID = 'feedback_negative_modal';

export const createFeedbackModal = (): ModalElement => ({
	type: 'modal',
	callbackId: FEEDBACK_MODAL_CALLBACK_ID,
	title: 'What went wrong?',
	submitLabel: 'Submit',
	children: [
		{
			type: 'text_input',
			id: 'explanation',
			label: 'Help us improve by explaining what was wrong with this response.',
			placeholder: 'Tell us what could be better',
			multiline: true,
			optional: true,
		},
	],
});

export const createStopButtonActions = (): CardChild =>
	Actions([Button({ id: 'stop_generation', label: 'Stop Generation', style: 'primary' })]);

export const createStopButtonCard = (): CardElement =>
	Card({
		children: [createStopButtonActions()],
	});

export const createTelegramStopButtonCard = (): CardElement =>
	Card({
		children: [
			CardText('The agent is thinking...'),
			Actions([
				Button({
					id: 'stop_generation',
					label: '⏹️ Stop Generation',
				}),
			]),
		],
	});

export const createCompletionCard = (chatUrl: string, vote?: 'up' | 'down', hiddenTables = 0): CardElement =>
	Card({
		children: [
			Actions([
				LinkButton({
					url: chatUrl,
					label:
						hiddenTables === 0
							? 'Open in nao'
							: hiddenTables === 1
								? 'Open the other table in nao'
								: `Open the other ${hiddenTables} tables in nao`,
					...(hiddenTables > 0 ? { style: 'primary' } : {}),
				}),
				Button({ id: 'feedback_positive', label: '👍', style: vote === 'up' ? 'primary' : 'default' }),
				Button({ id: 'feedback_negative', label: '👎', style: vote === 'down' ? 'primary' : 'default' }),
			]),
		],
	});

export const createTelegramCompletionCard = (chatUrl: string, vote?: 'up' | 'down') =>
	Card({
		children: [
			CardText('What do you think about this response?'),

			Actions([
				LinkButton({
					url: chatUrl,
					label: 'Open in nao',
				}),
				Button({
					id: 'feedback_positive',
					label: vote === 'up' ? '✅' : '👍',
				}),
				Button({
					id: 'feedback_negative',
					label: vote === 'down' ? '❌' : '👎',
				}),
			]),
		],
	});

export const createTextBlock = (text: string): CardChild => {
	const rendered = mdToMrkdwn(text);
	return CardText(rendered || text);
};

export const SLACK_SECTION_TEXT_MAX_CHARS = 2900;

export type TruncationNotice = { kind: 'hidden' } | { kind: 'note' } | { kind: 'link'; url: string };

export type SlackTableRenderState = {
	remainingTableChars: number;
	hasNativeTable: boolean;
	tableNumber: number;
};

export const createSlackTableRenderState = (): SlackTableRenderState => ({
	remainingTableChars: SLACK_TABLE_MAX_TOTAL_CHARS,
	hasNativeTable: false,
	tableNumber: 0,
});

type CreateTextBlocksOptions = {
	truncation?: TruncationNotice;
	tableState?: SlackTableRenderState;
};

export const createTextBlocks = (text: string, options: CreateTextBlocksOptions = {}): CardChild[] => {
	const blocks: CardChild[] = [];
	const tableState = options.tableState ?? createSlackTableRenderState();
	const truncation = options.truncation ?? { kind: 'note' };
	for (const segment of splitMarkdownSegments(text)) {
		if (segment.type === 'table') {
			tableState.tableNumber++;
			if (tableState.hasNativeTable) {
				const notice = createHiddenTableNotice(truncation, tableState.tableNumber);
				if (notice) {
					blocks.push(notice);
				}
				continue;
			}

			const fittedTable = fitTableToSlackLimits(segment.headers, segment.rows, tableState.remainingTableChars);
			tableState.remainingTableChars -= fittedTable.totalChars;
			tableState.hasNativeTable = true;

			if (fittedTable.headers.length > 0) {
				blocks.push(Table({ headers: fittedTable.headers, rows: fittedTable.rows }));
			}

			const truncationNotice = createTableTruncationNotice(
				truncation,
				fittedTable.hiddenColumns,
				fittedTable.hiddenRows,
			);
			if (truncationNotice) {
				blocks.push(truncationNotice);
			}
			continue;
		}
		const rendered = mdToMrkdwn(segment.text).trim();
		if (rendered) {
			blocks.push(...chunkSlackText(rendered, SLACK_SECTION_TEXT_MAX_CHARS).map((chunk) => CardText(chunk)));
		}
	}
	return blocks;
};

function createTableTruncationNotice(
	truncation: TruncationNotice,
	hiddenColumns: number,
	hiddenRows: number,
): CardChild | null {
	if (truncation.kind === 'hidden' || (hiddenColumns === 0 && hiddenRows === 0)) {
		return null;
	}
	if (truncation.kind === 'link') {
		return Actions([LinkButton({ url: truncation.url, label: 'Open in nao to see full table' })]);
	}

	const hiddenParts: string[] = [];
	if (hiddenRows > 0) {
		hiddenParts.push(`${hiddenRows} more ${pluralize('row', hiddenRows)}`);
	}
	if (hiddenColumns > 0) {
		hiddenParts.push(`${hiddenColumns} more ${pluralize('column', hiddenColumns)}`);
	}
	return CardText(`_…${hiddenParts.join(' and ')}, open in nao_`, { style: 'muted' });
}

const HIDDEN_TABLE_NOTICE_INDENT = '\u00a0'.repeat(4);
const HIDDEN_TABLE_NOTICE_PATTERN = /^\u00a0{4}\*\[ Table \d+ \]\*$/;

function createHiddenTableNotice(truncation: TruncationNotice, tableNumber: number): CardChild | null {
	if (truncation.kind === 'hidden') {
		return null;
	}
	return CardText(`${HIDDEN_TABLE_NOTICE_INDENT}*[ Table ${tableNumber} ]*`, { style: 'muted' });
}

export function countHiddenTableNotices(children: CardChild[]): number {
	return children.filter((child) => child.type === 'text' && HIDDEN_TABLE_NOTICE_PATTERN.test(child.content)).length;
}

const SLACK_CARD_NOTIFICATION_MAX_CHARS = 1000;
const SLACK_TABLE_NOTIFICATION_TEXT = 'Results table (open in nao for full data)';

export function buildSlackCardNotificationText(children: CardChild[]): string {
	const { hasTable, text } = collectSlackCardNotificationContent(children);
	const joinedText = text.join(' ').replace(/\s+/g, ' ').trim();
	if (hasTable) {
		const textBudget = SLACK_CARD_NOTIFICATION_MAX_CHARS - SLACK_TABLE_NOTIFICATION_TEXT.length - 1;
		const fittedText = joinedText ? truncateSlackText(joinedText, textBudget) : '';
		return fittedText ? `${fittedText}\n${SLACK_TABLE_NOTIFICATION_TEXT}` : SLACK_TABLE_NOTIFICATION_TEXT;
	}
	return joinedText ? truncateSlackText(joinedText, SLACK_CARD_NOTIFICATION_MAX_CHARS) : 'nao answer';
}

function collectSlackCardNotificationContent(children: CardChild[]): {
	hasTable: boolean;
	text: string[];
} {
	let hasTable = false;
	const text: string[] = [];
	for (const child of children) {
		if (child.type === 'text' && child.content.trim()) {
			text.push(child.content.trim());
		} else if (child.type === 'table') {
			hasTable = true;
		} else if (child.type === 'section') {
			const nested = collectSlackCardNotificationContent(child.children);
			hasTable ||= nested.hasTable;
			text.push(...nested.text);
		}
	}
	return { hasTable, text };
}

// Slack's table row limit includes the header row added by the adapter.
const SLACK_TABLE_MAX_DATA_ROWS = 99;
const SLACK_TABLE_MAX_COLUMNS = 20;
const SLACK_TABLE_MAX_CELL_CHARS = 300;
const SLACK_TABLE_MAX_TOTAL_CHARS = 9000;

type FittedTable = {
	headers: string[];
	rows: string[][];
	hiddenColumns: number;
	hiddenRows: number;
	totalChars: number;
};

const clampCell = (cell: string): string =>
	cell.length > SLACK_TABLE_MAX_CELL_CHARS ? `${cell.slice(0, SLACK_TABLE_MAX_CELL_CHARS - 1)}…` : cell;

const rowCharCount = (row: string[]): number => row.reduce((total, cell) => total + Math.max(cell.length, 1), 0);

function fitTableToSlackLimits(rawHeaders: string[], rawRows: string[][], characterBudget: number): FittedTable {
	const columnCount = Math.min(rawHeaders.length, SLACK_TABLE_MAX_COLUMNS);
	const headers = fitRowToBudget(rawHeaders.slice(0, columnCount).map(clampCell), characterBudget);
	if (headers.length === 0) {
		return {
			headers: [],
			rows: [],
			hiddenColumns: rawHeaders.length,
			hiddenRows: rawRows.length,
			totalChars: 0,
		};
	}
	const rows: string[][] = [];
	let totalChars = rowCharCount(headers);
	for (const rawRow of rawRows) {
		if (rows.length >= SLACK_TABLE_MAX_DATA_ROWS) {
			break;
		}
		const row = rawRow.slice(0, columnCount).map(clampCell);
		const cost = rowCharCount(row);
		if (totalChars + cost > characterBudget) {
			break;
		}
		totalChars += cost;
		rows.push(row);
	}
	return {
		headers,
		rows,
		hiddenColumns: rawHeaders.length - headers.length,
		hiddenRows: rawRows.length - rows.length,
		totalChars,
	};
}

function fitRowToBudget(row: string[], characterBudget: number): string[] {
	if (characterBudget < row.length) {
		return [];
	}
	let remainingChars = characterBudget;
	return row.map((cell, index) => {
		const remainingCells = row.length - index - 1;
		const maxCellChars = Math.max(1, remainingChars - remainingCells);
		const fittedCell = truncateSlackText(cell, maxCellChars);
		remainingChars -= Math.max(fittedCell.length, 1);
		return fittedCell;
	});
}

export function buildSlackTableBlocks(text: string): ReturnType<typeof cardToBlockKit> | null {
	const sanitized = stripAssistantTags(text);
	const children = createTextBlocks(sanitized);
	if (!children.some((child) => child.type === 'table')) {
		return null;
	}
	return cardToBlockKit(Card({ children }));
}

export function formatSlackMessageText(text: string): string {
	const sanitized = stripAssistantTags(text);
	return mdToMrkdwn(sanitized) || sanitized;
}

export function chunkSlackText(text: string, maxChars: number): string[] {
	if (maxChars < 1) {
		throw new Error('Slack text chunk size must be positive.');
	}
	const chunks: string[] = [];
	let remaining = text.trim();
	while (remaining.length > maxChars) {
		const breakAt = findSlackChunkBreak(remaining, maxChars);
		chunks.push(remaining.slice(0, breakAt).trimEnd());
		remaining = remaining.slice(breakAt).trimStart();
	}
	if (remaining) {
		chunks.push(remaining);
	}
	return chunks;
}

export function isRecoverableSlackPayloadError(error: unknown): boolean {
	return /msg_too_long|invalid_blocks?|invalid_(?:arguments?|form_data|json)|block.*(?:invalid|malformed|schema)|(?:invalid|malformed|schema).*block/i.test(
		slackErrorText(error),
	);
}

export const createImageBlock = (url: string): CardChild => {
	return Image({ url, alt: 'image' });
};

export function formatClarificationText(question: string, options?: string[]): string {
	if (!options || options.length === 0) {
		return question;
	}
	const optionLines = options.map((opt, i) => `${i + 1}. ${opt}`).join('\n');
	return `${question}\n${optionLines}`;
}

/** Interactive maps cannot be rendered by messaging providers, so they degrade to a link to the nao chat. */
export const createMapLinkCard = (title: string, chatUrl: string): CardChild[] => [
	CardText(`🗺️ **${title}**`),
	Actions([LinkButton({ url: chatUrl, label: 'View interactive map in nao' })]),
];

export const createTelegramMapLinkCard = (title: string, chatUrl: string): CardChild[] => [
	createPlainTextBlock(`🗺️ ${title}`),
	Actions([LinkButton({ url: chatUrl, label: 'View interactive map in nao' })]),
];

/** WhatsApp has no interactive card UI, so a map degrades to a plain-text link to the nao chat. */
export const createWhatsappMapLink = (title: string, chatUrl: string): string =>
	`🗺️ ${title}\nView interactive map in nao: ${chatUrl}`;

/** Renders an interactive map tool call to a static PNG. */
export async function renderMapImage(
	part: Extract<UIMessagePart, { type: 'tool-display_map' }>,
	state: StreamState,
	projectId: string,
	logContext: Record<string, unknown> = {},
): Promise<Buffer | null> {
	if (part.state !== 'output-available') {
		return null;
	}
	const sqlOutput = state.sqlOutputs.get(part.input.query_id);
	if (!sqlOutput) {
		return null;
	}
	try {
		const customBoundaries = await projectQueries.getCustomBoundaries(projectId);
		return await generateMapImage({ config: part.input, rows: sqlOutput.rows, customBoundaries });
	} catch (error) {
		logger.error(`Map image generation failed: ${String(error)}`, {
			source: 'system',
			context: { projectId, ...logContext },
		});
		return null;
	}
}

export const createPlainTextBlock = (text: string): CardChild => {
	return CardText(stripMarkdown(text));
};

type MarkdownSegment = { type: 'text'; text: string } | { type: 'table'; headers: string[]; rows: string[][] };

const FENCE_REGEX = /^\s*(```|~~~)/;
const SEPARATOR_CELL_REGEX = /^:?-+:?$/;

function splitMarkdownSegments(text: string): MarkdownSegment[] {
	const lines = text.split('\n');
	const segments: MarkdownSegment[] = [];
	let textLines: string[] = [];
	let openFenceChar: string | null = null;

	const flushText = (): void => {
		if (textLines.length > 0) {
			segments.push({ type: 'text', text: textLines.join('\n') });
			textLines = [];
		}
	};

	for (let i = 0; i < lines.length; i++) {
		const line = lines[i];
		const fenceChar = fenceMarker(line);
		if (fenceChar) {
			if (openFenceChar === null) {
				openFenceChar = fenceChar;
			} else if (fenceChar === openFenceChar) {
				openFenceChar = null;
			}
			textLines.push(line);
			continue;
		}
		const table = openFenceChar !== null ? null : parseTableAt(lines, i);
		if (table) {
			flushText();
			segments.push(table.segment);
			i = table.nextIndex - 1;
			continue;
		}
		textLines.push(line);
	}

	flushText();
	return segments;
}

function fenceMarker(line: string): string | null {
	const match = FENCE_REGEX.exec(line);
	return match ? match[1][0] : null;
}

function parseTableAt(lines: string[], start: number): { segment: MarkdownSegment; nextIndex: number } | null {
	const headerLine = lines[start];
	if (!headerLine.includes('|') || start + 1 >= lines.length) {
		return null;
	}
	const headers = splitTableRow(headerLine);
	if (tableSeparatorColumns(lines[start + 1]) !== headers.length) {
		return null;
	}

	const rows: string[][] = [];
	let index = start + 2;
	for (; index < lines.length; index++) {
		const line = lines[index];
		if (line.trim() === '' || !line.includes('|') || FENCE_REGEX.test(line)) {
			break;
		}
		rows.push(normalizeRow(splitTableRow(line), headers.length));
	}

	return {
		segment: {
			type: 'table',
			headers: headers.map(cleanTableCell),
			rows: rows.map((row) => row.map(cleanTableCell)),
		},
		nextIndex: index,
	};
}

function tableSeparatorColumns(line: string): number {
	if (!line.includes('-')) {
		return -1;
	}
	const cells = splitTableRow(line);
	if (cells.length === 0 || cells.some((cell) => !SEPARATOR_CELL_REGEX.test(cell))) {
		return -1;
	}
	return cells.length;
}

function splitTableRow(line: string): string[] {
	let content = line.trim();
	if (content.startsWith('|')) {
		content = content.slice(1);
	}
	if (content.endsWith('|') && !content.endsWith('\\|')) {
		content = content.slice(0, -1);
	}

	const cells: string[] = [];
	let current = '';
	for (let i = 0; i < content.length; i++) {
		const char = content[i];
		if (char === '\\' && content[i + 1] === '|') {
			current += '|';
			i++;
			continue;
		}
		if (char === '|') {
			cells.push(current.trim());
			current = '';
			continue;
		}
		current += char;
	}
	cells.push(current.trim());
	return cells;
}

function normalizeRow(cells: string[], length: number): string[] {
	const row = cells.slice(0, length);
	while (row.length < length) {
		row.push('');
	}
	return row;
}

function cleanTableCell(cell: string): string {
	return cell
		.replace(/`([^`]+)`/g, '$1')
		.replace(/\*\*(.+?)\*\*/g, '$1')
		.replace(/__(.+?)__/g, '$1')
		.replace(/\*(.+?)\*/g, '$1')
		.replace(/~~(.+?)~~/g, '$1')
		.replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
		.replace(/<br\s*\/?>/gi, ' ')
		.trim();
}

function findSlackChunkBreak(text: string, maxChars: number): number {
	const minimumBreak = Math.floor(maxChars / 2);
	for (const separator of ['\n\n', '\n', ' ']) {
		const breakAt = text.lastIndexOf(separator, maxChars - separator.length);
		if (breakAt >= minimumBreak) {
			return breakAt + separator.length;
		}
	}
	return maxChars;
}

function truncateSlackText(text: string, maxChars: number): string {
	if (text.length <= maxChars) {
		return text;
	}
	if (maxChars === 1) {
		return '…';
	}
	return `${text.slice(0, maxChars - 1).trimEnd()}…`;
}

function slackErrorText(error: unknown): string {
	const values: unknown[] = [error];
	if (error && typeof error === 'object') {
		const record = error as Record<string, unknown>;
		values.push(record.message, record.code, record.error);
		for (const nestedKey of ['data', 'body', 'response']) {
			const nested = record[nestedKey];
			if (nested && typeof nested === 'object') {
				const nestedRecord = nested as Record<string, unknown>;
				values.push(nestedRecord.error, nestedRecord.message, nestedRecord.code);
			}
		}
	}
	return values
		.filter((value) => value !== undefined)
		.map(String)
		.join(' ');
}

function mdToMrkdwn(text: string): string {
	// Split on fenced and inline code spans so we never mutate literal content
	const parts = text.split(/(```[\s\S]*?```|~~~[\s\S]*?~~~|`[^`\n]+`)/);
	return parts
		.map((part, i) => {
			if (i % 2 === 1) {
				return part;
			}
			return part
				.replace(/^#{1,6}\s+(.+)$/gm, '*$1*')
				.replace(/\*\*(.+?)\*\*/g, '*$1*')
				.replace(/\*\*\s*\*\*/g, '')
				.replace(/^\*\*$/gm, '')
				.replace(/\*\*(?!\S)/g, '');
		})
		.join('');
}

function stripMarkdown(text: string): string {
	const newtext = text
		.replace(/```[\s\S]*?```/g, (m) => m.slice(3, -3).trim())
		.replace(/`([^`\n]+)`/g, '$1')
		.replace(/^#{1,6}\s+/gm, '')
		.replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
		.replace(/\*\*(.+?)\*\*/g, '$1')
		.replace(/\*(.+?)\*/g, '$1')
		.replace(/__(.+?)__/g, '$1')
		.replace(/_(.+?)_/g, '$1')
		.replace(/~~(.+?)~~/g, '$1')
		.replace(/<\/?[a-zA-Z][^>]*>/g, '');
	// eslint-disable-next-line no-useless-escape
	return newtext.replace(/([_*`\[])/g, '\\$1');
}

export function formatMessagingError(error: unknown): string {
	if (error instanceof BudgetExceededError) {
		return `🚦 ${error.message}`;
	}
	const detail = error instanceof Error ? error.message : 'Unknown error';
	return `❌ An error occurred while processing your message. ${detail}.`;
}
