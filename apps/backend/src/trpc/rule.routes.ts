import { TRPCError } from '@trpc/server';
import { z } from 'zod/v4';

import * as memoryQueries from '../queries/memory';
import { memoryService } from '../services/memory';
import { posthog, PostHogEvent } from '../services/posthog';
import { projectProtectedProcedure } from './trpc';

const MAX_RULE_LENGTH = 1000;

export const ruleRoutes = {
	list: projectProtectedProcedure.query(async ({ ctx }) => {
		return memoryQueries.getUserRules(ctx.user.id, ctx.project.id);
	}),

	create: projectProtectedProcedure
		.input(z.object({ content: z.string().trim().min(1).max(MAX_RULE_LENGTH) }))
		.mutation(async ({ ctx, input }) => {
			const content = memoryService.normalizeMemoryContent(input.content);
			if (!content) {
				throw new TRPCError({ code: 'BAD_REQUEST', message: 'Rule content cannot be empty.' });
			}
			const rule = await memoryQueries.createUserRule(ctx.user.id, ctx.project.id, content);
			posthog.capture(ctx.user.id, PostHogEvent.AgentMemoryUpdated, {
				project_id: ctx.project.id,
				memory_id: rule.id,
				memory_category: rule.category,
			});
			return rule;
		}),

	update: projectProtectedProcedure
		.input(z.object({ ruleId: z.string(), content: z.string().trim().min(1).max(MAX_RULE_LENGTH) }))
		.mutation(async ({ ctx, input }) => {
			const content = memoryService.normalizeMemoryContent(input.content);
			if (!content) {
				throw new TRPCError({ code: 'BAD_REQUEST', message: 'Rule content cannot be empty.' });
			}
			const updated = await memoryQueries.updateUserMemoryContent(ctx.user.id, input.ruleId, content);
			if (!updated) {
				throw new TRPCError({ code: 'NOT_FOUND', message: 'Rule not found.' });
			}
			posthog.capture(ctx.user.id, PostHogEvent.AgentMemoryUpdated, {
				project_id: ctx.project.id,
				memory_id: input.ruleId,
				memory_category: updated.category,
			});
			return updated;
		}),

	delete: projectProtectedProcedure.input(z.object({ ruleId: z.string() })).mutation(async ({ ctx, input }) => {
		const deleted = await memoryQueries.deleteUserMemory(ctx.user.id, input.ruleId);
		if (!deleted) {
			throw new TRPCError({ code: 'NOT_FOUND', message: 'Rule not found.' });
		}
		posthog.capture(ctx.user.id, PostHogEvent.AgentMemoryDeleted, {
			project_id: ctx.project.id,
			memory_id: input.ruleId,
			memory_category: deleted.category,
		});
	}),
};
