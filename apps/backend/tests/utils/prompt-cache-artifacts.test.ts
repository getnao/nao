import { createAmazonBedrock } from '@ai-sdk/amazon-bedrock';
import { createAnthropic } from '@ai-sdk/anthropic';
import { createOpenRouter } from '@openrouter/ai-sdk-provider';
import { convertToModelMessages, generateText, jsonSchema, type LanguageModel, type ModelMessage, tool } from 'ai';
import { describe, expect, it, vi } from 'vitest';

import { appendChatArtifacts } from '../../src/services/chat-artifacts';
import type { ChatArtifacts } from '../../src/types/artifacts';
import type { UIMessage } from '../../src/types/chat';
import { addPromptCache } from '../../src/utils/prompt-cache';

vi.mock('../../src/queries/story.queries', () => ({ listLatestVersionsInChat: vi.fn() }));
vi.mock('../../src/queries/story-file.queries', () => ({ listDraftFiles: vi.fn() }));
vi.mock('../../src/services/story-template-validation', () => ({ getStoryTemplateWarnings: vi.fn() }));

const ARTIFACTS_TAG = '<conversation-artifacts>';
const MAX_BREAKPOINTS = 3;

const firstArtifacts: ChatArtifacts = {
	queries: [{ id: 'query_aaaa1111', columns: ['total'], rowCount: 1 }],
	stories: [],
};
const secondArtifacts: ChatArtifacts = {
	queries: [...firstArtifacts.queries, { id: 'query_bbbb2222', columns: ['month', 'total'], rowCount: 12 }],
	stories: [],
};

const firstTurn = [user('u1', 'First question'), assistant('a1', 'First answer'), user('u2', 'Second question')];
const secondTurn = [...firstTurn, assistant('a2', 'Second answer'), user('u3', 'Third question')];

describe.each([
	['anthropic', anthropicRequest],
	['bedrock', bedrockRequest],
] as const)('prompt cache across turns with %s', (_provider, sendRequest) => {
	it('keeps the prefix up to the breakpoint identical between two consecutive turns', async () => {
		const first = await sendRequest(await buildMessages(firstTurn, firstArtifacts));
		const second = await sendRequest(await buildMessages(secondTurn, secondArtifacts));

		const prefix = first.slice(0, lastBreakpointBeforeArtifacts(first) + 1);

		expect(JSON.stringify(prefix)).not.toContain(ARTIFACTS_TAG);
		expect(prefix.map(withoutBreakpoint)).toEqual(second.slice(0, prefix.length).map(withoutBreakpoint));
	});

	it('marks the previous turn entry again so a long turn cannot push it out of the lookback', async () => {
		const first = await sendRequest(await buildMessages(firstTurn, firstArtifacts));
		const second = await sendRequest(await buildMessages(secondTurn, secondArtifacts));

		expect(second[lastBreakpointBeforeArtifacts(first)].hasBreakpoint).toBe(true);
	});

	it('still caches the artifacts for the next steps of the same turn', async () => {
		const blocks = await sendRequest(await buildMessages(secondTurn, secondArtifacts));

		expect(blocks.at(-1)?.hasBreakpoint).toBe(true);
		expect(JSON.stringify(blocks.at(-1))).toContain(ARTIFACTS_TAG);
	});

	it('keeps the breakpoint before the artifacts on the later steps of a tool loop', async () => {
		const messages = await buildMessages(secondTurn, secondArtifacts);
		const blocks = await sendRequest([...messages, ...toolStep('call_1'), ...toolStep('call_2')]);

		const artifactsIndex = blocks.findIndex((block) => JSON.stringify(block.content).includes(ARTIFACTS_TAG));
		expect(blocks[artifactsIndex - 1].hasBreakpoint).toBe(true);
		expect(blocks.at(-1)?.hasBreakpoint).toBe(true);
		expect(blocks.filter((block) => block.hasBreakpoint).length).toBeLessThanOrEqual(MAX_BREAKPOINTS);
	});

	it('stays within the breakpoint limit, leaving one for the system prompt', async () => {
		const blocks = await sendRequest(await buildMessages(secondTurn, secondArtifacts));

		expect(blocks.filter((block) => block.hasBreakpoint).length).toBeLessThanOrEqual(MAX_BREAKPOINTS);
	});

	it('only marks the previous user message and the last block when the turn has no artifacts', async () => {
		const blocks = await sendRequest(await buildMessages(secondTurn, { queries: [], stories: [] }));

		expect(blocks.filter((block) => block.hasBreakpoint).map((block) => block.index)).toEqual([
			blocks.findIndex((block) => JSON.stringify(block).includes('Second question')),
			blocks.length - 1,
		]);
	});
});

