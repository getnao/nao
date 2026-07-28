import type { UIMessage, UIMessagePart, UIToolPart } from '@nao/backend/chat';

const BLOCK_SEPARATOR = '\n\n';
const MESSAGE_SEPARATOR = '\n\n---\n\n';

export interface SerializeOptions {
	/** Include tool error text in the output. Off by default. */
	includeErrors?: boolean;
	/** Include `execute_sql` queries in the output. On by default. */
	includeSql?: boolean;
	/** Include `execute_python` code (and its output) in the output. On by default. */
	includePython?: boolean;
}

export interface ChatMetadata {
	title?: string;
	createdAt?: number;
	updatedAt?: number;
}

/**
 * Serializes a message to markdown: text parts plus the key tool calls (SQL
 * query, chart settings, Python code and output), kept in part order so the
 * result reads like the rendered conversation.
 */
export const getMessageMarkdown = (message: UIMessage, options: SerializeOptions = {}): string => {
	const blocks = message.parts
		.map((part) => serializePart(part, options))
		.filter((block): block is string => Boolean(block));
	return blocks.join(BLOCK_SEPARATOR);
};

/** Serializes a full chat to markdown, one section per message, with an optional metadata header. */
export const getChatMarkdown = (
	messages: UIMessage[],
	options: SerializeOptions = {},
	metadata?: ChatMetadata,
): string => {
	const body = messages
		.map((message) => serializeMessage(message, options))
		.filter((section): section is string => Boolean(section))
		.join(MESSAGE_SEPARATOR);
	const header = metadata ? serializeMetadata(metadata) : null;
	return header ? [header, body].filter(Boolean).join(MESSAGE_SEPARATOR) : body;
};

function serializeMetadata(metadata: ChatMetadata): string {
	const lines = [`# ${metadata.title?.trim() || 'nao chat'}`];
	const details: string[] = [];
	if (metadata.createdAt) {
		details.push(`**Created:** ${formatTimestamp(metadata.createdAt)}`);
	}
	if (metadata.updatedAt) {
		details.push(`**Last updated:** ${formatTimestamp(metadata.updatedAt)}`);
	}
	details.push(`**Exported:** ${formatTimestamp(Date.now())}`);
	return [lines[0], details.join('  \n')].join(BLOCK_SEPARATOR);
}

function formatTimestamp(ms: number): string {
	return new Date(ms).toLocaleString(undefined, {
		dateStyle: 'medium',
		timeStyle: 'short',
	});
}

function serializeMessage(message: UIMessage, options: SerializeOptions): string | null {
	const body = getMessageMarkdown(message, options);
	if (!body) {
		return null;
	}
	const heading = message.role === 'user' ? '## User' : '## Assistant';
	return `${heading}${BLOCK_SEPARATOR}${body}`;
}

function serializePart(part: UIMessagePart, options: SerializeOptions): string | null {
	switch (part.type) {
		case 'text':
			return part.text.trim() ? part.text : null;
		case 'tool-execute_sql':
			return serializeExecuteSql(part, options);
		case 'tool-display_chart':
			return serializeDisplayChart(part, options);
		case 'tool-execute_python':
			return serializeExecutePython(part, options);
		default:
			return null;
	}
}

function serializeExecuteSql(part: UIToolPart<'execute_sql'>, options: SerializeOptions): string | null {
	if (options.includeSql === false || shouldSkipErrored(part, options)) {
		return null;
	}
	const sql = part.input?.sql_query?.trim();
	if (!sql) {
		return null;
	}
	const name = part.input?.name?.trim();
	const sections = [name ? `**SQL — ${name}**` : '**SQL**', codeBlock('sql', sql)];
	appendError(sections, part.errorText);
	return sections.join(BLOCK_SEPARATOR);
}

function serializeDisplayChart(part: UIToolPart<'display_chart'>, options: SerializeOptions): string | null {
	if (shouldSkipErrored(part, options) || !part.input) {
		return null;
	}
	const title = part.input.title?.trim();
	const sections = [title ? `**Chart — ${title}**` : '**Chart**', codeBlock('json', stringify(part.input))];
	appendError(sections, part.errorText);
	return sections.join(BLOCK_SEPARATOR);
}

function serializeExecutePython(part: UIToolPart<'execute_python'>, options: SerializeOptions): string | null {
	if (options.includePython === false || shouldSkipErrored(part, options)) {
		return null;
	}
	const code = part.input?.code?.trim();
	if (!code) {
		return null;
	}
	const sections = ['**Python**', codeBlock('python', code)];
	const output = part.output?.output;
	if (output !== undefined && output !== null) {
		sections.push(`Output:${BLOCK_SEPARATOR}${formatPythonOutput(output)}`);
	}
	appendError(sections, part.errorText);
	return sections.join(BLOCK_SEPARATOR);
}

function formatPythonOutput(value: unknown): string {
	return typeof value === 'object' ? codeBlock('json', stringify(value)) : codeBlock('', String(value));
}

/** When errors are excluded, a failed tool call is dropped entirely (input included). */
function shouldSkipErrored(part: { state: string; errorText?: string }, options: SerializeOptions): boolean {
	return !options.includeErrors && (part.state === 'output-error' || Boolean(part.errorText));
}

function appendError(sections: string[], errorText: string | undefined): void {
	if (errorText) {
		sections.push(`Error: ${errorText}`);
	}
}

function codeBlock(language: string, content: string): string {
	return `\`\`\`${language}\n${content}\n\`\`\``;
}

function stringify(value: unknown): string {
	return JSON.stringify(value, null, 2);
}
