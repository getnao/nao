import { TRPCError } from '@trpc/server';
import { z } from 'zod/v4';

import * as chatQueries from '../queries/chat.queries';
import * as projectQueries from '../queries/project.queries';
import * as sharedChatQueries from '../queries/shared-chat.queries';
import { type UIChat } from '../types/chat';
import { notifySharedItemRecipients } from '../utils/email';
import { projectProtectedProcedure, protectedProcedure } from './trpc';

export const sharedChatRoutes = {
	list: projectProtectedProcedure.query(async ({ ctx }) => {
		return sharedChatQueries.listProjectSharedChats(ctx.project.id, ctx.user.id);
	}),

	create: projectProtectedProcedure
		.input(
			z.object({
				chatId: z.string(),
				visibility: z.enum(['project', 'specific']).default('project'),
				allowedUserIds: z.array(z.string()).optional(),
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

			return created;
		}),

	getSharedChat: protectedProcedure
		.input(z.object({ shareId: z.string() }))
		.query(async ({ input, ctx }): Promise<{ share: sharedChatQueries.SharedChatWithDetails; chat: UIChat }> => {
			const share = await sharedChatQueries.getSharedChatInfo(input.shareId);
			if (!share) {
				throw new TRPCError({ code: 'NOT_FOUND', message: 'Shared chat not found.' });
			}

			const project = await projectQueries.getProjectByUserId(ctx.user.id);
			if (!project || project.id !== share.projectId) {
				throw new TRPCError({ code: 'FORBIDDEN', message: 'You do not have access to this chat.' });
			}

			if (share.visibility === 'specific') {
				const isOwner = (await chatQueries.getChatOwnerId(share.chatId)) === ctx.user.id;
				if (!isOwner) {
					const hasAccess = await sharedChatQueries.canUserAccessSharedChat(share.id, ctx.user.id);
					if (!hasAccess) {
						throw new TRPCError({ code: 'FORBIDDEN', message: 'You do not have access to this chat.' });
					}
				}
			}

			const [chat] = await chatQueries.loadChat(share.chatId, { includeFeedback: true });
			if (!chat) {
				throw new TRPCError({ code: 'NOT_FOUND', message: 'Chat not found.' });
			}

			return { share, chat };
		}),

	getShareOptionsByChatId: protectedProcedure
		.input(z.object({ chatId: z.string() }))
		.query(async ({ input, ctx }) => {
			const share = await sharedChatQueries.getShareIdByChatId(input.chatId, ctx.user.id);
			if (!share) {
				return { shareId: null, visibility: null, allowedUserIds: [] };
			}

			const allowedUserIds =
				share.visibility === 'specific' ? await sharedChatQueries.getShareAllowedUserIds(share.id) : [];

			return { shareId: share.id, visibility: share.visibility, allowedUserIds };
		}),

	updateAccess: projectProtectedProcedure
		.input(z.object({ id: z.string(), allowedUserIds: z.array(z.string()) }))
		.mutation(async ({ input, ctx }) => {
			const share = await sharedChatQueries.getSharedChatInfo(input.id);
			if (!share) {
				throw new TRPCError({ code: 'NOT_FOUND', message: 'Shared chat not found.' });
			}
			if (share.projectId !== ctx.project.id) {
				throw new TRPCError({ code: 'FORBIDDEN', message: 'You do not have access to this chat.' });
			}

			const userId = await chatQueries.getChatOwnerId(share.chatId);
			if (!userId || (userId !== ctx.user.id && ctx.userRole !== 'admin')) {
				throw new TRPCError({ code: 'FORBIDDEN', message: 'Only the creator or an admin can update this.' });
			}

			const projectMembers = await projectQueries.getAllUsersWithRoles(ctx.project.id);
			const memberIds = new Set(projectMembers.map((m) => m.id));
			const validUserIds = input.allowedUserIds.filter((id) => memberIds.has(id));
			if (input.allowedUserIds.length > 0 && validUserIds.length === 0) {
				throw new TRPCError({ code: 'BAD_REQUEST', message: 'No valid project members in the provided list.' });
			}

			await sharedChatQueries.updateAllowedUsers(input.id, validUserIds);

			notifySharedItemRecipients({
				projectId: ctx.project.id,
				sharerId: ctx.user.id,
				sharerName: ctx.user.name,
				shareId: input.id,
				itemLabel: 'chat',
				itemTitle: share.title || '',
				visibility: share.visibility,
				allowedUserIds: validUserIds,
			}).catch((err) => console.error('Failed to notify shared chat recipients', err));
		}),

	delete: projectProtectedProcedure.input(z.object({ id: z.string() })).mutation(async ({ input, ctx }) => {
		const share = await sharedChatQueries.getSharedChatInfo(input.id);
		if (!share) {
			throw new TRPCError({ code: 'NOT_FOUND', message: 'Shared chat not found.' });
		}

		const chatOwnerId = await chatQueries.getChatOwnerId(share.chatId);
		if (!chatOwnerId || (chatOwnerId !== ctx.user.id && ctx.userRole !== 'admin')) {
			throw new TRPCError({ code: 'FORBIDDEN', message: 'Only the creator or an admin can delete this.' });
		}

		await sharedChatQueries.deleteSharedChat(input.id);
	}),
};
