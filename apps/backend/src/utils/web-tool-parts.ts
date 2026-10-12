import type { LlmProvider } from '@nao/shared/types';
import { getToolName, isToolUIPart } from 'ai';

import type { UIMessage, UIMessagePart, UIToolPart } from '../types/chat';

const WEB_TOOL_NAMES = new Set(['web_search', 'web_fetch']);
const TRACE_FIELDS = new Set(['query', 'url']);

/**
 * Web search and fetch run inside the provider, which stores calls and results in its own format
 * (OpenAI returns `{ action, sources }`, Anthropic an array of encrypted results). A provider rejects
 * results produced by another one, so when the chat switches provider those parts are replaced by a
 * plain-text trace of what was searched and which pages were found.
 */
export function replaceForeignWebToolParts(messages: UIMessage[], provider: LlmProvider): UIMessage[] {
	return messages.map((message) => {
		if (message.role !== 'assistant' || !message.llmProvider || message.llmProvider === provider) {
			return message;
		}
		const hasForeignWebTool = message.parts.some(isWebToolPart);
		if (!hasForeignWebTool) {
			return message;
		}
		const parts = message.parts.map((part) => {
			return isWebToolPart(part) ? toWebToolTrace(part) : part;
		});
		return { ...message, parts };
	});
}

function isWebToolPart(part: UIMessagePart): part is UIToolPart {
	return isToolUIPart(part) && WEB_TOOL_NAMES.has(getToolName(part));
}

function toWebToolTrace(part: UIToolPart): UIMessagePart {
	const toolName = getToolName(part);
	const lines = [`[${toolName} run by a previous model]`];
	if (part.state === 'output-error' && part.errorText) {
		lines.push(`Error: ${part.errorText}`);
	}
	const traces = collectTraceValues([part.input, 'output' in part ? part.output : undefined]);
	for (const [field, values] of traces) {
		lines.push(`${capitalize(field)}: ${values.join(', ')}`);
	}
	return { type: 'text', text: lines.join('\n') };
}

function collectTraceValues(value: unknown): Map<string, string[]> {
	const traces = new Map<string, string[]>();
	visit(value, traces);
	return traces;
}

function visit(value: unknown, traces: Map<string, string[]>): void {
	if (Array.isArray(value)) {
		value.forEach((item) => visit(item, traces));
		return;
	}
	if (!value || typeof value !== 'object') {
		return;
	}
	for (const [key, child] of Object.entries(value)) {
		if (TRACE_FIELDS.has(key) && typeof child === 'string') {
			const values = traces.get(key) ?? [];
			if (!values.includes(child)) {
				values.push(child);
			}
			traces.set(key, values);
			continue;
		}
		visit(child, traces);
	}
}

function capitalize(text: string): string {
	return text.charAt(0).toUpperCase() + text.slice(1);
}
