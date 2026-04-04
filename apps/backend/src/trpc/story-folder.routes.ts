import { TRPCError } from '@trpc/server';
import { z } from 'zod/v4';

import * as storyFolderQueries from '../queries/story-folder.queries';
import { protectedProcedure } from './trpc';

export const storyFolderRoutes = {
	list: protectedProcedure.query(async ({ ctx }) => {
		return storyFolderQueries.listFolders(ctx.user.id);
	}),

	create: protectedProcedure
		.input(
			z.object({
				name: z.string().min(1, 'Folder name is required').max(100, 'Folder name is too long'),
				color: z.string().nullable().optional(),
			}),
		)
		.mutation(async ({ ctx, input }) => {
			try {
				return await storyFolderQueries.createFolder(ctx.user.id, {
					name: input.name.trim(),
					color: input.color ?? null,
				});
			} catch (error) {
				if (error instanceof Error && error.message.includes('Maximum of')) {
					throw new TRPCError({ code: 'BAD_REQUEST', message: error.message });
				}
				if (error instanceof Error && (error.message.includes('UNIQUE') || error.message.includes('unique'))) {
					throw new TRPCError({ code: 'CONFLICT', message: 'A folder with this name already exists' });
				}
				throw new TRPCError({
					code: 'INTERNAL_SERVER_ERROR',
					message: 'Failed to create folder. Please try again.',
				});
			}
		}),

	update: protectedProcedure
		.input(
			z.object({
				id: z.string(),
				name: z.string().min(1).max(100).optional(),
				color: z.string().nullable().optional(),
			}),
		)
		.mutation(async ({ ctx, input }) => {
			const updateData: { name?: string; color?: string | null } = {};
			if (input.name !== undefined) {
				updateData.name = input.name.trim();
			}
			if (input.color !== undefined) {
				updateData.color = input.color;
			}

			try {
				const updated = await storyFolderQueries.updateFolder(ctx.user.id, input.id, updateData);
				if (!updated) {
					throw new TRPCError({ code: 'NOT_FOUND', message: 'Folder not found' });
				}
				return updated;
			} catch (error) {
				if (error instanceof TRPCError) {
					throw error;
				}
				if (error instanceof Error && (error.message.includes('UNIQUE') || error.message.includes('unique'))) {
					throw new TRPCError({ code: 'CONFLICT', message: 'A folder with this name already exists' });
				}
				throw new TRPCError({
					code: 'INTERNAL_SERVER_ERROR',
					message: 'Failed to update folder. Please try again.',
				});
			}
		}),

	delete: protectedProcedure.input(z.object({ id: z.string() })).mutation(async ({ ctx, input }) => {
		const deleted = await storyFolderQueries.deleteFolder(ctx.user.id, input.id);
		if (!deleted) {
			throw new TRPCError({ code: 'NOT_FOUND', message: 'Folder not found' });
		}
	}),
};
