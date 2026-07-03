import { mcpCall } from '@nao/shared/tools';

import { mcpService } from '../../services/mcp';
import { McpAuthRequiredError } from '../../services/mcp-oauth';
import { createTool } from '../../utils/tools';

const DESCRIPTION = [
	'Call a tool exposed by a configured MCP server.',
	'',
	'MCP tools are NOT preloaded into context. Each server has a folder /agent/mcps/<server>/ with one',
	'OpenAPI JSON file per available tool (the file name is the tool name). First discover the tool you',
	'need: list the server folder, then read (or grep) the relevant tool file (use the list, read and',
	"grep tools). Then call it here: set `tool` to the operation's operationId and `arguments` to an",
	"object that matches that operation's request body schema.",
	'',
	'Some servers require the user to connect their account first. If a call returns an AUTH_REQUIRED',
	'result, stop and ask the user to connect — a Connect button is shown to them automatically.',
].join('\n');

type McpContentBlock = { type: string; text?: string };

/** Output shape returned when the calling user must connect their account to an OAuth MCP server. */
export interface McpAuthRequiredOutput {
	mcpAuthRequired: true;
	server: string;
}

const isAuthRequired = (output: unknown): output is McpAuthRequiredOutput =>
	!!output && typeof output === 'object' && (output as McpAuthRequiredOutput).mcpAuthRequired === true;

const extractText = (output: unknown): string => {
	if (isAuthRequired(output)) {
		return [
			`AUTH_REQUIRED: The user has not connected their account to the MCP server "${output.server}".`,
			'Stop and ask the user to connect using the Connect button shown below the conversation.',
			'Do not retry this tool until they have connected.',
		].join(' ');
	}

	if (typeof output === 'string') {
		return output;
	}
	if (output && typeof output === 'object') {
		const content = (output as { content?: McpContentBlock[] }).content;
		if (Array.isArray(content)) {
			const text = content
				.filter((block) => block.type === 'text' && typeof block.text === 'string')
				.map((block) => block.text)
				.join('\n');
			if (text) {
				return text;
			}
		}
	}
	return JSON.stringify(output);
};

/** Single generic tool to invoke any discovered MCP tool, optionally restricted to `allowedServers`. */
export const createMcpCallTool = (allowedServers: string[] | null) =>
	createTool<mcpCall.Input, unknown>({
		description: DESCRIPTION,
		inputSchema: mcpCall.InputSchema,
		execute: async ({ server, tool, arguments: args }, context) => {
			try {
				return await mcpService.callTool({
					projectId: context.projectId,
					userId: context.userId,
					server,
					tool,
					args: args ?? {},
					allowedServers,
				});
			} catch (error) {
				if (error instanceof McpAuthRequiredError) {
					return { mcpAuthRequired: true, server: error.server } satisfies McpAuthRequiredOutput;
				}
				throw error;
			}
		},
		toModelOutput: ({ output }) => ({ type: 'text', value: extractText(output) }),
	});
