import { TRPCError } from '@trpc/server';
import { z } from 'zod/v4';

import {
	setAllProjectMcpToolsEnabledState,
	setProjectMcpToolEnabledState,
} from '../queries/project-mcp-tool-setting.queries';
import { mcpService } from '../services/mcp.service';
import { adminProtectedProcedure, projectProtectedProcedure, router } from './trpc';

export const mcpRoutes = router({
	getState: projectProtectedProcedure.query(async ({ ctx }) => {
		await mcpService.initializeMcpState(ctx.project.id);
		await mcpService.refreshToolAvailabilityForProject(ctx.project.id);
		return mcpService.cachedMcpState;
	}),

	reconnect: adminProtectedProcedure.mutation(async ({ ctx }) => {
		await mcpService.initializeMcpState(ctx.project.id);
		await mcpService.loadMcpState();
		return mcpService.cachedMcpState;
	}),

	toggleTool: adminProtectedProcedure
		.input(
			z.object({
				serverName: z.string(),
				toolName: z.string(),
				enabled: z.boolean(),
			}),
		)
		.mutation(async ({ ctx, input }) => {
			await setProjectMcpToolEnabledState({
				projectId: ctx.project.id,
				serverName: input.serverName,
				toolName: input.toolName,
				enabled: input.enabled,
			});
			await mcpService.refreshToolAvailabilityForProject(ctx.project.id);
			return mcpService.cachedMcpState;
		}),

	setAllTools: adminProtectedProcedure
		.input(
			z.object({
				serverName: z.string(),
				enabled: z.boolean(),
			}),
		)
		.mutation(async ({ ctx, input }) => {
			await mcpService.initializeMcpState(ctx.project.id);
			const server = mcpService.cachedMcpState[input.serverName];
			if (!server) {
				throw new TRPCError({
					code: 'NOT_FOUND',
					message: `MCP server '${input.serverName}' not found`,
				});
			}
			const toolNames = server.tools.map((tool) => tool.name);

			await setAllProjectMcpToolsEnabledState({
				projectId: ctx.project.id,
				serverName: input.serverName,
				toolNames,
				enabled: input.enabled,
			});
			await mcpService.refreshToolAvailabilityForProject(ctx.project.id);
			return mcpService.cachedMcpState;
		}),
});
