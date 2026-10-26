import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import type { McpUserRole } from '../../types/mcp-endpoint';
import type { McpContext } from '../logging';

/**
 * Observability tools over the whole project, reserved to the roles that see chat replay and context
 * recommendations in the UI. They do not depend on the sub-agent or context-layer modes.
 */
export function registerContextAdminTools(_server: McpServer, ctx: McpContext): void {
	if (!canUseContextAdminTools(ctx.role)) {
		return;
	}
}

export function canUseContextAdminTools(role: McpUserRole): boolean {
	return role === 'admin' || role === 'context_admin';
}
