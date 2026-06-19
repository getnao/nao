import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { type InferUIMessageChunk, readUIMessageStream } from 'ai';
import { z } from 'zod';

import * as chatQueries from '../../queries/chat.queries';
import * as storyQueries from '../../queries/story.queries';
import { agentService } from '../../services/agent';
import { mcpService } from '../../services/mcp';
import { skillService } from '../../services/skill';
import type { UIMessage, UIMessagePart } from '../../types/chat';
import type { McpContext, ToolResult } from '../logging';
import { chatUrl } from '../urls';
import { type AskNaoResult, askNaoRuns } from './ask-nao-runs';
import { registerMcpTool } from './register-mcp-tool';

type Agent = Awaited<ReturnType<typeof agentService.create>>;

/**
 * Time `ask_nao` waits for the run to finish before returning a `running` status.
 * Kept safely below the MCP client default request timeout (60s) so clients that
 * cannot extend it (e.g. Cowork) get a response in time and switch to polling.
 */
const ASK_NAO_SYNC_BUDGET_MS = 45_000;

const ASK_NAO_DESCRIPTION =
	'Default tool for any analytics question or story-creation request. ' +
	"Delegates the full reasoning loop to nao's sub-agent — it reads project rules/context, " +
	'writes SQL, builds charts, drafts stories — and the whole conversation is persisted as a ' +
	'chat visible in the nao UI (replayable, shareable, forkable by the end user).\n\n' +
	'USE WHEN: the user asks an analytics question, wants a chart, or wants a story created. ' +
	'Default to this tool; only fall back to `execute_sql` / `display_chart` / `create_story` ' +
	'when you explicitly need step-by-step control or `ask_nao` cannot handle the request.\n' +
	"SKIP WHEN: you'd rather drive the workflow yourself by chaining `ls_nao_context` / " +
	'`grep_nao_context` / `read_nao_context` / `execute_sql` / `display_chart` / ' +
	'`create_story` step by step — those run as plain tool calls, leave no chat in the UI, ' +
	'and give you full control over each step.\n\n' +
	'LONG RUNS: the agent runs in the background. If it does not finish quickly this returns ' +
	"`status: 'running'` with a `chatId` instead of the answer. When that happens, call " +
	'`get_nao_answer` with that `chatId` (polling every few seconds) until it returns ' +
	"`status: 'complete'`.";

const GET_NAO_ANSWER_DESCRIPTION =
	'Fetch the result of an `ask_nao` run that is still in progress. ' +
	"USE WHEN: a previous `ask_nao` (or `get_nao_answer`) call returned `status: 'running'`. " +
	'Pass the `chatId` it returned. Poll every few seconds until `status` is `complete` ' +
	'(the response then carries the final `text`, `queries` and `story_ids`) or `error`.';

const ASK_NAO_QUERIES_SCHEMA = z
	.array(
		z.object({
			id: z.string().describe('`query_id` to pass to `display_chart`.'),
			columns: z
				.array(z.string())
				.describe('Column names in the result — use these for `x_axis_key` and `series[].data_key`.'),
			row_count: z.number().describe('Total number of rows returned.'),
			preview: z
				.array(z.record(z.string(), z.unknown()))
				.describe('First 3 rows — useful to infer x_axis_type and chart_type.'),
		}),
	)
	.describe(
		'Every query the sub-agent executed, with schema metadata. Same shape as `execute_sql` output. ' +
			'Forward `id` to `display_chart` as `query_id`; pick `x_axis_key` / `series[].data_key` from `columns`.',
	);

