import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
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
	'Ask nao an analytics question in natural language. Creates a chat that is visible in the UI.\n\n' +
	'Use this for ad-hoc data exploration and Q&A. ' +
	'Returns `chatId` and a `url` that opens the chat in the Nao UI — surface the URL to the user as a clickable link so they can jump to the conversation (and any rendered charts/tables). ' +
	'The returned `chatId` can also be passed to `create_story` as `chat_id` to attach a follow-up story to this conversation.';

export function registerAgentTools(server: McpServer, ctx: McpContext): void {
	server.registerTool(
		'ask_nao',
		{
			title: 'Ask Nao',
			description: ASK_NAO_DESCRIPTION,
			inputSchema: {
				question: z.string().describe('The analytics question.'),
				chatId: z
					.uuid()
					.optional()
					.describe(
						'UUID of an existing chat to continue. Omit to start a new chat. ' +
							'Reuse the UUID from a previous ask_nao ONLY when the new question clearly builds on the same data and topic. ' +
							'If the topic shifts or the prior reply was a refusal, omit it — inheriting that context may cause the follow-up to repeat the refusal.',
					),
			},
			outputSchema: {
				chatId: z.uuid().describe('UUID of the chat in which the question was answered.'),
				chatUrl: z.url().describe('URL to open the chat (and rendered charts/tables) in the Nao UI.'),
				text: z.string().describe('The assistant final text response.'),
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

				const output = { chatId: chat.id, chatUrl: chatUrl(chat.id), text };
				ctx.sessionChatRef.lastChatId = chat.id;
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
