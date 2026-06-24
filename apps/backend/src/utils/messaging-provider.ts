import { cardToBlockKit } from '@chat-adapter/slack';
import { CITATION_TAG_REGEX, pluralize, TOOL_LABELS } from '@nao/shared';
import type { CardChild, CardElement, ModalElement } from 'chat';
import { Actions, Button, Card, CardText, Image, LinkButton, Table } from 'chat';

import { ToolCallEntry } from '../types/messaging-provider';
import { BudgetExceededError } from './error';

export const EXCLUDED_TOOLS = ['tool-suggest_follow_ups', 'tool-display_chart', 'tool-clarification'];

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

export const createStopButtonCard = (): CardElement =>
	Card({
		children: [Actions([Button({ id: 'stop_generation', label: 'Stop Generation', style: 'primary' })])],
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

export const createCompletionCard = (chatUrl: string, vote?: 'up' | 'down'): CardElement =>
	Card({
		children: [
			Actions([
				LinkButton({ url: chatUrl, label: 'Open in nao' }),
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

export const createTextBlocks = (text: string): CardChild[] => {
	const blocks: CardChild[] = [];
	for (const segment of splitMarkdownSegments(text)) {
		if (segment.type === 'table') {
			blocks.push(Table({ headers: segment.headers, rows: segment.rows }));
			continue;
		}
		const rendered = mdToMrkdwn(segment.text).trim();
		if (rendered) {
			blocks.push(CardText(rendered));
		}
	}
	return blocks;
};

export function buildSlackTableBlocks(text: string): ReturnType<typeof cardToBlockKit> | null {
	const sanitized = text.replace(CITATION_TAG_REGEX, '');
	const children = createTextBlocks(sanitized);
	if (!children.some((child) => child.type === 'table')) {
		return null;
	}
	return cardToBlockKit(Card({ children }));
}

export function formatSlackMessageText(text: string): string {
	const sanitized = text.replace(CITATION_TAG_REGEX, '');
	return mdToMrkdwn(sanitized) || sanitized;
}

export const createImageBlock = (url: string): CardChild => {
	return Image({ url, alt: 'image' });
};

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
