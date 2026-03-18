import { TRPCError } from '@trpc/server';
import { z } from 'zod/v4';

import * as chatQueries from '../queries/chat.queries';
import * as projectQueries from '../queries/project.queries';
import * as sharedChatQueries from '../queries/shared-chat.queries';
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
			const chatExists = await chatQueries.checkChatExists(input.chatId);
			if (!chatExists) {
				throw new TRPCError({ code: 'NOT_FOUND', message: 'Chat not found.' });
			}

			const created = await sharedChatQueries.createSharedChat(
				{
					projectId: ctx.project.id,
					userId: ctx.user.id,
					chatId: input.chatId,
					visibility: input.visibility,
				},
				input.allowedUserIds,
			);

			// TODO: notifySharedChatRecipients

			return created;
		}),

	get: protectedProcedure.input(z.object({ id: z.string() })).query(async ({ input, ctx }) => {
		const share = await sharedChatQueries.getSharedChat(input.id);
		if (!share) {
			throw new TRPCError({ code: 'NOT_FOUND', message: 'Shared chat not found.' });
		}

		const member = await projectQueries.getProjectMember(share.projectId, ctx.user.id);
		if (!member) {
			throw new TRPCError({ code: 'FORBIDDEN', message: 'You do not have access to this chat.' });
		}

		if (share.visibility === 'specific' && share.userId !== ctx.user.id) {
			const hasAccess = await sharedChatQueries.canUserAccessSharedChat(share.id, ctx.user.id);
			if (!hasAccess) {
				throw new TRPCError({ code: 'FORBIDDEN', message: 'You do not have access to this chat.' });
			}
		}

		return share;
	}),

	findByChat: protectedProcedure.input(z.object({ chatId: z.string() })).query(async ({ input, ctx }) => {
		const share = await sharedChatQueries.findByChat(input.chatId, ctx.user.id);
		if (!share) {
			return { shareId: null, visibility: null, allowedUserIds: [] };
		}

		const allowedUserIds =
			share.visibility === 'specific' ? await sharedChatQueries.getSharedChatAllowedUserIds(share.id) : [];

		return { shareId: share.id, visibility: share.visibility, allowedUserIds };
	}),

	updateAccess: projectProtectedProcedure
		.input(z.object({ id: z.string(), allowedUserIds: z.array(z.string()) }))
		.mutation(async ({ input, ctx }) => {
			const share = await sharedChatQueries.getSharedChat(input.id);
			if (!share) {
				throw new TRPCError({ code: 'NOT_FOUND', message: 'Shared chat not found.' });
			}

			if (share.projectId !== ctx.project.id) {
				throw new TRPCError({ code: 'FORBIDDEN', message: 'You do not have access to this chat.' });
			}

			if (share.userId !== ctx.user.id && ctx.userRole !== 'admin') {
				throw new TRPCError({ code: 'FORBIDDEN', message: 'Only the creator or an admin can update this.' });
			}

			await sharedChatQueries.updateAllowedUsers(input.id, input.allowedUserIds);

			// TODO: notifySharedChatRecipients
		}),

	delete: projectProtectedProcedure.input(z.object({ id: z.string() })).mutation(async ({ input, ctx }) => {
		const share = await sharedChatQueries.getSharedChat(input.id);
		if (!share) {
			throw new TRPCError({ code: 'NOT_FOUND', message: 'Shared chat not found.' });
		}

		if (share.userId !== ctx.user.id && ctx.userRole !== 'admin') {
			throw new TRPCError({ code: 'FORBIDDEN', message: 'Only the creator or an admin can delete this.' });
		}

		await sharedChatQueries.deleteSharedChat(input.id);
	}),
};
