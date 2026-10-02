import type { ModelMessage } from 'ai';
import { describe, expect, it } from 'vitest';

import {
	sanitizeToolCallIds,
	sanitizeToolDefinitionNames,
	sanitizeToolNames,
	toProviderSafeToolCallId,
	toProviderSafeToolName,
} from '../src/utils/model-message';

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

describe('toProviderSafeToolName', () => {
	it('keeps built-in tool names untouched', () => {
		expect(toProviderSafeToolName('execute_sql')).toBe('execute_sql');
		expect(toProviderSafeToolName('display_chart')).toBe('display_chart');
	});

	it('rewrites MCP tool names containing characters Anthropic / OpenAI reject', () => {
		const safeName = toProviderSafeToolName('my.server__list-dashboards');
		expect(safeName).toMatch(SAFE_PATTERN);
		expect(safeName.startsWith('my_server__list-dashboards_')).toBe(true);
	});

	it('caps overlong tool names to the provider limit', () => {
		const long = 'a'.repeat(80) + '.suffix';
		const safeName = toProviderSafeToolName(long);
		expect(safeName.length).toBeLessThanOrEqual(64);
		expect(safeName).toMatch(SAFE_PATTERN);
	});

	it('is deterministic so a tool-call and its tool-result map to the same name', () => {
		const input = 'namespace.one.two.three__some.tool';
		expect(toProviderSafeToolName(input)).toBe(toProviderSafeToolName(input));
	});

	it('keeps distinct original names distinct after sanitization', () => {
		expect(toProviderSafeToolName('a.b')).not.toBe(toProviderSafeToolName('a.c'));
	});
});

describe('sanitizeToolDefinitionNames', () => {
	it('rewrites keys so a tool offered to the provider matches the sanitized name in replayed history', () => {
		const dirtyName = 'metabase.local__list-dashboards';
		const tool = { execute: () => 'ok' };
		const safeTools = sanitizeToolDefinitionNames({ [dirtyName]: tool, execute_sql: tool });

		expect(safeTools.execute_sql).toBe(tool);
		expect(safeTools[dirtyName]).toBeUndefined();
		expect(safeTools[toProviderSafeToolName(dirtyName)]).toBe(tool);
	});

	it('stores a tool literally named __proto__ as an own property, not on the prototype', () => {
		const tool = { execute: () => 'proto' };
		// Object literal syntax `{ __proto__: X }` sets the prototype, not a property named
		// __proto__, so use fromEntries to actually create a property called "__proto__".
		const input = Object.fromEntries([['__proto__', tool]]);
		const safeTools = sanitizeToolDefinitionNames(input);

		expect(Object.prototype.hasOwnProperty.call(safeTools, '__proto__')).toBe(true);
		expect(safeTools['__proto__']).toBe(tool);
	});

	it('throws when two originals sanitize to the same key so one cannot silently shadow the other', () => {
		const dirty = 'a.';
		const colliding = toProviderSafeToolName(dirty);
		const tool = { execute: () => 'ok' };
		expect(() => sanitizeToolDefinitionNames({ [dirty]: tool, [colliding]: tool })).toThrow(/Tool name collision/);
	});
});

describe('sanitizeToolNames', () => {
	it('rewrites the call and its result with the same name', () => {
		const dirtyName = 'metabase.local__list-dashboards';
		const messages: ModelMessage[] = [
			{ role: 'user', content: 'hello' },
			{
				role: 'assistant',
				content: [{ type: 'tool-call', toolCallId: 'id1', toolName: dirtyName, input: {} }],
			},
			{
				role: 'tool',
				content: [
					{
						type: 'tool-result',
						toolCallId: 'id1',
						toolName: dirtyName,
						output: { type: 'json', value: { dashboards: [] } },
					},
				],
			},
		];

		const [, assistant, tool] = sanitizeToolNames(messages);
		const callName = (assistant.content[0] as { toolName: string }).toolName;
		const resultName = (tool.content[0] as { toolName: string }).toolName;

		expect(callName).toMatch(SAFE_PATTERN);
		expect(callName.length).toBeLessThanOrEqual(64);
		expect(resultName).toBe(callName);
	});
});
