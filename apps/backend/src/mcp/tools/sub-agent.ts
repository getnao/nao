import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { buildStoryChartBlock } from '@nao/shared';
import { type InferUIMessageChunk, readUIMessageStream } from 'ai';
import { z } from 'zod';

import * as chatQueries from '../../queries/chat.queries';
import { agentService } from '../../services/agent';
import { mcpService } from '../../services/mcp';
import { skillService } from '../../services/skill';
import type { UIMessage, UIMessagePart } from '../../types/chat';
import type { McpContext, ToolExtra } from '../logging';
import { defineMcpHandler } from '../logging';
import { chatUrl } from '../urls';

const ASK_NAO_DESCRIPTION =
	"Delegate an analytics task to nao's sub-agent — it runs the full reasoning loop " +
	'(reads project rules/context, writes SQL, builds charts, drafts stories) and the whole ' +
	'conversation is persisted as a chat visible in the nao UI (replayable, shareable, forkable ' +
	'by the end user).\n\n' +
	'USE WHEN: you want to hand off the whole task and produce a user-facing trace in nao — ' +
	'the thinking process itself matters as much as the final answer.\n' +
	"SKIP WHEN: you'd rather drive the workflow yourself by chaining `ls` / `grep` / `execute_sql` / " +
	'`display_chart` / `create_story` step by step — those run as plain tool calls, leave no chat ' +
	'in the UI, and give you full control over each step.\n\n' +
	'Returns the assistant text plus `chatId`, `chatUrl`, and arrays `charts` / `stories` produced ' +
	'during the run. Chain `charts[].queryId` + `chatId` into `display_chart`, or pass `chatId` to ' +
	'`create_story` to attach a follow-up document. Side effect: creates a chat row.';

export function registerSubAgentTools(server: McpServer, ctx: McpContext): void {
	server.registerTool(
		'ask_nao',
		{
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
				chatId: z
					.string()
					.describe(
						'UUID of the chat that holds this run. Pass to `display_chart` / `create_story` / `update_story` to attach further work.',
					),
				chatUrl: z.url().describe('URL to open the chat in the nao UI.'),
				text: z.string().describe('The assistant final text response.'),
				charts: z
					.array(
						z.object({
							queryId: z.string().describe('`query_id` produced by the agent — pass to `display_chart`.'),
							chartType: z.string(),
							title: z.string().optional(),
							block: z.string().describe('`<chart>` block ready to paste into a story `content` field.'),
						}),
					)
					.describe('Charts produced during this run. Chain with `display_chart` using `chatId`.'),
				stories: z
					.array(z.object({ id: z.string(), title: z.string() }))
					.describe('Stories created or updated during this run.'),
			},
		},
		defineMcpHandler(
			'ask_nao',
			ctx,
			async ({ question, chatId }, extra) => {
				await mcpService.initializeMcpState(ctx.projectId);
				await skillService.initializeSkills(ctx.projectId);

				const { chat, uiMessages } = await buildChatContext(ctx.projectId, ctx.userId, question, chatId);

				const agent = await agentService.create(chat);
				const stream = agent.stream(uiMessages);
				const text = await consumeStreamWithProgress(stream, extra);

				const artifacts = agent.generatedArtifacts;
				const charts = artifacts.charts.map((c) => ({
					queryId: c.query_id,
					chartType: c.chart_type,
					title: c.title,
					block: buildStoryChartBlock(c),
				}));
				const stories = artifacts.stories;

				const output = { chatId: chat.id, chatUrl: chatUrl(chat.id), text, charts, stories };
				return {
					content: [
						{
							type: 'text' as const,
							text: `${text}\n\n[chatId: ${output.chatId}]\n[chatUrl: ${output.chatUrl}]`,
						},
					],
					structuredContent: output,
				};
			},
			{ errorMessage: () => 'Nao agent failed to process the request.' },
		),
	);
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
		if (ownerId === userId) {
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

async function consumeStreamWithProgress(
	stream: ReadableStream<InferUIMessageChunk<UIMessage>>,
	extra: ToolExtra,
): Promise<string> {
	const progressToken = normalizeProgressToken(extra._meta?.progressToken);
	const seenToolCalls = new Set<string>();
	let progress = 0;
	let lastMessage: UIMessage | null = null;

	for await (const message of readUIMessageStream<UIMessage>({ stream })) {
		lastMessage = message;
		if (progressToken === undefined) {
			continue;
		}
		for (const part of message.parts) {
			if (!isToolPart(part) || seenToolCalls.has(part.toolCallId)) {
				continue;
			}
			if (part.state !== 'input-available' && part.state !== 'output-available') {
				continue;
			}
			seenToolCalls.add(part.toolCallId);
			await extra.sendNotification({
				method: 'notifications/progress',
				params: {
					progressToken,
					progress: ++progress,
					message: `[${toolNameFromPart(part)}]`,
				},
			});
		}
	}

	return extractFinalText(lastMessage);
}

function normalizeProgressToken(raw: unknown): string | number | undefined {
	return typeof raw === 'string' || typeof raw === 'number' ? raw : undefined;
}

function isToolPart(part: UIMessagePart): part is Extract<UIMessagePart, { toolCallId: string; state: string }> {
	return typeof part.type === 'string' && part.type.startsWith('tool-') && 'toolCallId' in part && 'state' in part;
}

function toolNameFromPart(part: { type: string }): string {
	return part.type.replace(/^tool-/, '');
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
