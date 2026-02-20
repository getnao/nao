import { z } from 'zod';

import * as mcpConfigQueries from '../queries/project.queries';
import { mcpService } from '../services/mcp.service';
import { adminProtectedProcedure, projectProtectedProcedure, router } from './trpc';

const applyEnabledToolsUpdate = async (projectId: string, updater: (current: string[]) => string[]) => {
	await mcpConfigQueries.updateEnabledToolsAndKnownServers(projectId, ({ enabledTools, knownServers }) => ({
		enabledTools: updater(enabledTools),
		knownServers,
	}));
	await mcpService.refreshToolAvailability(projectId);
	return mcpService.cachedMcpState;
};

export const mcpRoutes = router({
	getState: projectProtectedProcedure.query(async ({ ctx }) => {
		await mcpService.initializeMcpState(ctx.project.id);
		return mcpService.cachedMcpState;
	}),

	reconnect: adminProtectedProcedure.mutation(async ({ ctx }) => {
		await mcpService.initializeMcpState(ctx.project.id);
		await mcpService.loadMcpState();
		return mcpService.cachedMcpState;
	}),

	toggleTool: adminProtectedProcedure
		.input(z.object({ toolName: z.string(), enabled: z.boolean() }))
		.mutation(({ ctx, input }) =>
			applyEnabledToolsUpdate(ctx.project.id, (current) =>
				input.enabled
					? [...new Set([...current, input.toolName])]
					: current.filter((t) => t !== input.toolName),
			),
		),

	setAllServerTools: adminProtectedProcedure
		.input(z.object({ serverName: z.string(), enabled: z.boolean() }))
		.mutation(({ ctx, input }) => {
			const serverTools = mcpService.cachedMcpState[input.serverName]?.tools.map((t) => t.name) ?? [];
			return applyEnabledToolsUpdate(ctx.project.id, (current) =>
				input.enabled
					? [...new Set([...current, ...serverTools])]
					: current.filter((t) => !serverTools.includes(t)),
			);
		}),
});
