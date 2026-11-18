import { createAnthropic } from '@ai-sdk/anthropic';
import { generateText, jsonSchema, type ModelMessage, tool } from 'ai';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../src/db/db', () => ({ db: {} }));

import { createProviderModel } from '../../src/agents/providers';
import {
	CLEARABLE_TOOLS,
	disableToolResultClearing,
	protectInternalToolResults,
	TOOL_RESULT_CLEARING_EDIT,
} from '../../src/agents/tool-result-clearing';
import { getTools } from '../../src/agents/tools';
import { mcpService } from '../../src/services/mcp';

const MODEL_ID = 'claude-opus-5-5';

type ClearingEdit = { type: string; excludeTools?: string[]; keep?: unknown; clearAtLeast?: unknown };

afterEach(() => {
	vi.restoreAllMocks();
});

describe('protectInternalToolResults', () => {
	it.each([
		['with MCP, map, storage and follow-ups', ['linear'], {}],
		['without MCP', [], {}],
		['without map or follow-ups', ['linear'], { excludeFollowUps: true, mapDisabled: true }],
	])('protects every internal tool of a realistic agent %s', (_label, mcpServers, variant) => {
		const toolNames = agentToolNames(mcpServers, variant);

		const excludeTools = clearingEdit(toolNames).excludeTools;

		expect(excludeTools).toEqual(toolNames.filter((name) => name !== 'mcp_call'));
		expect(excludeTools).not.toContain('mcp_call');
	});

	it('protects the tools the old hand-written list had missed', () => {
		const excludeTools = clearingEdit(agentToolNames(['linear'], {})).excludeTools;

		expect(excludeTools).toEqual(
			expect.arrayContaining(['display_map', 'clarification', 'mcp_connect', 'write', 'str_replace']),
		);
		expect(excludeTools).toEqual(expect.arrayContaining(['page_query_result', 'suggest_follow_ups', 'load_skill']));
	});

	it('protects a newly added internal tool without any list to update', () => {
		const toolNames = [...agentToolNames(['linear'], {}), 'brand_new_internal_tool'];

		expect(clearingEdit(toolNames).excludeTools).toContain('brand_new_internal_tool');
	});

	it('keeps protecting internal tools the run no longer has but the history still holds', () => {
		const history = conversationWithToolCalls(['codemode', 'request_warehouse_credentials', 'mcp_call']);

		const excludeTools = clearingEdit(['execute_sql', 'mcp_call'], history).excludeTools;

		expect(excludeTools).toEqual(['execute_sql', 'codemode', 'request_warehouse_credentials']);
	});

	it('only lets MCP results be cleared', () => {
		expect([...CLEARABLE_TOOLS]).toEqual(['mcp_call']);
	});

	it('clears in batches rather than one tool result per step', () => {
		const edit = clearingEdit(['mcp_call']);

		expect(edit.keep).toEqual({ type: 'tool_uses', value: 3 });
		expect(edit.clearAtLeast).toEqual({ type: 'input_tokens', value: 50_000 });
	});

	it('leaves providers without context editing untouched', () => {
		const { providerOptions } = createProviderModel('openai', { apiKey: 'test' }, 'gpt-5');

		expect(protectInternalToolResults(providerOptions, ['execute_sql'])).toBe(providerOptions);
	});
});

describe('disableToolResultClearing', () => {
	it('removes the clearing edit and keeps the other Anthropic options', () => {
		const { providerOptions } = createProviderModel('anthropic', { apiKey: 'test' }, MODEL_ID);

		const disabled = disableToolResultClearing(providerOptions);

		expect(disabled.anthropic).not.toHaveProperty('contextManagement');
		expect(disabled.anthropic?.disableParallelToolUse).toBe(false);
	});

	it('leaves providers without context editing untouched', () => {
		const { providerOptions } = createProviderModel('openai', { apiKey: 'test' }, 'gpt-5');

		expect(disableToolResultClearing(providerOptions)).toBe(providerOptions);
	});
});

