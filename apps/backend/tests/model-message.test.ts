import type { ModelMessage } from 'ai';
import { describe, expect, it } from 'vitest';

import { sanitizeToolCallIds, stripReasoningParts, toProviderSafeToolCallId } from '../src/utils/model-message';

const SAFE_PATTERN = /^[a-zA-Z0-9_-]+$/;
const NAMESPACED_ID = '3f0d9a3e-6f1a-4b8e-9d2c-1a2b3c4d5e6f:functions.get_automation_run_history:0';

describe('toProviderSafeToolCallId', () => {
	it('keeps provider-native ids untouched', () => {
		expect(toProviderSafeToolCallId('toolu_01A09q90qw90lq917835lq9')).toBe('toolu_01A09q90qw90lq917835lq9');
		expect(toProviderSafeToolCallId('call_HFHTpQqWxnN7Y5Nr7L1MTGZD')).toBe('call_HFHTpQqWxnN7Y5Nr7L1MTGZD');
	});

	it('replaces characters rejected by Anthropic', () => {
		const safeId = toProviderSafeToolCallId('functions.execute_sql:0');
		expect(safeId).toMatch(SAFE_PATTERN);
		expect(safeId.startsWith('functions_execute_sql_0_')).toBe(true);
	});

	it('caps ids namespaced with a message id to the OpenAI limit', () => {
		expect(NAMESPACED_ID).toHaveLength(75);
		const safeId = toProviderSafeToolCallId(NAMESPACED_ID);
		expect(safeId.length).toBeLessThanOrEqual(64);
		expect(safeId).toMatch(SAFE_PATTERN);
	});

	it('keeps distinct namespaced ids distinct after truncation', () => {
		const other = NAMESPACED_ID.replace('3f0d9a3e', '9e8d7c6b');
		expect(toProviderSafeToolCallId(NAMESPACED_ID)).not.toBe(toProviderSafeToolCallId(other));
	});

	it('is deterministic', () => {
		expect(toProviderSafeToolCallId(NAMESPACED_ID)).toBe(toProviderSafeToolCallId(NAMESPACED_ID));
	});
});

describe('sanitizeToolCallIds', () => {
	it('rewrites the call and its result with the same id', () => {
		const messages: ModelMessage[] = [
			{ role: 'user', content: 'hello' },
			{
				role: 'assistant',
				content: [
					{ type: 'tool-call', toolCallId: NAMESPACED_ID, toolName: 'get_automation_run_history', input: {} },
				],
			},
			{
				role: 'tool',
				content: [
					{
						type: 'tool-result',
						toolCallId: NAMESPACED_ID,
						toolName: 'get_automation_run_history',
						output: { type: 'json', value: { runs: [] } },
					},
				],
			},
		];

		const [user, assistant, tool] = sanitizeToolCallIds(messages);
		const callId = (assistant.content[0] as { toolCallId: string }).toolCallId;
		const resultId = (tool.content[0] as { toolCallId: string }).toolCallId;

		expect(user).toEqual(messages[0]);
		expect(callId).toMatch(SAFE_PATTERN);
		expect(callId.length).toBeLessThanOrEqual(64);
		expect(resultId).toBe(callId);
	});
});

describe('stripReasoningParts', () => {
	it('removes reasoning parts from a mixed assistant turn and keeps the tool call', () => {
		const messages: ModelMessage[] = [
			{ role: 'user', content: 'show me revenue by month' },
			{
				role: 'assistant',
				content: [
					{ type: 'reasoning', text: 'picking the right SQL' },
					{ type: 'tool-call', toolCallId: 'call_1', toolName: 'execute_sql', input: { sql: 'SELECT 1' } },
				],
			},
			{
				role: 'tool',
				content: [
					{
						type: 'tool-result',
						toolCallId: 'call_1',
						toolName: 'execute_sql',
						output: { type: 'json', value: { rows: [] } },
					},
				],
			},
		];

		const stripped = stripReasoningParts(messages);
		const assistantParts = stripped[1].content as { type: string }[];

		expect(assistantParts).toHaveLength(1);
		expect(assistantParts[0].type).toBe('tool-call');
		expect(stripped[0]).toBe(messages[0]);
		expect(stripped[2]).toBe(messages[2]);
	});

	it('replaces a thinking-only assistant turn with a text placeholder so the message stays non-empty', () => {
		const messages: ModelMessage[] = [
			{ role: 'user', content: 'what next?' },
			{ role: 'assistant', content: [{ type: 'reasoning', text: 'just thinking' }] },
		];

		const stripped = stripReasoningParts(messages);
		const parts = stripped[1].content as { type: string; text?: string }[];

		expect(parts).toHaveLength(1);
		expect(parts[0]).toEqual({ type: 'text', text: '[Reasoning omitted]' });
	});

	it('leaves assistant messages without reasoning untouched', () => {
		const messages: ModelMessage[] = [
			{ role: 'user', content: 'hi' },
			{ role: 'assistant', content: [{ type: 'text', text: 'hello' }] },
		];

		const stripped = stripReasoningParts(messages);
		expect(stripped[0]).toBe(messages[0]);
		expect(stripped[1]).toBe(messages[1]);
	});

	it('leaves string-content assistant messages untouched', () => {
		const messages: ModelMessage[] = [
			{ role: 'user', content: 'hi' },
			{ role: 'assistant', content: 'hello' },
		];

		const stripped = stripReasoningParts(messages);
		expect(stripped[1]).toBe(messages[1]);
	});

	it('replaces an already-empty assistant content array with the placeholder so the provider does not reject the request', () => {
		const messages: ModelMessage[] = [
			{ role: 'user', content: 'hi' },
			{ role: 'assistant', content: [] },
		];

		const stripped = stripReasoningParts(messages);
		const parts = stripped[1].content as { type: string; text?: string }[];

		expect(parts).toHaveLength(1);
		expect(parts[0]).toEqual({ type: 'text', text: '[Reasoning omitted]' });
	});

	it('does not strip reasoning parts from user or tool roles', () => {
		const messages: ModelMessage[] = [
			{ role: 'user', content: [{ type: 'text', text: 'q' }] },
			{
				role: 'assistant',
				content: [
					{ type: 'reasoning', text: 't' },
					{ type: 'text', text: 'a' },
				],
			},
		];

		const stripped = stripReasoningParts(messages);
		expect(stripped[0]).toBe(messages[0]);
		expect((stripped[1].content as { type: string }[]).map((p) => p.type)).toEqual(['text']);
	});
});
