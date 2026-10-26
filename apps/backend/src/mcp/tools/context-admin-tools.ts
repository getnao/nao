import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import type { McpUserRole } from '../../types/mcp-endpoint';
import type { McpContext } from '../logging';
import { registerChatHistoryTools } from './chat-history';

/**
 * Observability tools over the whole project, reserved to the roles that see chat replay and context
 * recommendations in the UI. They do not depend on the sub-agent or context-layer modes.
 */
export function registerContextAdminTools(server: McpServer, ctx: McpContext): void {
	if (!canUseContextAdminTools(ctx.role)) {
		return;
	}
	registerChatHistoryTools(server, ctx);
}

export function canUseContextAdminTools(role: McpUserRole): boolean {
	return role === 'admin' || role === 'context_admin';
}
