import { mcpService } from '../services/mcp.service';
import { adminProtectedProcedure, projectProtectedProcedure, router } from './trpc';

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
});
