import { DOWNLOAD_FORMATS, type UserRole } from '@nao/shared/types';
import { TRPCError } from '@trpc/server';
import { z } from 'zod/v4';

import * as chatQueries from '../queries/chat.queries';
import * as projectQueries from '../queries/project.queries';
import * as sharedChatQueries from '../queries/shared-chat.queries';
import * as storyQueries from '../queries/story.queries';
import { logActivity } from '../services/activity';
import { getStoryQueryData } from '../services/live-story';
import { type UIChat } from '../types/chat';
import { logAnalyticsEvent } from '../utils/analytics-event';
import { notifySharedItemRecipients } from '../utils/email';
import { buildDownloadResponse } from '../utils/story-download';
import { canSendProcedure, protectedProcedure, resourceProjectProcedure } from './trpc';

const chatProcedure = resourceProjectProcedure('chatId', chatQueries.getChatInfo, 'Chat');
const shareProcedure = resourceProjectProcedure('shareId', sharedChatQueries.getSharedChatInfo, 'Shared chat');
const shareAccessProcedure = resourceProjectProcedure(
	'shareId',
	sharedChatQueries.getSharedChatInfo,
	'Shared chat',
	async (share, userId) => {
		if (share.visibility !== 'specific') {
			return true;
		}
		const isOwner = (await chatQueries.getChatOwnerId(share.chatId)) === userId;
		return isOwner || sharedChatQueries.canUserAccessSharedChat(share.id, userId);
	},
);