describe.each([
	['anthropic', anthropicRequest],
	['bedrock', bedrockRequest],
	['openrouter', openRouterRequest],
] as const)('prompt cache with parallel tool calls with %s', (_provider, sendRequest) => {
	it('stays within the breakpoint limit when the last step returned several tool results', async () => {
		const messages = await buildMessages(secondTurn, secondArtifacts);
		const blocks = await sendRequest([...messages, ...parallelToolStep(['call_1', 'call_2', 'call_3'])]);

		expect(blocks.filter((block) => block.hasBreakpoint).length).toBeLessThanOrEqual(MAX_BREAKPOINTS);
		expect(blocks.at(-1)?.hasBreakpoint).toBe(true);
	});
});

type RenderedBlock = { index: number; hasBreakpoint: boolean; content: unknown };

async function buildMessages(messages: UIMessage[], artifacts: ChatArtifacts): Promise<ModelMessage[]> {
	const withArtifacts = appendChatArtifacts(messages, artifacts);
	return convertToModelMessages(withArtifacts);
}

async function anthropicRequest(messages: ModelMessage[]): Promise<RenderedBlock[]> {
	const provider = createAnthropic({
		apiKey: 'test',
		fetch: respondWith({
			id: 'msg_1',
			type: 'message',
			role: 'assistant',
			model: 'claude-sonnet-5-5',
			content: [{ type: 'text', text: 'ok' }],
			stop_reason: 'end_turn',
			stop_sequence: null,
			usage: { input_tokens: 1, output_tokens: 1 },
		}),
	});
	const body = await captureBody(provider('claude-sonnet-5-5'), 'anthropic', 'claude-sonnet-5-5', messages);
	return renderBlocks(
		body,
		(block) => 'cache_control' in block && block.cache_control !== undefined,
		({ cache_control: _cacheControl, ...content }) => content,
	);
}

async function bedrockRequest(messages: ModelMessage[]): Promise<RenderedBlock[]> {
	const modelId = 'us.anthropic.claude-sonnet-4-6';
	const provider = createAmazonBedrock({
		region: 'us-east-1',
		accessKeyId: 'test',
		secretAccessKey: 'test',
		fetch: respondWith({
			output: { message: { role: 'assistant', content: [{ text: 'ok' }] } },
			stopReason: 'end_turn',
			usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
		}),
	});
	const body = await captureBody(provider(modelId), 'bedrock', modelId, messages);
	return renderBedrockBlocks(body);
}

async function openRouterRequest(messages: ModelMessage[]): Promise<RenderedBlock[]> {
	const modelId = 'anthropic/claude-sonnet-4.6';
	const provider = createOpenRouter({
		apiKey: 'test',
		fetch: respondWith({
			id: 'gen_1',
			object: 'chat.completion',
			created: 0,
			model: modelId,
			choices: [{ index: 0, message: { role: 'assistant', content: 'ok' }, finish_reason: 'stop' }],
			usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
		}),
	});
	const body = await captureBody(provider.chat(modelId), 'openrouter', modelId, messages);
	return renderOpenRouterBlocks(body as unknown as OpenRouterRequestBody);
}

let capturedBody: RequestBody | undefined;

type RequestBody = { messages: { role: string; content: Record<string, unknown>[] }[] };
type OpenRouterRequestBody = {
	messages: { role: string; content: string | Record<string, unknown>[] | null; cache_control?: unknown }[];
};

