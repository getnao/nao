import { TRPCError } from '@trpc/server';
import { z } from 'zod/v4';

import * as chatQueries from '../queries/chat.queries';
import * as projectQueries from '../queries/project.queries';
import * as sharedChatQueries from '../queries/shared-chat.queries';
import { type UIChat } from '../types/chat';
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

			const chatId = await chatQueries.getChatProjectId(input.chatId);
			if (!chatId || chatId !== ctx.project.id) {
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

	getChat: protectedProcedure
		.input(z.object({ shareId: z.string() }))
		.query(async ({ input, ctx }): Promise<UIChat> => {
			const share = await sharedChatQueries.getSharedChat(input.shareId);
			if (!share) {
				throw new TRPCError({ code: 'NOT_FOUND', message: 'Shared chat not found.' });
			}

			assertCanAccessShare(share, ctx.user.id);

			const [chat] = await chatQueries.loadChat(share.chatId, { includeFeedback: true });
			if (!chat) {
				throw new TRPCError({ code: 'NOT_FOUND', message: 'Chat not found.' });
			}

			return chat;
		}),

	get: protectedProcedure.input(z.object({ id: z.string() })).query(async ({ input, ctx }) => {
		const share = await sharedChatQueries.getSharedChat(input.id);
		if (!share) {
			throw new TRPCError({ code: 'NOT_FOUND', message: 'Shared chat not found.' });
		}

		assertCanAccessShare(share, ctx.user.id);

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

			const projectMembers = await projectQueries.getAllUsersWithRoles(ctx.project.id);
			const memberIds = new Set(projectMembers.map((m) => m.id));
			const validUserIds = input.allowedUserIds.filter((id) => memberIds.has(id));
			if (input.allowedUserIds.length > 0 && validUserIds.length === 0) {
				throw new TRPCError({ code: 'BAD_REQUEST', message: 'No valid project members in the provided list.' });
			}

			await sharedChatQueries.updateAllowedUsers(input.id, validUserIds);
		}),

	delete: projectProtectedProcedure.input(z.object({ id: z.string() })).mutation(async ({ input, ctx }) => {
		const share = await sharedChatQueries.getSharedChat(input.id);
		if (!share) {
			throw new TRPCError({ code: 'NOT_FOUND', message: 'Shared chat not found.' });
		}

		if (share.projectId !== ctx.project.id) {
			throw new TRPCError({ code: 'FORBIDDEN', message: 'You do not have access to this chat.' });
		}

		if (share.userId !== ctx.user.id && ctx.userRole !== 'admin') {
			throw new TRPCError({ code: 'FORBIDDEN', message: 'Only the creator or an admin can delete this.' });
		}

		await sharedChatQueries.deleteSharedChat(input.id);
	}),
};

async function assertCanAccessShare(share: sharedChatQueries.SharedChatWithDetails, userId: string) {
	const member = await projectQueries.getProjectMember(share.projectId, userId);
	if (!member) {
		throw new TRPCError({ code: 'FORBIDDEN', message: 'You do not have access to this chat.' });
	}
	if (share.visibility === 'specific' && share.userId !== userId) {
		const hasAccess = await sharedChatQueries.canUserAccessSharedChat(share.id, userId);
		if (!hasAccess) {
			throw new TRPCError({ code: 'FORBIDDEN', message: 'You do not have access to this chat.' });
		}
	}
}
