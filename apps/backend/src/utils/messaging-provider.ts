import { pluralize, TOOL_LABELS } from '@nao/shared';
import type { CardChild, CardElement, ModalElement } from 'chat';
import { Actions, Button, Card, CardText, Image, LinkButton } from 'chat';

import { ToolCallEntry } from '../types/messaging-provider';

export const EXCLUDED_TOOLS = ['tool-suggest_follow_ups', 'tool-display_chart'];

const TOOL_LIVE_LABELS: Record<string, (input: Record<string, string>) => string> = {
	'tool-read': (input) => `_reading **${input['file_path'] ?? '...'}**_`,
	'tool-search': (input) => `_searching **${input['pattern'] ?? '...'}**_`,
	'tool-grep': (input) => `_grepping **${input['pattern'] ?? '...'}**_`,
	'tool-list': (input) => `_listing **${input['path'] ?? '...'}**_`,
	'tool-execute_sql': (input) => `_executing **${input['query'] ?? 'SQL query'}**_`,
};

export const createLiveToolCall = (toolGroup: Map<string, ToolCallEntry>): CardChild => {
	const lines = [...toolGroup.values()].map(
		(entry) => TOOL_LIVE_LABELS[entry.type]?.(entry.input) ?? `_${entry.type}_`,
	);
	return CardText(lines.join('\n\n'));
};

export const createSummaryToolCalls = (toolGroup: Map<string, ToolCallEntry>): CardChild => {
	const countByType = new Map<string, number>();
	for (const entry of toolGroup.values()) {
		countByType.set(entry.type, (countByType.get(entry.type) ?? 0) + 1);
	}
	const parts = [...countByType.entries()].map(([type, count]) => {
		const noun = TOOL_LABELS[type] ?? type.replace('tool-', '');
		return `**${count} ${pluralize(noun, count)}**`;
	});
	return CardText(`Explored ${parts.join(', ')}`);
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

export const createTextBlock = (text: string): CardChild => {
	return CardText(mdToMrkdwn(text));
};

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

export const createImageBlock = (url: string): CardChild => {
	return Image({ url, alt: 'image' });
};

export const escapeCsvCell = (value: unknown): string => {
	const str = value === null || value === undefined ? '' : String(value);
	const sanitized = /^[=+\-@]/.test(str.trimStart()) ? `'${str}` : str;
	return /[,"\n]/.test(sanitized) ? `"${sanitized.replace(/"/g, '""')}"` : sanitized;
};

export const createPlainTextBlock = (text: string): CardChild => {
	return CardText(stripMarkdown(text));
};

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
