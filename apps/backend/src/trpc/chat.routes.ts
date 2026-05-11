import { executeSql } from '@nao/shared/tools';
import { CHAT_FILTER_OPTIONS, CHAT_GROUP_BY_OPTIONS, type GroupedChatListResponse } from '@nao/shared/types';
import { TRPCError } from '@trpc/server';
import { z } from 'zod/v4';

import { executeQuery } from '../agents/tools/execute-sql';
import type { SearchChatResult } from '../queries/chat.queries';
import * as chatQueries from '../queries/chat.queries';
import * as projectQueries from '../queries/project.queries';
import { agentService } from '../services/agent';
import { hasFeature, LICENSE_FEATURES } from '../services/license.service';
import { getAzureAccessTokenForUser } from '../services/microsoft-auth.service';
import { posthog, PostHogEvent } from '../services/posthog';
import type { ContextUsage, ForkMetadata, UIChat, UIMessagePart } from '../types/chat';
import { llmProviderSchema } from '../types/llm';
import { getChatContextUsage } from '../utils/chat-context-usage';
import { ownedResourceProcedure, projectProtectedProcedure, protectedProcedure } from './trpc';

const chatOwnerProcedure = ownedResourceProcedure(chatQueries.getChatOwnerId, 'chat');

export const chatRoutes = {
	get: protectedProcedure.input(z.object({ chatId: z.string() })).query(async ({ input, ctx }): Promise<UIChat> => {
		const [chat, userId] = await chatQueries.getChat(input.chatId, { includeFeedback: true });
		if (!chat) {
			throw new TRPCError({ code: 'NOT_FOUND', message: `Chat with id ${input.chatId} not found.` });
		}
		if (userId !== ctx.user.id) {
			throw new TRPCError({ code: 'FORBIDDEN', message: `You are not authorized to access this chat.` });
		}
		return chat;
	}),

	listGrouped: projectProtectedProcedure
		.input(
			z.object({
				groupBy: z.enum(CHAT_GROUP_BY_OPTIONS).default('none'),
				filters: z.array(z.enum(CHAT_FILTER_OPTIONS)).default(['all']),
			}),
		)
		.query(async ({ input, ctx }): Promise<GroupedChatListResponse> => {
			return chatQueries.listGroupedChats(ctx.user.id, input.groupBy, input.filters);
		}),

	search: protectedProcedure
		.input(z.object({ query: z.string().min(1).max(255), limit: z.number().min(1).max(50).optional() }))
		.query(async ({ input, ctx }): Promise<SearchChatResult[]> => {
			return chatQueries.searchUserChats(ctx.user.id, input.query, input.limit);
		}),

	delete: chatOwnerProcedure
		.input(z.object({ chatId: z.string() }))
		.mutation(async ({ input, ctx }): Promise<void> => {
			const { projectId } = await chatQueries.deleteChat(input.chatId);
			posthog.capture(ctx.user.id, PostHogEvent.ChatDeleted, { project_id: projectId, chat_id: input.chatId });
		}),

	stop: protectedProcedure.input(z.object({ chatId: z.string() })).mutation(async ({ input, ctx }): Promise<void> => {
		const agent = agentService.get(input.chatId);
		if (!agent) {
			throw new TRPCError({ code: 'NOT_FOUND', message: `Agent with id ${input.chatId} not found.` });
		}
		if (!agent.checkIsUserOwner(ctx.user.id)) {
			throw new TRPCError({ code: 'FORBIDDEN', message: 'You are not allowed to stop this agent.' });
		}

		agent.stop();

		const projectId = await chatQueries.getChatProjectId(input.chatId);
		posthog.capture(ctx.user.id, PostHogEvent.AgentStopped, { project_id: projectId, chat_id: input.chatId });
	}),

	rerunExecuteSqlToolCall: protectedProcedure
		.input(z.object({ toolCallId: z.string() }))
		.mutation(async ({ input, ctx }): Promise<{ chatId: string; messageId: string }> => {
			const toolCall = await chatQueries.getToolCallForRerun(input.toolCallId);
			if (!toolCall) {
				throw new TRPCError({ code: 'NOT_FOUND', message: 'Tool call not found.' });
			}
			if (toolCall.userId !== ctx.user.id) {
				throw new TRPCError({ code: 'FORBIDDEN', message: 'You are not authorized to modify this chat.' });
			}
			if (toolCall.toolName !== 'execute_sql') {
				throw new TRPCError({ code: 'BAD_REQUEST', message: 'Only execute_sql tool calls can be rerun.' });
			}
			if (toolCall.toolState !== 'output-available') {
				throw new TRPCError({ code: 'BAD_REQUEST', message: 'Only successful tool calls can be rerun.' });
			}

			const userRole = await projectQueries.getUserRoleInProject(toolCall.projectId, ctx.user.id);
			if (userRole !== 'admin' && userRole !== 'user') {
				throw new TRPCError({ code: 'FORBIDDEN', message: 'Viewers cannot rerun tool calls.' });
			}

			const parsedInput = executeSql.InputSchema.safeParse(toolCall.toolInput);
			if (!parsedInput.success) {
				throw new TRPCError({ code: 'BAD_REQUEST', message: 'Stored SQL tool input is invalid.' });
			}

			const [project, agentSettings, envVars, azureAccessToken] = await Promise.all([
				projectQueries.retrieveProjectById(toolCall.projectId),
				projectQueries.getAgentSettings(toolCall.projectId),
				projectQueries.getEnvVars(toolCall.projectId),
				hasFeature(LICENSE_FEATURES.sso).then((enabled) =>
					enabled ? getAzureAccessTokenForUser(ctx.user.id) : null,
				),
			]);

			const output = await executeQuery(parsedInput.data, {
				projectFolder: project.path ?? '',
				chatId: toolCall.chatId,
				agentSettings,
				envVars,
				azureAccessToken,
				queryResults: new Map(),
			});

			const toolPart: UIMessagePart = {
				type: 'tool-execute_sql',
				toolCallId: crypto.randomUUID(),
				state: 'output-available',
				input: parsedInput.data,
				output,
			};
			const { messageId } = await chatQueries.upsertMessage({
				chatId: toolCall.chatId,
				role: 'assistant',
				parts: [toolPart],
			});

			return { chatId: toolCall.chatId, messageId };
		}),

	rename: chatOwnerProcedure
		.input(z.object({ chatId: z.string(), title: z.string().min(1).max(255) }))
		.mutation(async ({ input, ctx }): Promise<void> => {
			const { projectId } = await chatQueries.renameChat(input.chatId, input.title);
			posthog.capture(ctx.user.id, PostHogEvent.ChatRenamed, { project_id: projectId, chat_id: input.chatId });
		}),

	deleteAllNonStarred: protectedProcedure.mutation(async ({ ctx }): Promise<{ count: number }> => {
		const { count } = await chatQueries.softDeleteNonStarredChats(ctx.user.id);
		posthog.capture(ctx.user.id, PostHogEvent.AllNonStarredChatsDeleted, { deleted_count: count });
		return { count };
	}),

	toggleStarred: chatOwnerProcedure
		.input(z.object({ chatId: z.string(), isStarred: z.boolean() }))
		.mutation(async ({ input }): Promise<void> => {
			await chatQueries.toggleStarred(input.chatId, input.isStarred);
		}),

	getForkMetadata: chatOwnerProcedure
		.input(z.object({ chatId: z.string() }))
		.query(async ({ input }): Promise<ForkMetadata | null> => {
			return chatQueries.getForkMetadata(input.chatId);
		}),

	getContextUsage: chatOwnerProcedure
		.input(
			z.object({
				chatId: z.string(),
				model: z
					.object({
						provider: llmProviderSchema,
						modelId: z.string(),
					})
					.optional(),
			}),
		)
		.query(async ({ input, ctx }): Promise<ContextUsage> => {
			const usage = await getChatContextUsage({
				chatId: input.chatId,
				userId: ctx.user.id,
				model: input.model,
			});
			if (!usage) {
				throw new TRPCError({ code: 'NOT_FOUND', message: `Chat with id ${input.chatId} not found.` });
			}
			return usage;
		}),
};
