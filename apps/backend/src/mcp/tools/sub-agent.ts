import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { getToolName, type InferUIMessageChunk, isToolUIPart, readUIMessageStream } from 'ai';
import { z } from 'zod';

import { MCP_SUB_AGENT_EXCLUDED_TOOLS } from '../../agents/tools';
import * as chatQueries from '../../queries/chat.queries';
import * as storyQueries from '../../queries/story.queries';
import { agentService, defaultAgentToolsExcluding } from '../../services/agent';
import { mcpService } from '../../services/mcp';
import { skillService } from '../../services/skill';
import type { UIMessage, UIMessagePart } from '../../types/chat';
import { CHART_DATA_MODE_ASK_NAO_ADDENDUM, CHART_DATA_MODE_RESULT_NUDGE } from '../chart-data-mode';
import type { McpContext, ToolResult } from '../logging';
import { chatUrl } from '../urls';
import { type AskNaoClarification, type AskNaoResult, askNaoRuns } from './ask-nao-runs';
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
	"`status: 'complete'`.\n\n" +
	"CLARIFICATIONS: if the question is ambiguous, this returns `status: 'needs_clarification'` " +
	'with a `clarification.question` (and optional `clarification.options`). Relay the question to the user, ' +
	'then call `ask_nao` again with the SAME `chatId` and their answer as `question`.';

const ASK_NAO_DATA_MODE_DESCRIPTION = ASK_NAO_DESCRIPTION + CHART_DATA_MODE_ASK_NAO_ADDENDUM;

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

const ASK_NAO_CLARIFICATION_SCHEMA = z
	.object({
		question: z.string(),
		options: z.array(z.string()).optional(),
	})
	.optional()
	.describe(
		'Present when `status` is `needs_clarification`: the question nao needs answered, with optional one-click answer choices.',
	);

