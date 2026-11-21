import { getToolName, isToolUIPart } from 'ai';

import type { UIMessage } from '../types/chat';
import { truncateMiddle } from './utils';

const TOOL_INPUT_MAX_CHARS = 1_000;
const TOOL_OUTPUT_MAX_CHARS = 2_000;
const TRANSCRIPT_MAX_CHARS = 120_000;

/**
 * Each turn on the user's Claude starts a fresh Claude session, so the earlier messages of the chat,
 * whichever model answered them, are replayed as text.
 */
export function renderLocalAgentHistory(messages: UIMessage[]): string | null {
	const rendered = messages.map(renderMessage).filter((text) => text.length > 0);
	if (rendered.length === 0) {
		return null;
	}
	return truncateMiddle(rendered.join('\n\n'), TRANSCRIPT_MAX_CHARS, '\n\n[... earlier messages omitted ...]\n\n');
}

function renderMessage(message: UIMessage): string {
	const parts = message.parts.map(renderPart).filter((text) => text.length > 0);
	if (parts.length === 0) {
		return '';
	}
	return `<${message.role}>\n${parts.join('\n')}\n</${message.role}>`;
}

function renderPart(part: UIMessage['parts'][number]): string {
	if (part.type === 'text') {
		return part.text;
	}
	if (isToolUIPart(part)) {
		return renderToolPart(part);
	}
	return '';
}

function renderToolPart(part: Extract<UIMessage['parts'][number], { toolCallId: string }>): string {
	const call = `[tool ${getToolName(part)}] input: ${truncateMiddle(JSON.stringify(part.input) ?? '', TOOL_INPUT_MAX_CHARS)}`;
	if (part.state === 'output-available') {
		return `${call}\noutput: ${truncateMiddle(JSON.stringify(part.output) ?? '', TOOL_OUTPUT_MAX_CHARS)}`;
	}
	if (part.state === 'output-error') {
		return `${call}\nerror: ${part.errorText}`;
	}
	return call;
}
