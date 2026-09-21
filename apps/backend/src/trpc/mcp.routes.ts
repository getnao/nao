import { TRPCError } from '@trpc/server';
import { z } from 'zod/v4';

import { claimMcpDiscoveryUser } from '../queries/mcp-oauth.queries';
import { setMcpServerEnabled, setMcpToolEnabled, setMcpToolsEnabled } from '../queries/project.queries';
import { mcpService } from '../services/mcp';
import { adminProtectedProcedure, canSendProcedure, projectProtectedProcedure, router } from './trpc';

export const mcpRoutes = router({
	getServers: projectProtectedProcedure.query(({ ctx }) => mcpService.getServersStatus(ctx.project.id, ctx.user.id)),

	getConfigError: projectProtectedProcedure.query(({ ctx }) => mcpService.getConfigError(ctx.project.id)),

	discover: adminProtectedProcedure.mutation(async ({ ctx }) => {
		await mcpService.discover(ctx.project.id);
		return mcpService.getServersStatus(ctx.project.id, ctx.user.id);
	}),

	discoverServer: canSendProcedure.input(z.object({ serverName: z.string() })).mutation(async ({ ctx, input }) => {
		if (ctx.userRole !== 'admin') {
			await claimFirstDiscovery(ctx.project.id, input.serverName, ctx.user.id);
		}
		await mcpService.discoverServer(ctx.project.id, input.serverName);
		return mcpService.getServersStatus(ctx.project.id, ctx.user.id);
	}),

	setServerEnabled: adminProtectedProcedure
		.input(z.object({ serverName: z.string(), enabled: z.boolean() }))
		.mutation(async ({ ctx, input }) => {
			await setMcpServerEnabled(ctx.project.id, input.serverName, input.enabled);
			await mcpService.applyEnablement(ctx.project.id, input.serverName);
			return mcpService.getServersStatus(ctx.project.id, ctx.user.id);
		}),

	setToolEnabled: adminProtectedProcedure
		.input(z.object({ serverName: z.string(), toolName: z.string(), enabled: z.boolean() }))
		.mutation(async ({ ctx, input }) => {
			await setMcpToolEnabled(ctx.project.id, `${input.serverName}/${input.toolName}`, input.enabled);
			await mcpService.applyEnablement(ctx.project.id, input.serverName);
			return mcpService.getServersStatus(ctx.project.id, ctx.user.id);
		}),

	setToolsEnabled: adminProtectedProcedure
		.input(z.object({ serverName: z.string(), toolNames: z.array(z.string()), enabled: z.boolean() }))
		.mutation(async ({ ctx, input }) => {
			const keys = input.toolNames.map((toolName) => `${input.serverName}/${toolName}`);
			await setMcpToolsEnabled(ctx.project.id, keys, input.enabled);
			await mcpService.applyEnablement(ctx.project.id, input.serverName);
			return mcpService.getServersStatus(ctx.project.id, ctx.user.id);
		}),
});

async function claimFirstDiscovery(projectId: string, serverName: string, userId: string): Promise<void> {
	if (await mcpService.hasDiscoveredTools(projectId, serverName)) {
		throw new TRPCError({ code: 'FORBIDDEN', message: 'Only admins can rediscover this server.' });
	}
	await claimMcpDiscoveryUser(projectId, serverName, userId);
}
