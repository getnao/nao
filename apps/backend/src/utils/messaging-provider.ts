import { pluralize, TOOL_LABELS } from '@nao/shared';
import type { CardChild, CardElement, ModalElement } from 'chat';
import { Actions, Button, Card, CardText, Image, LinkButton } from 'chat';

import { ToolCallEntry } from '../types/messaging-provider';
import { BudgetExceededError } from './error';

export const EXCLUDED_TOOLS = ['tool-suggest_follow_ups', 'tool-display_chart'];

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
	return CardText(mdToMrkdwn(text));
};

export const createImageBlock = (url: string): CardChild => {
	return Image({ url, alt: 'image' });
};

export const createPlainTextBlock = (text: string): CardChild => {
	return CardText(stripMarkdown(text));
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

export const escapeCsvCell = (value: unknown): string => {
	const str = value === null || value === undefined ? '' : String(value);
	const sanitized = /^[=+\-@]/.test(str.trimStart()) ? `'${str}` : str;
	return /[,"\n]/.test(sanitized) ? `"${sanitized.replace(/"/g, '""')}"` : sanitized;
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

export function formatMessagingError(error: unknown): string {
	if (error instanceof BudgetExceededError) {
		return `🚦 ${error.message}`;
	}
	const detail = error instanceof Error ? error.message : 'Unknown error';
	return `❌ An error occurred while processing your message. ${detail}.`;
}
