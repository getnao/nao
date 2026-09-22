import { mcpConnect } from '@nao/shared/tools';

import { mcpService } from '../../services/mcp';
import { McpAuthRequiredError } from '../../services/mcp-oauth';
import { createTool } from '../../utils/tools';
import { authRequiredOutput, authRequiredText, isAuthRequired } from './mcp-call';

const DESCRIPTION = [
	'Connect an MCP server so its tools become usable, and list the tools it exposes.',
	'',
	'Use this when a server folder under /agent/mcps/ is empty or missing: its tools have not been',
	'discovered yet, which does not mean the server has none. Use it too when a call returned',
	'AUTH_REQUIRED. If the user must connect their account, a Connect button appears in the chat —',
	'stop there and let them connect, then read the tool specs and call the tool with `mcp_call`.',
].join('\n');

interface McpConnectedOutput {
	server: string;
	tools: string[];
}

const isConnected = (output: unknown): output is McpConnectedOutput =>
	!!output && typeof output === 'object' && Array.isArray((output as McpConnectedOutput).tools);

const connectedText = ({ server, tools }: McpConnectedOutput): string => {
	if (tools.length === 0) {
		return `Connected to "${server}", but it exposes no tool you are allowed to use.`;
	}
	return [
		`Connected to "${server}". Its tools are now available: ${tools.join(', ')}.`,
		`Read /agent/mcps/${server}/<tool>.json for a tool's request schema, then invoke it with mcp_call.`,
	].join(' ');
};

const extractText = (output: unknown): string => {
	if (isAuthRequired(output)) {
		return authRequiredText(output.server);
	}
	if (isConnected(output)) {
		return connectedText(output);
	}
	return JSON.stringify(output);
};

/** Connects a server on behalf of the chatting user, so a project no admin ever connected still works. */
export const createMcpConnectTool = (allowedServers: string[] | null) =>
	createTool<mcpConnect.Input, unknown>({
		description: DESCRIPTION,
		inputSchema: mcpConnect.InputSchema,
		execute: async ({ server }, context) => {
			if (allowedServers && !allowedServers.includes(server)) {
				throw new Error(`MCP server "${server}" is not available in this context.`);
			}
			try {
				const tools = await mcpService.connectForUser({
					projectId: context.projectId,
					userId: context.userId,
					server,
				});
				return { server, tools } satisfies McpConnectedOutput;
			} catch (error) {
				if (error instanceof McpAuthRequiredError) {
					return authRequiredOutput(error.server);
				}
				throw error;
			}
		},
		toModelOutput: ({ output }) => ({ type: 'text', value: extractText(output) }),
	});
