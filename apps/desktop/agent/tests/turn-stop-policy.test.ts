// @vitest-environment node
import type { SDKMessage } from '@anthropic-ai/claude-agent-sdk';
import { describe, expect, it } from 'vitest';

import { TurnStopPolicy } from '../src/turn-stop-policy';

const FOLLOW_UPS = 'mcp__nao__suggest_follow_ups';

function assistant(id: string, content: object[], parentToolUseId: string | null = null): SDKMessage {
	return { type: 'assistant', parent_tool_use_id: parentToolUseId, message: { id, content } } as SDKMessage;
}

const toolUse = (id: string, name: string) => ({ type: 'tool_use', id, name, input: {} });

describe('TurnStopPolicy', () => {
	it('ends the turn when the follow-ups come with the written answer', () => {
		const policy = new TurnStopPolicy();
		policy.observe(assistant('msg_1', [{ type: 'text', text: 'There are 100 customers.' }]));
		policy.observe(assistant('msg_1', [toolUse('toolu_1', FOLLOW_UPS)]));

		expect(policy.endsTurn(FOLLOW_UPS, 'toolu_1')).toBe(true);
	});

	it('lets Claude write its answer after textless follow-ups, but only once', () => {
		const policy = new TurnStopPolicy();
		policy.observe(assistant('msg_1', [toolUse('toolu_1', FOLLOW_UPS)]));
		policy.observe(assistant('msg_2', [toolUse('toolu_2', FOLLOW_UPS)]));

		expect(policy.endsTurn(FOLLOW_UPS, 'toolu_1')).toBe(false);
		expect(policy.endsTurn(FOLLOW_UPS, 'toolu_2')).toBe(true);
	});

	it('does not count parallel follow-ups calls in one step as a retry', () => {
		const policy = new TurnStopPolicy();
		policy.observe(assistant('msg_1', [toolUse('toolu_1', FOLLOW_UPS), toolUse('toolu_2', FOLLOW_UPS)]));

		expect(policy.endsTurn(FOLLOW_UPS, 'toolu_1')).toBe(false);
		expect(policy.endsTurn(FOLLOW_UPS, 'toolu_2')).toBe(false);
	});

	it('ends the turn after a tool that hands back to the user', () => {
		const policy = new TurnStopPolicy();

		expect(policy.endsTurn('mcp__nao__clarification', 'toolu_1')).toBe(true);
		expect(policy.endsTurn('mcp__nao__request_warehouse_credentials', 'toolu_2')).toBe(true);
	});

	it('keeps going after other tools, and ignores text from subagents', () => {
		const policy = new TurnStopPolicy();
		policy.observe(
			assistant('msg_sub', [{ type: 'text', text: 'Done.' }, toolUse('toolu_1', FOLLOW_UPS)], 'toolu_0'),
		);

		expect(policy.endsTurn('mcp__nao__execute_sql', 'toolu_9')).toBe(false);
		expect(policy.endsTurn('suggest_follow_ups', 'toolu_8')).toBe(false);
		expect(policy.endsTurn(FOLLOW_UPS, 'toolu_1')).toBe(false);
	});
});
