import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import grepTool from '../../agents/tools/grep';
import listTool from '../../agents/tools/list';
import type { McpContext } from '../logging';
import { registerAgentToolAsMcp } from './wrap-agent-tool';

export function registerFileTools(server: McpServer, ctx: McpContext): void {
	registerAgentToolAsMcp(server, ctx, {
		name: 'grep',
		agentTool: grepTool,
		title: 'Search Files',
	});

	registerAgentToolAsMcp(server, ctx, {
		name: 'ls',
		agentTool: listTool,
		title: 'List Files',
	});
}
