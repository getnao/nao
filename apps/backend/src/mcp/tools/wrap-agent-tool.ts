import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { Tool } from 'ai';
import type { AnyZodObject } from 'zod/v3';

import type { McpContext, ToolResult } from '../logging';
import { defineMcpHandler } from '../logging';
import { runAgentTool } from './run-agent-tool';

export interface WrapAgentToolOptions<TAgentInput, TOutput, TMcpInput = TAgentInput> {
	name: string;
	agentTool: Tool<TAgentInput, TOutput>;
	title?: string;
	description?: string;
	inputSchema?: unknown;
	outputSchema?: unknown;
	_meta?: Record<string, unknown>;
	mapInput?: (input: TMcpInput) => TAgentInput;
	formatResult?: (args: { input: TMcpInput; output: TOutput; callLogId: string }) => Promise<ToolResult> | ToolResult;
}

export function registerAgentToolAsMcp<TAgentInput, TOutput, TMcpInput = TAgentInput>(
	server: McpServer,
	ctx: McpContext,
	options: WrapAgentToolOptions<TAgentInput, TOutput, TMcpInput>,
): void {
	const { name, agentTool, title, description, inputSchema, outputSchema, _meta, mapInput, formatResult } = options;

	const handler = defineMcpHandler<TMcpInput>(name, ctx, async (input, _extra, callLogId) => {
		const agentInput = mapInput ? mapInput(input) : (input as unknown as TAgentInput);
		const output = await runAgentTool(agentTool, agentInput, ctx);
		if (formatResult) {
			return formatResult({ input, output, callLogId });
		}
		return { content: [{ type: 'text' as const, text: JSON.stringify(output) }] };
	});

	server.registerTool(
		name,
		{
			title,
			description: description ?? agentTool.description,
			inputSchema: toMcpSchema(inputSchema ?? agentTool.inputSchema),
			outputSchema: toMcpSchema(outputSchema),
			_meta,
		},
		handler as Parameters<McpServer['registerTool']>[2],
	);
}

/** Casts any Zod schema to the AnyZodObject the MCP SDK expects. */
function toMcpSchema(schema: unknown): AnyZodObject | undefined {
	return schema as AnyZodObject | undefined;
}
