import { mcpService } from '../services/mcp.service';
import { protectedProcedure, router } from './trpc';

export const mcpRoutes = router({
	getState: protectedProcedure.query(() => {
		return mcpService.cachedMcpState;
	}),

	reconnect: protectedProcedure.mutation(async () => {
		await mcpService.handleCacheMcpServerState();
		return mcpService.cachedMcpState;
	}),
});
