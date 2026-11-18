import { MCP_SUB_AGENT_EXCLUDED_TOOLS } from '../tools';
import { analyticsToolsExcluding } from './analytics';
import type { AgentProfile } from './types';

/** The analytics agent answering `ask_nao` for an MCP client. */
export const mcpAgent: AgentProfile = {
	source: 'mcp',
	tools: analyticsToolsExcluding(MCP_SUB_AGENT_EXCLUDED_TOOLS),
};
