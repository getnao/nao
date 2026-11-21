// @vitest-environment node
import type { SDKMessage } from '@anthropic-ai/claude-agent-sdk';
import { describe, expect, it } from 'vitest';

import { UIMessageTranslator } from '../src/ui-message-translator';

const sdk = (message: object) => message as SDKMessage;
const streamEvent = (event: object) => sdk({ type: 'stream_event', event, parent_tool_use_id: null });

const TOOL_CALL_ID = 'toolu_1';
const SQL_OUTPUT = { id: 'q1', columns: ['a'], data: [{ a: 1 }] };

function translateAll(messages: SDKMessage[]) {
	const translator = new UIMessageTranslator();
	return { chunks: messages.flatMap((message) => translator.translate(message)), translator };
}

function toolCallTurn(): SDKMessage[] {
	return [
		sdk({ type: 'system', subtype: 'init', model: 'claude-sonnet-5-5' }),
		streamEvent({ type: 'message_start', message: { id: 'msg_1' } }),
		streamEvent({
			type: 'content_block_start',
			index: 0,
			content_block: { type: 'tool_use', id: TOOL_CALL_ID, name: 'mcp__nao__execute_sql', input: {} },
		}),
		streamEvent({
			type: 'content_block_delta',
			index: 0,
			delta: { type: 'input_json_delta', partial_json: '{"sql' },
		}),
		streamEvent({ type: 'content_block_stop', index: 0 }),
		sdk({
			type: 'assistant',
			parent_tool_use_id: null,
			message: {
				id: 'msg_1',
				content: [
					{ type: 'tool_use', id: TOOL_CALL_ID, name: 'mcp__nao__execute_sql', input: { sql: 'select 1' } },
				],
			},
		}),
		streamEvent({ type: 'message_stop' }),
		sdk({
			type: 'user',
			parent_tool_use_id: null,
			message: {
				role: 'user',
				content: [{ type: 'tool_result', tool_use_id: TOOL_CALL_ID, content: 'compact text' }],
			},
			tool_use_result: { content: [{ type: 'text', text: 'compact text' }], _meta: { 'nao/output': SQL_OUTPUT } },
		}),
		streamEvent({ type: 'message_start', message: { id: 'msg_2' } }),
		streamEvent({ type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } }),
		streamEvent({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'One row.' } }),
		streamEvent({ type: 'content_block_stop', index: 0 }),
		sdk({
			type: 'result',
			subtype: 'success',
			is_error: false,
			result: 'One row.',
			total_cost_usd: 0.04,
			duration_ms: 1_200,
			usage: { input_tokens: 10, cache_read_input_tokens: 5, cache_creation_input_tokens: 2, output_tokens: 3 },
		}),
	];
}

describe('UIMessageTranslator', () => {
	it('streams a nao tool call under the name the chat renders, with the full output from _meta', () => {
		const { chunks, translator } = translateAll(toolCallTurn());

		expect(chunks).toEqual([
			{ type: 'start-step' },
			{ type: 'tool-input-start', toolCallId: TOOL_CALL_ID, toolName: 'execute_sql' },
			{ type: 'tool-input-delta', toolCallId: TOOL_CALL_ID, inputTextDelta: '{"sql' },
			{
				type: 'tool-input-available',
				toolCallId: TOOL_CALL_ID,
				toolName: 'execute_sql',
				input: { sql: 'select 1' },
			},
			{ type: 'tool-output-available', toolCallId: TOOL_CALL_ID, output: SQL_OUTPUT },
			{ type: 'finish-step' },
			{ type: 'start-step' },
			{ type: 'text-start', id: 'msg_2-0' },
			{ type: 'text-delta', id: 'msg_2-0', delta: 'One row.' },
			{ type: 'text-end', id: 'msg_2-0' },
			{ type: 'finish-step' },
		]);
		expect(translator.outcome).toEqual({
			modelId: 'claude-sonnet-5-5',
			usage: { inputTokens: 10, cacheReadInputTokens: 5, cacheCreationInputTokens: 2, outputTokens: 3 },
			estimatedCostUsd: 0.04,
			durationMs: 1_200,
		});
	});

	it('reports a failed tool call and a failed session as errors', () => {
		const { chunks, translator } = translateAll([
			sdk({
				type: 'user',
				parent_tool_use_id: null,
				message: {
					role: 'user',
					content: [
						{
							type: 'tool_result',
							tool_use_id: TOOL_CALL_ID,
							is_error: true,
							content: [{ type: 'text', text: 'boom' }],
						},
					],
				},
			}),
			sdk({ type: 'result', subtype: 'success', is_error: true, result: 'Usage limit reached', usage: {} }),
		]);

		expect(chunks).toEqual([
			{ type: 'tool-output-error', toolCallId: TOOL_CALL_ID, errorText: 'boom' },
			{ type: 'error', errorText: 'Usage limit reached' },
		]);
		expect(translator.outcome?.errorMessage).toBe('Usage limit reached');
	});

	it('closes the open text and step when a turn is interrupted', () => {
		const translator = new UIMessageTranslator();
		translator.translate(streamEvent({ type: 'message_start', message: { id: 'msg_1' } }));
		translator.translate(
			streamEvent({ type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } }),
		);

		expect(translator.close()).toEqual([{ type: 'text-end', id: 'msg_1-0' }, { type: 'finish-step' }]);
	});
});
