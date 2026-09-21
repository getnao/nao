import { TRPCError } from '@trpc/server';
import { z } from 'zod/v4';

import * as mcpEndpointQueries from '../queries/mcp-endpoint.queries';
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
			}),
		)
		.mutation(async ({ ctx, input }) => {
			return mcpEndpointQueries.updateMcpEndpointSettings(ctx.project.id, input);
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
