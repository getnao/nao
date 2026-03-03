import type { CardChild, CardElement, ModalElement } from 'chat';
import { Actions, Button, Card, CardText, Image, LinkButton } from 'chat';

import { ToolCallEntry } from '../types/slack';

const TOOL_LIVE_LABELS: Record<string, (input: Record<string, string>) => string> = {
	'tool-read': (input) => `_reading **${input['file_path'] ?? '...'}**_`,
	'tool-search': (input) => `_searching **${input['pattern'] ?? '...'}**_`,
	'tool-grep': (input) => `_grepping **${input['pattern'] ?? '...'}**_`,
	'tool-list': (input) => `_listing **${input['path'] ?? '...'}**_`,
	'tool-execute_sql': (input) => `_executing **${input['query'] ?? 'SQL query'}**_`,
	'tool-display_chart': (input) => `_displaying **${input['title'] ?? 'chart'}**_`,
};

const TOOL_SUMMARY_LABELS: Record<string, (count: number) => string> = {
	'tool-read': (n) => `read **${n} ${n === 1 ? 'file' : 'files'}**`,
	'tool-search': (n) => `searched **${n} ${n === 1 ? 'pattern' : 'patterns'}**`,
	'tool-grep': (n) => `grepped **${n} ${n === 1 ? 'time' : 'times'}**`,
	'tool-list': (n) => `listed **${n} ${n === 1 ? 'path' : 'paths'}**`,
	'tool-execute_sql': (n) => `executed **${n} ${n === 1 ? 'query' : 'queries'}**`,
	'tool-display_chart': (n) => `displayed **${n} ${n === 1 ? 'chart' : 'charts'}**`,
};

export const createLiveToolCall = (toolGroup: Map<string, ToolCallEntry>): CardChild => {
	const lines = [...toolGroup.values()].map(
		(entry) => TOOL_LIVE_LABELS[entry.type]?.(entry.input) ?? `_${entry.type}_`,
	);
	return CardText(lines.join('\n'));
};

export const createSummaryToolCalls = (toolGroup: Map<string, ToolCallEntry>): CardChild => {
	const countByType = new Map<string, number>();
	for (const entry of toolGroup.values()) {
		countByType.set(entry.type, (countByType.get(entry.type) ?? 0) + 1);
	}
	const parts = [...countByType.entries()].map(([type, count]) => {
		return TOOL_SUMMARY_LABELS[type]?.(count) ?? `${type.replace('tool-', '')} ×${count}`;
	});
	return CardText(parts.join(' · '));
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

export const createCompletionCard = (chatUrl: string): CardElement =>
	Card({
		children: [
			Actions([
				LinkButton({ url: chatUrl, label: 'Open in nao' }),
				Button({ id: 'feedback_positive', label: '👍' }),
				Button({ id: 'feedback_negative', label: '👎' }),
			]),
		],
	});

export const createTextBlock = (text: string): CardChild => {
	return CardText(text);
};

export const createImageBlock = (url: string): CardChild => {
	return Image({ url, alt: 'image' });
};

export const escapeCsvCell = (value: unknown): string => {
	const str = value === null || value === undefined ? '' : String(value);
	const sanitized = /^[=+\-@]/.test(str) ? `'${str}` : str;
	return /[,"\n]/.test(sanitized) ? `"${sanitized.replace(/"/g, '""')}"` : sanitized;
};
