import { TRPCError } from '@trpc/server';
import { z } from 'zod/v4';

import * as mcpEndpointQueries from '../queries/mcp-endpoint.queries';
import { posthog, PostHogEvent } from '../services/posthog';
import { llmSelectedModelSchema } from '../types/llm';
import { adminProtectedProcedure, projectProtectedProcedure, protectedProcedure, router } from './trpc';

export const mcpEndpointRoutes = router({
	getSettings: projectProtectedProcedure.query(async ({ ctx }) => {
		return mcpEndpointQueries.getMcpEndpointSettings(ctx.project.id);
	}),

	updateSettings: adminProtectedProcedure
		.input(
			z.object({
				enabled: z.boolean().optional(),
				subAgentModeEnabled: z.boolean().optional(),
				contextLayerModeEnabled: z.boolean().optional(),
				subAgentModel: llmSelectedModelSchema.nullable().optional(),
			}),
		)
		.mutation(async ({ ctx, input }) => {
			const settings = await mcpEndpointQueries.updateMcpEndpointSettings(ctx.project.id, input);
			posthog.capture(ctx.user.id, PostHogEvent.McpEndpointSettingsUpdated, {
				project_id: ctx.project.id,
				enabled: input.enabled,
				sub_agent_mode_enabled: input.subAgentModeEnabled,
				context_layer_mode_enabled: input.contextLayerModeEnabled,
				sub_agent_model: input.subAgentModel,
			});
			return settings;
		}),

	getCallLogs: adminProtectedProcedure.query(async ({ ctx }) => {
		return mcpEndpointQueries.getRecentMcpCallLogs(ctx.project.id);
	}),

	getBearerToken: protectedProcedure.query(({ ctx }) => {
		const token = ctx.session?.session?.token;
		if (!token) {
			throw new TRPCError({ code: 'UNAUTHORIZED', message: 'No active session.' });
		}
		return { token };
	}),
});