describe('context_management request body', () => {
	it('sends the derived exclude list and the batching thresholds to the Messages API', async () => {
		const body = await captureAnthropicBody(['execute_sql', 'display_map', 'mcp_call']);

		expect(body.context_management).toEqual({
			edits: [
				{
					type: 'clear_tool_uses_20250919',
					trigger: { type: 'input_tokens', value: TOOL_RESULT_CLEARING_EDIT.trigger.value },
					keep: { type: 'tool_uses', value: 3 },
					clear_at_least: { type: 'input_tokens', value: 50_000 },
					clear_tool_inputs: false,
					exclude_tools: ['execute_sql', 'display_map'],
				},
			],
		});
	});
	it('replaces the exclude list with the one a step returns, history included', async () => {
		const history = conversationWithToolCalls(['codemode']);
		const body = await captureAnthropicBody(['execute_sql', 'mcp_call'], history);

		expect(body.context_management).toMatchObject({
			edits: [{ type: 'clear_tool_uses_20250919', exclude_tools: ['execute_sql', 'codemode'] }],
		});
	});
});

function agentToolNames(
	mcpServers: string[],
	variant: { excludeFollowUps?: boolean; mapDisabled?: boolean },
): string[] {
	vi.spyOn(mcpService, 'getConfiguredServerNames').mockReturnValue(mcpServers);
	const agentSettings = variant.mapDisabled ? { mapEnabled: false } : null;
	const tools = getTools(agentSettings, undefined, {
		excludeFollowUps: variant.excludeFollowUps,
		customStoryAuthoring: true,
	});
	return Object.keys(tools);
}

function clearingEdit(toolNames: string[], history: ModelMessage[] = []): ClearingEdit {
	const { providerOptions } = createProviderModel('anthropic', { apiKey: 'test' }, MODEL_ID);
	const edits =
		protectInternalToolResults(providerOptions, toolNames, history).anthropic?.contextManagement?.edits ?? [];
	const edit = edits.find((candidate) => candidate.type === 'clear_tool_uses_20250919');
	if (!edit) {
		throw new Error('No tool-result clearing edit configured');
	}
	return edit as ClearingEdit;
}

async function captureAnthropicBody(toolNames: string[], history?: ModelMessage[]): Promise<Record<string, unknown>> {
	let body: Record<string, unknown> | undefined;
	const provider = createAnthropic({
		apiKey: 'test',
		fetch: async (_input, init) => {
			body = JSON.parse(String(init?.body)) as Record<string, unknown>;
			return new Response(JSON.stringify(EMPTY_RESPONSE), {
				status: 200,
				headers: { 'content-type': 'application/json' },
			});
		},
	});
	const { providerOptions } = createProviderModel('anthropic', { apiKey: 'test' }, MODEL_ID);
	await generateText({
		model: provider(MODEL_ID),
		prompt: 'hello',
		tools: Object.fromEntries(
			toolNames.map((name) => [name, tool({ inputSchema: jsonSchema({ type: 'object' }) })]),
		),
		providerOptions: protectInternalToolResults(providerOptions, toolNames),
		...(history && {
			prepareStep: () => ({
				messages: [...history, { role: 'user' as const, content: 'hello' }],
				providerOptions: protectInternalToolResults(providerOptions, toolNames, history),
			}),
		}),
	});
	if (!body) {
		throw new Error('The provider sent no request');
	}
	return body;
}

function conversationWithToolCalls(toolNames: string[]): ModelMessage[] {
	return toolNames.flatMap((toolName, index): ModelMessage[] => [
		{ role: 'assistant', content: [{ type: 'tool-call', toolCallId: `call_${index}`, toolName, input: {} }] },
		{
			role: 'tool',
			content: [
				{
					type: 'tool-result',
					toolCallId: `call_${index}`,
					toolName,
					output: { type: 'text', value: 'result' },
				},
			],
		},
	]);
}

const EMPTY_RESPONSE = {
	id: 'msg_1',
	type: 'message',
	role: 'assistant',
	model: MODEL_ID,
	content: [{ type: 'text', text: 'ok' }],
	stop_reason: 'end_turn',
	stop_sequence: null,
	usage: { input_tokens: 1, output_tokens: 1 },
};
