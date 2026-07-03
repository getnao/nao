import { mcpCall } from '@nao/shared/tools';

import { McpArgsValidationError, mcpService } from '../../services/mcp';
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
	'`arguments` are validated against that schema before the call runs. A VALIDATION_ERROR result',
	'means the arguments are malformed — read the reported issues, fix them, and call again.',
	'',
	'Some servers require the user to connect their account first. If a call returns an AUTH_REQUIRED',
	'result, stop and ask the user to connect — a Connect button is shown to them automatically.',
].join('\n');

type McpContentBlock = { type: string; text?: string };
const MCP_AUTH_REQUIRED_MARKER = Symbol('nao.mcp.authRequired');

/** Output shape returned when the calling user must connect their account to an OAuth MCP server. */
export interface McpAuthRequiredOutput {
	mcpAuthRequired: true;
	server: string;
	[MCP_AUTH_REQUIRED_MARKER]: true;
}

/** Output shape returned when the call arguments fail schema validation before dispatch. */
export interface McpValidationErrorOutput {
	mcpValidationError: true;
	server: string;
	tool: string;
	issues: string[];
}

const authRequiredOutput = (server: string): McpAuthRequiredOutput => ({
	mcpAuthRequired: true,
	server,
	[MCP_AUTH_REQUIRED_MARKER]: true,
});

const isAuthRequired = (output: unknown): output is McpAuthRequiredOutput =>
	!!output &&
	typeof output === 'object' &&
	(output as Partial<McpAuthRequiredOutput>)[MCP_AUTH_REQUIRED_MARKER] === true;

const isValidationError = (output: unknown): output is McpValidationErrorOutput =>
	!!output && typeof output === 'object' && (output as McpValidationErrorOutput).mcpValidationError === true;

const extractText = (output: unknown): string => {
	if (isAuthRequired(output)) {
		return [
			`AUTH_REQUIRED: The user has not connected their account to the MCP server "${output.server}".`,
			'Stop and ask the user to connect using the Connect button shown below the conversation.',
			'Do not retry this tool until they have connected.',
		].join(' ');
	}

	if (isValidationError(output)) {
		return [
			`VALIDATION_ERROR: The arguments for tool "${output.tool}" on server "${output.server}" do not match its schema:`,
			...output.issues.map((issue) => `- ${issue}`),
			`Fix the arguments to match the tool spec (/agent/mcps/${output.server}/${output.tool}.json) and call again.`,
		].join('\n');
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
					return authRequiredOutput(error.server);
				}
				if (error instanceof McpArgsValidationError) {
					return {
						mcpValidationError: true,
						server: error.server,
						tool: error.tool,
						issues: error.issues,
					} satisfies McpValidationErrorOutput;
				}
				throw error;
			}
		},
		toModelOutput: ({ output }) => ({ type: 'text', value: extractText(output) }),
	});
