import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

import * as chatQueries from '../../queries/chat.queries';
import type { AgentProgressEvent } from '../../services/agent';
import { agentService } from '../../services/agent';
import { mcpService } from '../../services/mcp';
import { skillService } from '../../services/skill';
import type { UIMessage } from '../../types/chat';
import { logger } from '../../utils/logger';
import type { McpContext, ToolExtra } from '../logging';
import { withLogging } from '../logging';
import { chatUrl } from '../urls';

export function registerAgentTools(server: McpServer, ctx: McpContext): void {
	server.registerTool(
		'ask_nao',
		{
			description:
				'Ask nao an analytics question in natural language. Creates a chat that is visible in the UI.\n\n' +
				'Use this for ad-hoc data exploration and Q&A. ' +
				'To create a persistent Nao Story (markdown dashboard with embedded charts/tables), do NOT ask nao in natural language — use `execute_sql` → `build_chart` → `create_story` instead. ' +
				'To browse or update existing stories, use `list_stories` / `get_story` / `update_story`.\n\n' +
				'Returns `chatId` and a `url` that opens the chat in the Nao UI — surface the URL to the user as a clickable link so they can jump to the conversation (and any rendered charts/tables). ' +
				'The returned `chatId` can also be passed to `create_story` as `chat_id` to attach a follow-up story to this conversation.',
			inputSchema: {
				question: z.string().describe('The analytics question'),
				conversation_id: z
					.string()
					.optional()
					.describe(
						'Existing chat ID to continue a conversation. Omit to start a new chat. ' +
							'Reuse the ID returned by a previous ask_nao call ONLY when the new question clearly builds on the previous nao exchange (same data, same topic). ' +
							'If the topic shifts or the prior nao reply was a refusal / off-topic, omit this to start a fresh chat — otherwise the follow-up inherits the prior context and may repeat the refusal.',
					),
			},
		},
		withLogging('ask_nao', ctx, async ({ question, conversation_id }, extra) => {
			try {
				await mcpService.initializeMcpState(ctx.projectId);
				await skillService.initializeSkills(ctx.projectId);

				const { chat, uiMessages } = await buildChatContext(
					ctx.projectId,
					ctx.userId,
					question,
					conversation_id,
				);

				const agent = await agentService.create(chat, undefined, ['story', 'suggest_follow_ups']);

				const progressToken = extra._meta?.progressToken;
				const result = await agent.streamWithProgress(uiMessages, makeProgressHandler(extra, progressToken));

				await chatQueries.upsertMessage({
					chatId: chat.id,
					role: 'assistant',
					parts: result.responseParts,
					tokenUsage: result.usage,
				});

				const url = chatUrl(chat.id);
				return {
					content: [
						{ type: 'text' as const, text: result.text },
						{ type: 'text' as const, text: `\n\n[conversation_id: ${chat.id}]\n[chat_url: ${url}]` },
					],
					toolOutput: { chatId: chat.id, text: result.text, url },
				};
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				logger.error(`MCP ask_nao error: ${message}`, {
					source: 'tool',
					context: { question, userId: ctx.userId },
				});
				return {
					content: [{ type: 'text' as const, text: 'Nao agent failed to process the request.' }],
					isError: true,
				};
			}
		}),
	);
}

async function buildChatContext(
	projectId: string,
	userId: string,
	question: string,
	conversationId: string | undefined,
): Promise<{ chat: { id: string; projectId: string; userId: string }; uiMessages: UIMessage[] }> {
	const userMessage: UIMessage = {
		id: crypto.randomUUID(),
		role: 'user',
		parts: [{ type: 'text', text: question }],
		source: 'mcp',
	};

	if (conversationId) {
		const ownerId = await chatQueries.getChatOwnerId(conversationId);
		if (ownerId === userId) {
			const history = await chatQueries.getChatMessages(conversationId);
			await chatQueries.upsertMessage({ ...userMessage, chatId: conversationId });
			return {
				chat: { id: conversationId, projectId, userId },
				uiMessages: [...history, userMessage],
			};
		}
	}

	const chatId = crypto.randomUUID();
	await chatQueries.createChat(
		{ id: chatId, projectId, userId, title: question.slice(0, 80) },
		{ text: question, source: 'mcp' },
	);
	return {
		chat: { id: chatId, projectId, userId },
		uiMessages: [userMessage],
	};
}

function makeProgressHandler(extra: ToolExtra, rawProgressToken: unknown) {
	const progressToken =
		typeof rawProgressToken === 'string' || typeof rawProgressToken === 'number' ? rawProgressToken : undefined;

	let chunkIndex = 0;

	return async (event: AgentProgressEvent) => {
		if (progressToken === undefined || event.type !== 'tool-call') {
			return;
		}

		await extra.sendNotification({
			method: 'notifications/progress',
			params: { progressToken, progress: ++chunkIndex, message: `[${event.toolName}]` },
		});
	};
}