export function registerSubAgentTools(server: McpServer, ctx: McpContext): void {
	registerMcpTool(server, ctx, {
		name: 'ask_nao',
		title: 'Ask Nao',
		description: ctx.chartDataMode ? ASK_NAO_DATA_MODE_DESCRIPTION : ASK_NAO_DESCRIPTION,
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
				.enum(['running', 'complete', 'needs_clarification'])
				.describe(
					'`complete` carries the answer; `running` means poll `get_nao_answer` with `chatId`; ' +
						'`needs_clarification` means nao asked a clarifying question — relay it to the user, ' +
						"then call `ask_nao` again with the same `chatId` and the user's answer.",
				),
			chatId: z
				.string()
				.describe(
					'UUID of the chat that holds this run. Pass to `get_nao_answer` to poll, or to ' +
						'`create_story` / `update_story` to attach further work.',
				),
			chatUrl: z.url().describe('URL to open the chat in the nao UI.'),
			text: z.string().describe('The assistant final text response. Empty while `status` is `running`.'),
			clarification: ASK_NAO_CLARIFICATION_SCHEMA,
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

			const agent = await agentService.create(chat, undefined, {
				tools: defaultAgentToolsExcluding(MCP_SUB_AGENT_EXCLUDED_TOOLS),
			});
			askNaoRuns.start(chat.id);
			const runPromise = runAskNaoInBackground(agent, uiMessages, chat.id, naoChatUrl);

			const outcome = await waitForResultOrBudget(runPromise, ASK_NAO_SYNC_BUDGET_MS);
			if (outcome.kind === 'error') {
				throw new Error(outcome.error);
			}
			if (outcome.kind === 'complete') {
				return answerCompletePayload(outcome.result, ctx);
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
			status: z.enum(['running', 'complete', 'needs_clarification', 'error']),
			chatId: z.string(),
			chatUrl: z.url(),
			text: z.string().describe('The assistant final text response. Empty unless `status` is `complete`.'),
			clarification: ASK_NAO_CLARIFICATION_SCHEMA,
			queries: ASK_NAO_QUERIES_SCHEMA,
			story_ids: z.array(z.string()),
			error: z.string().optional().describe('Failure reason when `status` is `error`.'),
		},
		errorMessage: () => 'Failed to fetch the nao answer.',
		handler: async ({ chatId }) => {
			await assertChatAccess(ctx, chatId);
			return resolveAnswerPayload(chatId, ctx);
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
		let answer = await drainStream(agent.stream(uiMessages));
		if (!answer.text && !answer.clarification) {
			answer = await extractAnswerFromChat(chatId);
		}
		const result: AskNaoResult = {
			chatId,
			chatUrl: naoChatUrl,
			text: answer.text,
			...(answer.clarification ? { clarification: answer.clarification } : {}),
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

async function resolveAnswerPayload(chatId: string, ctx: McpContext): Promise<ToolResult> {
	const state = askNaoRuns.get(chatId);
	if (!state) {
		return reconstructAnswerFromDb(chatId, ctx);
	}
	if (state.status === 'complete') {
		return answerCompletePayload(state.result, ctx);
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
async function reconstructAnswerFromDb(chatId: string, ctx: McpContext): Promise<ToolResult> {
	const answer = await extractAnswerFromChat(chatId);
	return answerCompletePayload(
		{
			chatId,
			chatUrl: chatUrl(chatId),
			text: answer.text,
			...(answer.clarification ? { clarification: answer.clarification } : {}),
			queries: [],
			story_ids: [],
		},
		ctx,
	);
}

async function extractAnswerFromChat(chatId: string): Promise<AskNaoAnswer> {
	const messages = await chatQueries.getChatMessages(chatId);
	const lastAssistant = [...messages].reverse().find((message) => message.role === 'assistant') ?? null;
	return extractAnswer(lastAssistant);
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

function answerCompletePayload(result: AskNaoResult, ctx: McpContext): ToolResult {
	if (result.clarification) {
		return clarificationPayload(result, result.clarification);
	}

	const content: ToolResult['content'] = [
		{
			type: 'text' as const,
			text: `${result.text}\n\n[chatId: ${result.chatId}]\n[chatUrl: ${result.chatUrl}]`,
		},
		{ type: 'text' as const, text: JSON.stringify({ queries: result.queries, story_ids: result.story_ids }) },
	];
	if (ctx.chartDataMode && result.queries.length > 0 && result.story_ids.length === 0) {
		content.push({ type: 'text' as const, text: CHART_DATA_MODE_RESULT_NUDGE });
	}

	return {
		content,
		structuredContent: { status: 'complete', ...result },
	};
}

function clarificationPayload(result: AskNaoResult, clarification: AskNaoClarification): ToolResult {
	const optionsText = clarification.options?.length
		? `\nSuggested answers:\n${clarification.options.map((option) => `- ${option}`).join('\n')}`
		: '';
	const structuredClarification = {
		question: clarification.question,
		...(clarification.options?.length ? { options: clarification.options } : {}),
	};

	return {
		content: [
			{
				type: 'text' as const,
				text:
					`nao needs clarification before it can answer: "${clarification.question}"` +
					optionsText +
					`\nAsk the user, then call ask_nao again with the SAME chatId (${result.chatId}) and the user's answer as the question.`,
			},
		],
		structuredContent: {
			status: 'needs_clarification',
			chatId: result.chatId,
			chatUrl: result.chatUrl,
			text: result.text,
			clarification: structuredClarification,
			queries: result.queries,
			story_ids: result.story_ids,
		},
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

type AskNaoAnswer = { text: string; clarification?: AskNaoClarification };

async function drainStream(stream: ReadableStream<InferUIMessageChunk<UIMessage>>): Promise<AskNaoAnswer> {
	let lastMessage: UIMessage | null = null;
	for await (const message of readUIMessageStream<UIMessage>({ stream })) {
		lastMessage = message;
	}
	return extractAnswer(lastMessage);
}

/** Splits an assistant message into its final text and any pending clarification question. */
export function extractAnswer(message: UIMessage | null): AskNaoAnswer {
	const clarification = extractClarification(message);
	return {
		text: extractFinalText(message),
		...(clarification ? { clarification } : {}),
	};
}

export function extractClarification(message: UIMessage | null): AskNaoClarification | undefined {
	if (!message) {
		return undefined;
	}
	const part = message.parts.find((part) => isToolUIPart(part) && getToolName(part) === 'clarification');
	if (!part) {
		return undefined;
	}
	const toolPart = part as { input?: unknown; rawInput?: unknown };
	const input = firstRecord(toolPart.input, toolPart.rawInput);
	if (!input || typeof input.question !== 'string' || input.question.trim().length === 0) {
		return undefined;
	}

	const options = extractClarificationOptions(input);
	return options ? { question: input.question, options } : { question: input.question };
}

export function extractFinalText(message: UIMessage | null): string {
	if (!message) {
		return '';
	}
	return message.parts
		.filter((p): p is Extract<UIMessagePart, { type: 'text' }> => p.type === 'text')
		.map((p) => p.text)
		.join('\n\n');
}

function extractClarificationOptions(input: Record<string, unknown>): string[] | undefined {
	const options = input.options;
	if (!Array.isArray(options) || options.length === 0) {
		return undefined;
	}
	if (!options.every((option): option is string => typeof option === 'string')) {
		return undefined;
	}
	return options;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null;
}

function firstRecord(...values: unknown[]): Record<string, unknown> | undefined {
	return values.find((value): value is Record<string, unknown> => isRecord(value));
}