export function registerSubAgentTools(server: McpServer, ctx: McpContext): void {
	registerMcpTool(server, ctx, {
		name: 'ask_nao',
		title: 'Ask Nao',
		description: ASK_NAO_DESCRIPTION,
		inputSchema: {
			question: z
				.string()
				.describe(
					'Natural-language analytics question or task. The agent reads project context ' +
						'(rules, columns, semantic layer) to decide what to query — no need to mention SQL or table names.',
				),
			chatId: z
				.uuid()
				.optional()
				.describe(
					'UUID of an existing chat to continue. Omit to start a new chat. ' +
						'Reuse only when the new question clearly builds on the same topic. ' +
						'If the topic shifts or the prior reply was a refusal, omit it.',
				),
		},
		outputSchema: {
			status: z
				.enum(['running', 'complete'])
				.describe('`complete` carries the answer; `running` means poll `get_nao_answer` with `chatId`.'),
			chatId: z
				.string()
				.describe(
					'UUID of the chat that holds this run. Pass to `get_nao_answer` to poll, or to ' +
						'`create_story` / `update_story` to attach further work.',
				),
			chatUrl: z.url().describe('URL to open the chat in the nao UI.'),
			text: z.string().describe('The assistant final text response. Empty while `status` is `running`.'),
			queries: ASK_NAO_QUERIES_SCHEMA,
			story_ids: z
				.array(z.string())
				.describe(
					'UUIDs of stories the sub-agent created or updated. Forward each one to `get_story` / `update_story` / `archive_story` / `delete_story`.',
				),
		},
		errorMessage: () => 'Nao agent failed to process the request.',
		handler: async ({ question, chatId }) => {
			await mcpService.initializeMcpState(ctx.projectId);
			await skillService.initializeSkills(ctx.projectId);

			const { chat, uiMessages } = await buildChatContext(ctx.projectId, ctx.userId, question, chatId);
			const naoChatUrl = chatUrl(chat.id);

			const agent = await agentService.create(chat);
			askNaoRuns.start(chat.id);
			const runPromise = runAskNaoInBackground(agent, uiMessages, chat.id, naoChatUrl);

			const outcome = await waitForResultOrBudget(runPromise, ASK_NAO_SYNC_BUDGET_MS);
			if (outcome.kind === 'error') {
				throw new Error(outcome.error);
			}
			if (outcome.kind === 'complete') {
				return answerCompletePayload(outcome.result);
			}
			return runningPayload(chat.id, naoChatUrl);
		},
	});

	registerMcpTool(server, ctx, {
		name: 'get_nao_answer',
		title: 'Get Nao Answer',
		description: GET_NAO_ANSWER_DESCRIPTION,
		inputSchema: {
			chatId: z.uuid().describe("UUID returned by an `ask_nao` call that responded with `status: 'running'`."),
		},
		outputSchema: {
			status: z.enum(['running', 'complete', 'error']),
			chatId: z.string(),
			chatUrl: z.url(),
			text: z.string().describe('The assistant final text response. Empty unless `status` is `complete`.'),
			queries: ASK_NAO_QUERIES_SCHEMA,
			story_ids: z.array(z.string()),
			error: z.string().optional().describe('Failure reason when `status` is `error`.'),
		},
		errorMessage: () => 'Failed to fetch the nao answer.',
		handler: async ({ chatId }) => {
			await assertChatAccess(ctx, chatId);
			return resolveAnswerPayload(chatId);
		},
	});
}

/**
 * Drains the agent stream to completion and records the outcome in the run registry.
 * Runs detached from the MCP request so it survives an early `ask_nao` response.
 */
async function runAskNaoInBackground(
	agent: Agent,
	uiMessages: UIMessage[],
	chatId: string,
	naoChatUrl: string,
): Promise<AskNaoResult> {
	try {
		const text = await drainStream(agent.stream(uiMessages));
		const result: AskNaoResult = {
			chatId,
			chatUrl: naoChatUrl,
			text,
			queries: agent.queryResultsSummary,
			story_ids: await resolveStoryIds(agent.generatedArtifacts.stories, chatId),
		};
		askNaoRuns.complete(chatId, result);
		return result;
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		askNaoRuns.fail(chatId, message);
		throw error;
	}
}

type RaceOutcome = { kind: 'complete'; result: AskNaoResult } | { kind: 'error'; error: string } | { kind: 'pending' };

async function waitForResultOrBudget(runPromise: Promise<AskNaoResult>, budgetMs: number): Promise<RaceOutcome> {
	let timer: ReturnType<typeof setTimeout> | undefined;
	const budget = new Promise<RaceOutcome>((resolve) => {
		timer = setTimeout(() => resolve({ kind: 'pending' }), budgetMs);
	});
	const settled = runPromise.then(
		(result): RaceOutcome => ({ kind: 'complete', result }),
		(error): RaceOutcome => ({ kind: 'error', error: error instanceof Error ? error.message : String(error) }),
	);
	try {
		return await Promise.race([settled, budget]);
	} finally {
		clearTimeout(timer);
	}
}

async function resolveAnswerPayload(chatId: string): Promise<ToolResult> {
	const state = askNaoRuns.get(chatId);
	if (!state) {
		return reconstructAnswerFromDb(chatId);
	}
	if (state.status === 'complete') {
		return answerCompletePayload(state.result);
	}
	if (state.status === 'error') {
		return answerErrorPayload(chatId, state.error);
	}
	return answerRunningPayload(chatId);
}

/**
 * Best-effort recovery when the run is no longer tracked in memory (e.g. expired or a
 * restart): rebuild the final answer from the persisted chat. Query/story metadata is
 * not reconstructed since it only lives on the in-memory run.
 */
