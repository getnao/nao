import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { type InferUIMessageChunk, readUIMessageStream } from 'ai';
import { z } from 'zod';

import * as chatQueries from '../../queries/chat.queries';
import * as storyQueries from '../../queries/story.queries';
import { agentService } from '../../services/agent';
import { mcpService } from '../../services/mcp';
import { skillService } from '../../services/skill';
import type { UIMessage, UIMessagePart } from '../../types/chat';
import type { McpContext, ToolExtra } from '../logging';
import { chatUrl } from '../urls';
import { registerMcpTool } from './register-mcp-tool';

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
	'and give you full control over each step.\n\n';

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
			chatId: z
				.string()
				.describe(
					'UUID of the chat that holds this run. Pass to `create_story` / `update_story` to attach further work.',
				),
			chatUrl: z.url().describe('URL to open the chat in the nao UI.'),
			text: z.string().describe('The assistant final text response.'),
			queries: z
				.array(
					z.object({
						id: z.string().describe('`query_id` to pass to `display_chart`.'),
						columns: z
							.array(z.string())
							.describe(
								'Column names in the result — use these for `x_axis_key` and `series[].data_key`.',
							),
						row_count: z.number().describe('Total number of rows returned.'),
						preview: z
							.array(z.record(z.string(), z.unknown()))
							.describe('First 3 rows — useful to infer x_axis_type and chart_type.'),
					}),
				)
				.describe(
					'Every query the sub-agent executed, with schema metadata. Same shape as `execute_sql` output. ' +
						'Forward `id` to `display_chart` as `query_id`; pick `x_axis_key` / `series[].data_key` from `columns`.',
				),
			story_ids: z
				.array(z.string())
				.describe(
					'UUIDs of stories the sub-agent created or updated. Forward each one to `get_story` / `update_story` / `archive_story` / `delete_story`.',
				),
		},
		errorMessage: () => 'Nao agent failed to process the request.',
		handler: async ({ question, chatId }, extra) => {
			await mcpService.initializeMcpState(ctx.projectId);
			await skillService.initializeSkills(ctx.projectId);

			const { chat, uiMessages } = await buildChatContext(ctx.projectId, ctx.userId, question, chatId);

			const agent = await agentService.create(chat);
			const stream = agent.stream(uiMessages);
			const text = await consumeStreamWithProgress(stream, extra);

			const queries = agent.queryResultsSummary;
			const story_ids = await resolveStoryIds(agent.generatedArtifacts.stories, chat.id);

			const naoChatUrl = chatUrl(chat.id);
			const output = { chatId: chat.id, chatUrl: naoChatUrl, text, queries, story_ids };
			return {
				content: [
					{ type: 'text' as const, text: `${text}\n\n[chatId: ${chat.id}]\n[chatUrl: ${naoChatUrl}]` },
					{ type: 'text' as const, text: JSON.stringify({ queries, story_ids }) },
				],
				structuredContent: output,
			};
		},
	});
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
