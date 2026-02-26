import { TRPCError } from '@trpc/server';
import { z } from 'zod/v4';

import * as memoryQueries from '../queries/memory';
import * as userQueries from '../queries/user.queries';
import { memoryService } from '../services/memory';
import { posthog, PostHogEvent } from '../services/posthog';
import { projectProtectedProcedure } from './trpc';

export const memoryRoutes = {
	setEnabled: projectProtectedProcedure
		.input(z.object({ memoryEnabled: z.boolean() }))
		.mutation(async ({ ctx, input }) => {
			await userQueries.setMemoryEnabled(ctx.user.id, input.memoryEnabled);
			posthog.capture(ctx.user.id, PostHogEvent.AgentMemoryEnabledUpdated, {
				project_id: ctx.project.id,
				memory_enabled: input.memoryEnabled,
			});
			return { memoryEnabled: input.memoryEnabled };
		}),

	edit: projectProtectedProcedure
		.input(
			z.object({
				memoryId: z.string(),
				content: z.string().trim().min(1).max(1000),
			}),
		)
		.mutation(async ({ ctx, input }) => {
			const content = memoryService.normalizeMemoryContent(input.content);
			if (!content) {
				throw new TRPCError({ code: 'BAD_REQUEST', message: 'Memory content cannot be empty.' });
			}
			const updated = await memoryQueries.updateUserMemoryContent(ctx.user.id, input.memoryId, content);
			if (!updated) {
				throw new TRPCError({ code: 'NOT_FOUND', message: 'Memory not found.' });
			}
			posthog.capture(ctx.user.id, PostHogEvent.AgentMemoryUpdated, {
				project_id: ctx.project.id,
				memory_id: input.memoryId,
				memory_category: updated.category,
			});
			return updated;
		}),

	delete: projectProtectedProcedure.input(z.object({ memoryId: z.string() })).mutation(async ({ ctx, input }) => {
		const deleted = await memoryQueries.deleteUserMemory(ctx.user.id, input.memoryId);
		if (!deleted) {
			throw new TRPCError({ code: 'NOT_FOUND', message: 'Memory not found.' });
		}
		posthog.capture(ctx.user.id, PostHogEvent.AgentMemoryDeleted, {
			project_id: ctx.project.id,
			memory_id: input.memoryId,
			memory_category: deleted.category,
		});
	}),
};