async function reconstructAnswerFromDb(chatId: string): Promise<ToolResult> {
	const messages = await chatQueries.getChatMessages(chatId);
	const lastAssistant = [...messages].reverse().find((message) => message.role === 'assistant') ?? null;
	return answerCompletePayload({
		chatId,
		chatUrl: chatUrl(chatId),
		text: extractFinalText(lastAssistant),
		queries: [],
		story_ids: [],
	});
}

async function assertChatAccess(ctx: McpContext, chatId: string): Promise<void> {
	const ownerId = await chatQueries.getChatOwnerId(chatId);
	const projectId = ownerId === ctx.userId ? await chatQueries.getChatProjectId(chatId) : undefined;
	if (ownerId !== ctx.userId || projectId !== ctx.projectId) {
		throw new Error('Chat not found or not accessible.');
	}
}

function runningPayload(chatId: string, naoChatUrl: string): ToolResult {
	return {
		content: [
			{
				type: 'text' as const,
				text:
					`nao is still working on this (chatId: ${chatId}). ` +
					`Call get_nao_answer with this chatId every few seconds until it returns status "complete". ` +
					`Follow along live at ${naoChatUrl}.`,
			},
		],
		structuredContent: { status: 'running', chatId, chatUrl: naoChatUrl, text: '', queries: [], story_ids: [] },
	};
}

function answerCompletePayload(result: AskNaoResult): ToolResult {
	return {
		content: [
			{
				type: 'text' as const,
				text: `${result.text}\n\n[chatId: ${result.chatId}]\n[chatUrl: ${result.chatUrl}]`,
			},
			{ type: 'text' as const, text: JSON.stringify({ queries: result.queries, story_ids: result.story_ids }) },
		],
		structuredContent: { status: 'complete', ...result },
	};
}

function answerRunningPayload(chatId: string): ToolResult {
	const naoChatUrl = chatUrl(chatId);
	return {
		content: [
			{
				type: 'text' as const,
				text: `Still running (chatId: ${chatId}). Call get_nao_answer again in a few seconds.`,
			},
		],
		structuredContent: { status: 'running', chatId, chatUrl: naoChatUrl, text: '', queries: [], story_ids: [] },
	};
}

function answerErrorPayload(chatId: string, error: string): ToolResult {
	const naoChatUrl = chatUrl(chatId);
	return {
		content: [{ type: 'text' as const, text: `Nao agent failed: ${error}` }],
		isError: true,
		structuredContent: {
			status: 'error',
			chatId,
			chatUrl: naoChatUrl,
			text: '',
			queries: [],
			story_ids: [],
			error,
		},
	};
}

async function resolveStoryIds(stories: { id: string; title: string }[], chatId: string): Promise<string[]> {
	if (stories.length === 0) {
		return [];
	}
	const resolved = await Promise.all(
		stories.map(async (story) => {
			const row = await storyQueries.getStoryByChatAndSlug(chatId, story.id);
			return row ? row.id : null;
		}),
	);
	return resolved.filter((id): id is string => id !== null);
}

async function buildChatContext(
	projectId: string,
	userId: string,
	question: string,
	chatId: string | undefined,
): Promise<{ chat: { id: string; projectId: string; userId: string }; uiMessages: UIMessage[] }> {
	const userMessage: UIMessage = {
		id: crypto.randomUUID(),
		role: 'user',
		parts: [{ type: 'text', text: question }],
		source: 'mcp',
	};

	if (chatId) {
		const ownerId = await chatQueries.getChatOwnerId(chatId);
		const chatProjectId = ownerId === userId ? await chatQueries.getChatProjectId(chatId) : undefined;
		if (ownerId === userId && chatProjectId === projectId) {
			const history = await chatQueries.getChatMessages(chatId);
			await chatQueries.upsertMessage({ ...userMessage, chatId: chatId });
			return {
				chat: { id: chatId, projectId, userId },
				uiMessages: [...history, userMessage],
			};
		}
	}

	const newChatId = crypto.randomUUID();
	await chatQueries.createChat(
		{ id: newChatId, projectId, userId, title: question.slice(0, 80) },
		{ text: question, source: 'mcp' },
	);
	return {
		chat: { id: newChatId, projectId, userId },
		uiMessages: [userMessage],
	};
}

async function drainStream(stream: ReadableStream<InferUIMessageChunk<UIMessage>>): Promise<string> {
	let lastMessage: UIMessage | null = null;
	for await (const message of readUIMessageStream<UIMessage>({ stream })) {
		lastMessage = message;
	}
	return extractFinalText(lastMessage);
}

function extractFinalText(message: UIMessage | null): string {
	if (!message) {
		return '';
	}
	return message.parts
		.filter((p): p is Extract<UIMessagePart, { type: 'text' }> => p.type === 'text')
		.map((p) => p.text)
		.join('\n\n');
}
