import type { ModelMessage } from 'ai';
import { describe, expect, it } from 'vitest';

import { sanitizeToolCallIds, toProviderSafeToolCallId } from '../src/utils/model-message';

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
