import type { AnalyticsAssetType } from '@nao/shared/types';
import { ANALYTICS_ASSET_TYPES, CHAT_DOWNLOAD_FORMATS } from '@nao/shared/types';
import { TRPCError } from '@trpc/server';
import { z } from 'zod/v4';

import * as analyticsEventQueries from '../queries/analytics-event.queries';
import * as chatQueries from '../queries/chat.queries';
import * as storyQueries from '../queries/story.queries';
import { logAnalyticsEvent } from '../utils/analytics-event';
import { projectProtectedProcedure } from './trpc';

async function assertAssetOwnerOrAdmin(
	assetType: AnalyticsAssetType,
	chatId: string | null | undefined,
	storyId: string | null | undefined,
	projectId: string,
	userId: string,
	userRole: string | null,
): Promise<void> {
	if (assetType === 'chat' && chatId) {
		const assetProjectId = await chatQueries.getChatProjectId(chatId);
		if (assetProjectId !== projectId) {
			throw new TRPCError({ code: 'NOT_FOUND', message: 'Chat not found.' });
		}
		if (userRole === 'admin') {
			return;
		}
		const ownerId = await chatQueries.getChatOwnerId(chatId);
		if (ownerId !== userId) {
			throw new TRPCError({ code: 'FORBIDDEN', message: 'You are not authorized to view these analytics.' });
		}
		return;
	}

	if (assetType === 'story' && storyId) {
		const assetProjectId = await storyQueries.getStoryProjectId(storyId);
		if (assetProjectId !== projectId) {
			throw new TRPCError({ code: 'NOT_FOUND', message: 'Story not found.' });
		}
		if (userRole === 'admin') {
			return;
		}
		const ownerId = await storyQueries.getStoryOwnerId(storyId);
		if (ownerId !== userId) {
			throw new TRPCError({ code: 'FORBIDDEN', message: 'You are not authorized to view these analytics.' });
		}
		return;
	}

	throw new TRPCError({ code: 'BAD_REQUEST', message: 'chatId or storyId is required.' });
}

export const analyticsEventRoutes = {
	listForAsset: projectProtectedProcedure
		.input(
			z.object({
				assetType: z.enum(ANALYTICS_ASSET_TYPES),
				chatId: z.string().optional(),
				storyId: z.string().optional(),
				limit: z.number().int().min(1).max(200).default(100),
			}),
		)
		.query(async ({ input, ctx }) => {
			await assertAssetOwnerOrAdmin(
				input.assetType,
				input.chatId,
				input.storyId,
				ctx.project.id,
				ctx.user.id,
				ctx.userRole,
			);

			const rows = await analyticsEventQueries.listEventsForAsset({
				assetType: input.assetType,
				chatId: input.chatId,
				storyId: input.storyId,
				limit: input.limit,
			});

			return rows;
		}),

	logChatDownload: projectProtectedProcedure
		.input(
			z.object({
				chatId: z.string(),
				format: z.enum(CHAT_DOWNLOAD_FORMATS),
				queryId: z.string().optional(),
				title: z.string().optional(),
			}),
		)
		.mutation(async ({ input, ctx }) => {
			const projectId = await chatQueries.getChatProjectId(input.chatId);
			if (projectId !== ctx.project.id) {
				throw new TRPCError({ code: 'NOT_FOUND', message: 'Chat not found.' });
			}

			const canAccess = await chatQueries.canUserAccessChat(input.chatId, ctx.user.id);
			if (!canAccess) {
				throw new TRPCError({ code: 'FORBIDDEN', message: 'You are not authorized to access this chat.' });
			}

			void logAnalyticsEvent({
				projectId: ctx.project.id,
				type: 'download',
				assetType: 'chat',
				actorUserId: ctx.user.id,
				chatId: input.chatId,
				metadata: { type: 'download', format: input.format, queryId: input.queryId, title: input.title },
			});

			return { ok: true as const };
		}),
};
