import { TRPCError } from '@trpc/server';
import { z } from 'zod/v4';

import * as chatQueries from '../queries/chat.queries';
import * as projectQueries from '../queries/project.queries';
import * as sharedChatQueries from '../queries/shared-chat.queries';
import { type UIChat } from '../types/chat';
import { notifySharedItemRecipients } from '../utils/email';
import { projectProtectedProcedure, resourceProjectProcedure } from './trpc';

const chatProcedure = resourceProjectProcedure('chatId', chatQueries.getChatInfo, 'Chat');
const shareProcedure = resourceProjectProcedure('shareId', sharedChatQueries.getSharedChatInfo, 'Shared chat');

export const sharedChatRoutes = {
	list: projectProtectedProcedure.query(async ({ ctx }) => {
		return sharedChatQueries.listProjectSharedChats(ctx.project.id, ctx.user.id);
	}),

	create: chatProcedure
		.input(
			z.object({
				chatId: z.string(),
				visibility: z.enum(['project', 'specific']).default('project'),
				allowedUserIds: z.array(z.string()).optional(),
			}),
		)
		.mutation(async ({ input, ctx }) => {
			const created = await sharedChatQueries.createSharedChat(
				{
					chatId: input.chatId,
					visibility: input.visibility,
				},
				input.allowedUserIds,
			);

			notifySharedItemRecipients({
				projectId: ctx.resource.projectId,
				sharerId: ctx.user.id,
				sharerName: ctx.user.name,
				shareId: created.id,
				itemLabel: 'chat',
				itemTitle: ctx.resource.title,
				visibility: input.visibility,
				allowedUserIds: input.allowedUserIds,
			}).catch((err) => console.error('Failed to notify shared chat recipients', err));

			return created;
		}),

	getSharedChat: shareProcedure
		.input(z.object({ shareId: z.string() }))
		.query(async ({ ctx }): Promise<{ share: sharedChatQueries.SharedChatWithDetails; chat: UIChat }> => {
			if (ctx.resource.visibility === 'specific') {
				const isOwner = (await chatQueries.getChatOwnerId(ctx.resource.chatId)) === ctx.user.id;
				if (!isOwner) {
					const hasAccess = await sharedChatQueries.canUserAccessSharedChat(ctx.resource.id, ctx.user.id);
					if (!hasAccess) {
						throw new TRPCError({ code: 'FORBIDDEN', message: 'You do not have access to this chat.' });
					}
				}
			}

			const [chat] = await chatQueries.getChat(ctx.resource.chatId, { includeFeedback: true });
			if (!chat) {
				throw new TRPCError({ code: 'NOT_FOUND', message: 'Chat not found.' });
			}

			return { share: ctx.resource, chat };
		}),

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
};
