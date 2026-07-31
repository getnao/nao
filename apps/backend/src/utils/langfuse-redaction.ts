import type { Attributes, Context } from '@opentelemetry/api';
import type { ReadableSpan, Span, SpanProcessor } from '@opentelemetry/sdk-trace-node';

export const REDACTED_DATA_TOOL_NAMES: ReadonlySet<string> = new Set(['execute_sql', 'read_query_result']);
export const LANGFUSE_REDACTION_PLACEHOLDER = '[redacted]';

type JsonObject = Record<string, unknown>;
type JsonRedactor = (value: unknown) => boolean;

export function redactDataToolAttributes(attributes: Attributes): void {
	redactToolSpanAttributes(attributes);
	redactJsonAttribute(attributes, 'ai.prompt.messages', redactMessages);
	redactJsonAttribute(attributes, 'ai.prompt', redactPrompt);
	redactJsonAttribute(attributes, 'ai.response.toolCalls', redactResponseToolCalls);
}

export class DataToolRedactingSpanProcessor implements SpanProcessor {
	constructor(private readonly delegate: SpanProcessor) {}

	onStart(span: Span, parentContext: Context): void {
		this.delegate.onStart(span, parentContext);
	}

	onEnd(span: ReadableSpan): void {
		redactDataToolAttributes(span.attributes);
		redactToolSpanExceptions(span);
		this.delegate.onEnd(span);
	}

	forceFlush(): Promise<void> {
		return this.delegate.forceFlush();
	}

	shutdown(): Promise<void> {
		return this.delegate.shutdown();
	}
}

function redactToolSpanAttributes(attributes: Attributes): void {
	if (!isRedactedToolName(attributes['ai.toolCall.name'])) {
		return;
	}

	redactAttributeIfPresent(attributes, 'ai.toolCall.args');
	redactAttributeIfPresent(attributes, 'ai.toolCall.result');
}

function redactPrompt(value: unknown): boolean {
	if (!isJsonObject(value)) {
		return false;
	}

	return redactMessages(value.messages);
}

function redactMessages(value: unknown): boolean {
	if (!Array.isArray(value)) {
		return false;
	}

	let wasRedacted = false;
	for (const message of value) {
		if (!isJsonObject(message) || !Array.isArray(message.content)) {
			continue;
		}

		for (const part of message.content) {
			wasRedacted = redactMessagePart(part) || wasRedacted;
		}
	}

	return wasRedacted;
}

function redactMessagePart(value: unknown): boolean {
	if (!isJsonObject(value) || !isRedactedToolName(value.toolName)) {
		return false;
	}

	if (value.type === 'tool-call') {
		return redactToolInput(value);
	}

	if (value.type === 'tool-result') {
		return redactToolOutput(value);
	}

	return false;
}

function redactResponseToolCalls(value: unknown): boolean {
	if (!Array.isArray(value)) {
		return false;
	}

	let wasRedacted = false;
	for (const toolCall of value) {
		if (isJsonObject(toolCall) && isRedactedToolName(toolCall.toolName)) {
			wasRedacted = redactToolInput(toolCall) || wasRedacted;
		}
	}

	return wasRedacted;
}

function redactToolInput(toolCall: JsonObject): boolean {
	let wasRedacted = false;

	if (hasOwn(toolCall, 'input')) {
		toolCall.input = LANGFUSE_REDACTION_PLACEHOLDER;
		wasRedacted = true;
	}
	if (hasOwn(toolCall, 'args')) {
		toolCall.args = LANGFUSE_REDACTION_PLACEHOLDER;
		wasRedacted = true;
	}

	return wasRedacted;
}

function redactToolOutput(toolResult: JsonObject): boolean {
	let wasRedacted = false;

	if (hasOwn(toolResult, 'output')) {
		toolResult.output = {
			type: 'text',
			value: LANGFUSE_REDACTION_PLACEHOLDER,
		};
		wasRedacted = true;
	}
	if (hasOwn(toolResult, 'result')) {
		toolResult.result = LANGFUSE_REDACTION_PLACEHOLDER;
		wasRedacted = true;
	}

	return wasRedacted;
}

function redactJsonAttribute(attributes: Attributes, attributeName: string, redact: JsonRedactor): void {
	const rawValue = attributes[attributeName];
	if (typeof rawValue !== 'string') {
		return;
	}

	try {
		const value = JSON.parse(rawValue) as unknown;
		if (redact(value)) {
			attributes[attributeName] = JSON.stringify(value);
		}
	} catch {
		if (containsRedactedToolName(rawValue)) {
			attributes[attributeName] = LANGFUSE_REDACTION_PLACEHOLDER;
		}
	}
}

function redactToolSpanExceptions(span: ReadableSpan): void {
	if (!isRedactedToolName(span.attributes['ai.toolCall.name'])) {
		return;
	}

	for (const event of span.events) {
		if (!event.attributes) {
			continue;
		}

		redactAttributeIfPresent(event.attributes, 'exception.message');
		redactAttributeIfPresent(event.attributes, 'exception.stacktrace');
	}
}

function redactAttributeIfPresent(attributes: Attributes, attributeName: string): void {
	if (hasOwn(attributes, attributeName)) {
		attributes[attributeName] = LANGFUSE_REDACTION_PLACEHOLDER;
	}
}

function containsRedactedToolName(value: string): boolean {
	for (const toolName of REDACTED_DATA_TOOL_NAMES) {
		if (value.includes(toolName)) {
			return true;
		}
	}

	return false;
}

function isRedactedToolName(value: unknown): value is string {
	return typeof value === 'string' && REDACTED_DATA_TOOL_NAMES.has(value);
}

function isJsonObject(value: unknown): value is JsonObject {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasOwn(value: object, key: string): boolean {
	return Object.prototype.hasOwnProperty.call(value, key);
}
