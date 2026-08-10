import type { Attributes, Context } from '@opentelemetry/api';
import type { ReadableSpan, Span, SpanProcessor } from '@opentelemetry/sdk-trace-node';

const REDACTED_DATA_TOOL_NAMES = new Set(['execute_sql', 'read_query_result']);
const JSON_ATTRIBUTE_NAMES = ['ai.prompt', 'ai.prompt.messages', 'ai.response.toolCalls'];
const TOOL_PAYLOAD_KEYS = ['input', 'args', 'output', 'result'];
const TOOL_SPAN_PAYLOAD_KEYS = ['ai.toolCall.args', 'ai.toolCall.result'];
const EXCEPTION_DETAIL_KEYS = ['exception.message', 'exception.stacktrace'];
export const LANGFUSE_REDACTION_PLACEHOLDER = '[redacted]';

type JsonObject = Record<string, unknown>;

export function redactDataToolAttributes(attributes: Attributes): void {
	if (REDACTED_DATA_TOOL_NAMES.has(attributes['ai.toolCall.name'] as string)) {
		redactKeys(attributes, TOOL_SPAN_PAYLOAD_KEYS);
	}
	for (const attributeName of JSON_ATTRIBUTE_NAMES) {
		redactJsonAttribute(attributes, attributeName);
	}
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

function redactJsonAttribute(attributes: Attributes, attributeName: string): void {
	const rawValue = attributes[attributeName];
	if (typeof rawValue !== 'string') {
		return;
	}

	try {
		const value = JSON.parse(rawValue) as unknown;
		if (redactJsonValue(value)) {
			attributes[attributeName] = JSON.stringify(value);
		}
	} catch {
		if ([...REDACTED_DATA_TOOL_NAMES].some((toolName) => rawValue.includes(toolName))) {
			attributes[attributeName] = LANGFUSE_REDACTION_PLACEHOLDER;
		}
	}
}

function redactJsonValue(value: unknown): boolean {
	if (typeof value !== 'object' || value === null) {
		return false;
	}

	const object = value as JsonObject;
	let wasRedacted =
		!Array.isArray(value) &&
		REDACTED_DATA_TOOL_NAMES.has(object.toolName as string) &&
		redactKeys(object, TOOL_PAYLOAD_KEYS);
	for (const nestedValue of Array.isArray(value) ? value : Object.values(object)) {
		wasRedacted = redactJsonValue(nestedValue) || wasRedacted;
	}
	return wasRedacted;
}

function redactToolSpanExceptions(span: ReadableSpan): void {
	if (!REDACTED_DATA_TOOL_NAMES.has(span.attributes['ai.toolCall.name'] as string)) {
		return;
	}

	for (const event of span.events) {
		if (event.attributes) {
			redactKeys(event.attributes, EXCEPTION_DETAIL_KEYS);
		}
	}
}

function redactKeys(value: JsonObject, keys: string[]): boolean {
	let wasRedacted = false;
	for (const key of keys) {
		if (Object.hasOwn(value, key)) {
			value[key] = LANGFUSE_REDACTION_PLACEHOLDER;
			wasRedacted = true;
		}
	}
	return wasRedacted;
}