async function captureBody(
	model: LanguageModel,
	provider: 'anthropic' | 'bedrock' | 'openrouter',
	modelId: string,
	messages: ModelMessage[],
): Promise<RequestBody> {
	await generateText({
		model,
		messages: addPromptCache(messages, { provider, modelId }),
		tools: { execute_sql: tool({ inputSchema: jsonSchema({ type: 'object' }) }) },
	});
	if (!capturedBody) {
		throw new Error('The provider sent no request');
	}
	return capturedBody;
}

function respondWith(response: unknown): typeof globalThis.fetch {
	return async (_input, init) => {
		capturedBody = JSON.parse(String(init?.body)) as RequestBody;
		return new Response(JSON.stringify(response), {
			status: 200,
			headers: { 'content-type': 'application/json' },
		});
	};
}

function renderBlocks(
	body: RequestBody,
	hasBreakpoint: (block: Record<string, unknown>) => boolean,
	toContent: (block: Record<string, unknown>) => unknown,
): RenderedBlock[] {
	return body.messages
		.flatMap((message) => message.content.map((block) => ({ role: message.role, block })))
		.map(({ role, block }, index) => ({
			index,
			hasBreakpoint: hasBreakpoint(block),
			content: { role, block: toContent(block) },
		}));
}

/** Bedrock renders a breakpoint as its own block following the one it caches. */
function renderBedrockBlocks(body: RequestBody): RenderedBlock[] {
	const blocks = body.messages.flatMap((message) => message.content.map((block) => ({ role: message.role, block })));
	const contentBlocks = blocks
		.map((entry, position) => ({ ...entry, position }))
		.filter(({ block }) => !('cachePoint' in block));
	return contentBlocks.map(({ role, block, position }, index) => ({
		index,
		hasBreakpoint: blocks[position + 1] !== undefined && 'cachePoint' in blocks[position + 1].block,
		content: { role, block },
	}));
}

/** OpenRouter carries a breakpoint on a content part, or on the message itself when its content is not a list. */
function renderOpenRouterBlocks(body: OpenRouterRequestBody): RenderedBlock[] {
	return body.messages
		.flatMap((message) =>
			Array.isArray(message.content)
				? message.content.map((part) => ({ hasBreakpoint: 'cache_control' in part, content: part }))
				: [{ hasBreakpoint: message.cache_control !== undefined, content: message }],
		)
		.map((block, index) => ({ index, ...block }));
}

function lastBreakpointBeforeArtifacts(blocks: RenderedBlock[]): number {
	const artifactsIndex = blocks.findIndex((block) => JSON.stringify(block.content).includes(ARTIFACTS_TAG));
	const beforeArtifacts = blocks[artifactsIndex - 1];
	expect(beforeArtifacts?.hasBreakpoint).toBe(true);
	return beforeArtifacts.index;
}

function withoutBreakpoint(block: RenderedBlock): unknown {
	return block.content;
}

function toolStep(toolCallId: string): ModelMessage[] {
	return [
		{
			role: 'assistant',
			content: [{ type: 'tool-call', toolCallId, toolName: 'execute_sql', input: { sql_query: 'SELECT 1' } }],
		},
		{
			role: 'tool',
			content: [
				{ type: 'tool-result', toolCallId, toolName: 'execute_sql', output: { type: 'text', value: 'ok' } },
			],
		},
	];
}

function parallelToolStep(toolCallIds: string[]): ModelMessage[] {
	return [
		{
			role: 'assistant',
			content: toolCallIds.map((toolCallId) => ({
				type: 'tool-call',
				toolCallId,
				toolName: 'execute_sql',
				input: { sql_query: 'SELECT 1' },
			})),
		},
		{
			role: 'tool',
			content: toolCallIds.map((toolCallId) => ({
				type: 'tool-result',
				toolCallId,
				toolName: 'execute_sql',
				output: { type: 'text', value: 'ok' },
			})),
		},
	];
}

function user(id: string, text: string): UIMessage {
	return { id, role: 'user', parts: [{ type: 'text', text }] } as UIMessage;
}

function assistant(id: string, text: string): UIMessage {
	return { id, role: 'assistant', parts: [{ type: 'text', text }] } as UIMessage;
}
