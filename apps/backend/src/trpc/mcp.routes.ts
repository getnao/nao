import { mcpService } from '../services/mcp.service';
import { adminProtectedProcedure, protectedProcedure, router } from './trpc';

export const mcpRoutes = router({
	getState: protectedProcedure.query(() => {
		return mcpService.cachedMcpState;
	}),

	reconnect: adminProtectedProcedure.mutation(async () => {
		await mcpService.handleCacheMcpServerState();
		return mcpService.cachedMcpState;
	}),
});
