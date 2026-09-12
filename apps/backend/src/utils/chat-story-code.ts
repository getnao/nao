import { buildStoryChartBlock, buildStoryTableBlock } from '@nao/shared';
import { displayChart } from '@nao/shared/tools';

import type { UIMessage, UIMessagePart, UIToolPart } from '../types/chat';

export interface ChatStoryCodeOptions {
	includeErrors?: boolean;
	/** Include `execute_sql` queries in the output. On by default. */
	includeSql?: boolean;
	/** Include `execute_python` code (and its output) in the output. On by default. */
	includePython?: boolean;
}

export interface ChatStoryMetadata {
	title: string;
	createdAt?: number;
	updatedAt?: number;
}

const BLOCK_SEPARATOR = '\n\n';
const TURN_SEPARATOR = '\n\n---\n\n';

/**
 * Renders a chat conversation as story "code" (markdown interleaved with
 * `<chart>` / `<table>` blocks) so it can flow through the same server-side
 * rendering pipeline used for stories — charts are drawn as real SVGs rather
 * than dumped as JSON.
 */
export function buildChatStoryCode(
	messages: UIMessage[],
	metadata: ChatStoryMetadata,
	options: ChatStoryCodeOptions = {},
): string {
	const turns = messages
		.map((message) => renderTurn(message, options))
		.filter((turn): turn is string => Boolean(turn));
	return [renderHeader(metadata), ...turns].join(TURN_SEPARATOR);
}

function renderHeader(metadata: ChatStoryMetadata): string {
	const title = metadata.title?.trim() || 'nao chat';
	const details: string[] = [];
	if (metadata.createdAt) {
		details.push(`Created ${formatTimestamp(metadata.createdAt)}`);
	}
	if (metadata.updatedAt) {
		details.push(`Last updated ${formatTimestamp(metadata.updatedAt)}`);
	}
	details.push(`Exported ${formatTimestamp(Date.now())}`);
	return `# ${title}${BLOCK_SEPARATOR}${details.join(' · ')}`;
}

function renderTurn(message: UIMessage, options: ChatStoryCodeOptions): string | null {
	const blocks = message.parts
		.map((part) => renderPart(part, options))
		.filter((block): block is string => Boolean(block));
	if (blocks.length === 0) {
		return null;
	}
	const label = message.role === 'user' ? '**You**' : '**nao**';
	return [label, ...blocks].join(BLOCK_SEPARATOR);
}

function renderPart(part: UIMessagePart, options: ChatStoryCodeOptions): string | null {
	switch (part.type) {
		case 'text':
			return part.text.trim() ? part.text : null;
		case 'tool-execute_sql':
			return renderExecuteSql(part, options);
		case 'tool-display_chart':
			return renderDisplayChart(part, options);
		case 'tool-execute_python':
			return renderExecutePython(part, options);
		default:
			return null;
	}
}

function renderExecuteSql(part: UIToolPart<'execute_sql'>, options: ChatStoryCodeOptions): string | null {
	if (options.includeSql === false || shouldSkipErrored(part, options)) {
		return null;
	}
	const sql = part.input?.sql_query?.trim();
	if (!sql) {
		return null;
	}
	const name = part.input?.name?.trim();
	const heading = name ? `**SQL — ${name}**` : '**SQL**';
	return [heading, codeBlock('sql', sql)].join(BLOCK_SEPARATOR);
}

function renderDisplayChart(part: UIToolPart<'display_chart'>, options: ChatStoryCodeOptions): string | null {
	const input = part.input as displayChart.Input | undefined;
	if (shouldSkipErrored(part, options) || !input || !input.query_id) {
		return null;
	}
	if (displayChart.isTableInput(input)) {
		return buildStoryTableBlock({
			query_id: input.query_id,
			title: input.title,
			conditional_formats: input.conditional_formats,
		});
	}
	if (!input.series?.length) {
		return null;
	}
	return buildStoryChartBlock(input);
}

function renderExecutePython(part: UIToolPart<'execute_python'>, options: ChatStoryCodeOptions): string | null {
	if (options.includePython === false || shouldSkipErrored(part, options)) {
		return null;
	}
	const code = part.input?.code?.trim();
	if (!code) {
		return null;
	}
	const blocks = ['**Python**', codeBlock('python', code)];
	const output = part.output?.output;
	if (output !== undefined && output !== null) {
		const formatted =
			typeof output === 'object' ? codeBlock('json', stringify(output)) : codeBlock('', String(output));
		blocks.push(`Output:${BLOCK_SEPARATOR}${formatted}`);
	}
	return blocks.join(BLOCK_SEPARATOR);
}

function shouldSkipErrored(part: { state: string; errorText?: string }, options: ChatStoryCodeOptions): boolean {
	return !options.includeErrors && (part.state === 'output-error' || Boolean(part.errorText));
}

function codeBlock(language: string, content: string): string {
	return `\`\`\`${language}\n${content}\n\`\`\``;
}

function stringify(value: unknown): string {
	return JSON.stringify(value, null, 2);
}

function formatTimestamp(ms: number): string {
	return new Date(ms).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' });
}