export const sharedChatRoutes = {
	list: protectedProcedure.query(async ({ ctx }) => {
		const projects = await projectQueries.listUserProjects(ctx.user.id);
		const projectIds = projects.map((p) => p.id);
		return sharedChatQueries.listUserSharedChats(projectIds, ctx.user.id);
	}),

	create: canSendProcedure
		.input(
			z.object({
				chatId: z.string(),
				visibility: z.enum(['project', 'specific']).default('project'),
				allowedUserIds: z.array(z.string()).optional(),
				notify: z.boolean().default(false),
			}),
		)
		.mutation(async ({ input, ctx }) => {
			const chatInfo = await chatQueries.getChatInfo(input.chatId);
			if (!chatInfo) {
				throw new TRPCError({ code: 'NOT_FOUND', message: 'Chat not found.' });
			}
			if (chatInfo.projectId !== ctx.project.id) {
				throw new TRPCError({ code: 'NOT_FOUND', message: 'Chat not found.' });
			}

			const created = await sharedChatQueries.createSharedChat(
				{
					chatId: input.chatId,
					visibility: input.visibility,
				},
				input.allowedUserIds,
			);

			await logActivity({
				projectId: ctx.project.id,
				userId: ctx.user.id,
				type: 'chat.shared',
				chatId: input.chatId,
				sharedChatId: created.id,
			});

			if (input.notify) {
				notifySharedItemRecipients({
					projectId: ctx.project.id,
					sharerId: ctx.user.id,
					sharerName: ctx.user.name,
					shareId: created.id,
					itemLabel: 'chat',
					itemTitle: chatInfo.title,
					visibility: input.visibility,
					allowedUserIds: input.allowedUserIds,
				}).catch((err) => console.error('Failed to notify shared chat recipients', err));
			}

			return created;
		}),

	getSharedChat: shareAccessProcedure.input(z.object({ shareId: z.string() })).query(
		async ({
			ctx,
		}): Promise<{
			share: sharedChatQueries.SharedChatWithDetails;
			chat: UIChat;
			userRole: UserRole | null;
		}> => {
			const [chat] = await chatQueries.getChat(ctx.resource.chatId, { includeFeedback: true });
			if (!chat) {
				throw new TRPCError({ code: 'NOT_FOUND', message: 'Chat not found.' });
			}

			if (ctx.user.id !== ctx.resource.userId) {
				logAnalyticsEvent({
					projectId: ctx.resource.projectId,
					type: 'page_view',
					assetType: 'chat',
					actorUserId: ctx.user.id,
					chatId: ctx.resource.chatId,
					sharedChatId: ctx.resource.id,
				});
			}

			return { share: ctx.resource, chat, userRole: ctx.userRole };
		},
	),

	getShareOptionsByChatId: chatProcedure.input(z.object({ chatId: z.string() })).query(async ({ input, ctx }) => {
		const share = await sharedChatQueries.getShareIdByChatId(input.chatId, ctx.user.id);
		if (!share) {
			return { shareId: null, visibility: null, allowedUserIds: [] };
		}

		const allowedUserIds =
			share.visibility === 'specific' ? await sharedChatQueries.getShareAllowedUserIds(share.id) : [];

		return { shareId: share.id, visibility: share.visibility, allowedUserIds };
	}),

	updateAccess: shareProcedure
		.input(z.object({ shareId: z.string(), allowedUserIds: z.array(z.string()) }))
		.mutation(async ({ input, ctx }) => {
			const chatOwnerId = await chatQueries.getChatOwnerId(ctx.resource.chatId);
			if (!chatOwnerId || (chatOwnerId !== ctx.user.id && ctx.userRole !== 'admin')) {
				throw new TRPCError({ code: 'FORBIDDEN', message: 'Only the creator or an admin can update this.' });
			}

			const projectMembers = await projectQueries.listAllUsersWithRoles(ctx.resource.projectId);
			const memberIds = new Set(projectMembers.map((m) => m.id));
			const validUserIds = input.allowedUserIds.filter((id) => memberIds.has(id));
			if (input.allowedUserIds.length > 0 && validUserIds.length === 0) {
				throw new TRPCError({ code: 'BAD_REQUEST', message: 'No valid project members in the provided list.' });
			}

			await sharedChatQueries.updateSharedChatAllowedUsers(input.shareId, validUserIds);

			notifySharedItemRecipients({
				projectId: ctx.resource.projectId,
				sharerId: ctx.user.id,
				sharerName: ctx.user.name,
				shareId: input.shareId,
				itemLabel: 'chat',
				itemTitle: ctx.resource.title || '',
				visibility: ctx.resource.visibility,
				allowedUserIds: validUserIds,
			}).catch((err) => console.error('Failed to notify shared chat recipients', err));
		}),

	delete: shareProcedure.input(z.object({ shareId: z.string() })).mutation(async ({ input, ctx }) => {
		const chatOwnerId = await chatQueries.getChatOwnerId(ctx.resource.chatId);
		if (!chatOwnerId || (chatOwnerId !== ctx.user.id && ctx.userRole !== 'admin')) {
			throw new TRPCError({ code: 'FORBIDDEN', message: 'Only the creator or an admin can delete this.' });
		}

		await sharedChatQueries.deleteSharedChat(input.shareId);
	}),

	downloadStory: shareAccessProcedure
		.input(
			z.object({
				shareId: z.string(),
				storySlug: z.string(),
				format: z.enum(DOWNLOAD_FORMATS),
				versionNumber: z.number().int().positive().optional(),
			}),
		)
		.query(async ({ input, ctx }) => {
			const share = ctx.resource;

			const version = input.versionNumber
				? await storyQueries.getVersionByNumber(share.chatId, input.storySlug, input.versionNumber)
				: await storyQueries.getLatestVersionByChatAndSlug(share.chatId, input.storySlug);
			if (!version) {
				throw new TRPCError({ code: 'NOT_FOUND', message: 'Story version not found.' });
			}

			const { queryData } = await getStoryQueryData(
				share.chatId,
				input.storySlug,
				version.code,
				version.isLive,
				version.cacheSchedule,
			);

			logAnalyticsEvent({
				projectId: share.projectId,
				type: 'download',
				assetType: 'story',
				actorUserId: ctx.user.id,
				storyId: version.storyId,
				chatId: share.chatId,
				sharedChatId: share.id,
				metadata: {
					type: 'download',
					format: input.format,
					versionNumber: version.version,
					title: version.title,
				},
			});

			return buildDownloadResponse(input.format, version.title, version.code, queryData);
		}),
};
