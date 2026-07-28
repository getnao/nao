import {
	CHAT_FILTER_OPTIONS,
	CHAT_GROUP_BY_OPTIONS,
	DOWNLOAD_FORMATS,
	type GroupedChatListResponse,
} from '@nao/shared/types';
import { TRPCError } from '@trpc/server';
import { z } from 'zod/v4';

import * as automationQueries from '../queries/automation.queries';
import type { SearchChatResult } from '../queries/chat.queries';
import * as chatQueries from '../queries/chat.queries';
import * as projectQueries from '../queries/project.queries';
import { agentService } from '../services/agent';
import { posthog, PostHogEvent } from '../services/posthog';
import type { ContextUsage, ForkMetadata, UIChat } from '../types/chat';
import { llmProviderSchema } from '../types/llm';
import { logAnalyticsEvent } from '../utils/analytics-event';
import { getChatContextUsage } from '../utils/chat-context-usage';
import { buildChatDownloadResponse } from '../utils/chat-download';
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

		if (chat.projectId) {
			logAnalyticsEvent({
				projectId: chat.projectId,
				type: 'page_view',
				assetType: 'chat',
				actorUserId: ctx.user.id,
				chatId: input.chatId,
			});
		}

		return {
			...chat,
			automationRun: (await automationQueries.getAutomationRunByChatId(input.chatId)) ?? undefined,
		};
	}),

	download: chatOwnerProcedure
		.input(
			z.object({
				chatId: z.string(),
				format: z.enum(DOWNLOAD_FORMATS).default('pdf'),
				includeErrors: z.boolean().default(false),
				includeSql: z.boolean().default(true),
				includePython: z.boolean().default(true),
			}),
		)
		.query(async ({ input, ctx }) => {
			const [chat] = await chatQueries.getChat(input.chatId);
			if (!chat) {
				throw new TRPCError({ code: 'NOT_FOUND', message: `Chat with id ${input.chatId} not found.` });
			}

			const displaySettings = chat.projectId ? await projectQueries.getDisplaySettings(chat.projectId) : null;

			const response = await buildChatDownloadResponse({
				chatId: chat.id,
				title: chat.title,
				createdAt: chat.createdAt,
				updatedAt: chat.updatedAt,
				messages: chat.messages,
				format: input.format,
				includeErrors: input.includeErrors,
				includeSql: input.includeSql,
				includePython: input.includePython,
				dateFormat: displaySettings?.dateFormat,
			});

			if (chat.projectId) {
				logAnalyticsEvent({
					projectId: chat.projectId,
					type: 'download',
					assetType: 'chat',
					actorUserId: ctx.user.id,
					chatId: chat.id,
					metadata: { type: 'download', format: input.format, title: chat.title },
				});
			}

			return response;
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

	cancel: chatOwnerProcedure.input(z.object({ chatId: z.string() })).mutation(
		async ({
			input,
			ctx,
		}): Promise<{
			outcome: 'deleted' | 'kept';
			chatDeleted: boolean;
		}> => {
			const agent = agentService.get(input.chatId);
			if (agent) {
				agent.stop();
				posthog.capture(ctx.user.id, PostHogEvent.AgentStopped, {
					project_id: agent.chat.projectId,
					chat_id: input.chatId,
				});
				await Promise.race([agent.waitUntilFinished(), delay(10_000)]);
			}

			return chatQueries.deleteLastEmptyTurn(input.chatId);
		},
	),

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

	switchMessageVersion: chatOwnerProcedure
		.input(z.object({ chatId: z.string(), messageId: z.string() }))
		.mutation(async ({ input }): Promise<void> => {
			await chatQueries.switchMessageVersion(input.chatId, input.messageId);
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

const delay = (milliseconds: number): Promise<void> =>
	new Promise((resolve) => {
		setTimeout(resolve, milliseconds);
	});
