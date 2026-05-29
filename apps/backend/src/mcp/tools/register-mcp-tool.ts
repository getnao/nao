import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { Tool } from 'ai';
import type { AnyZodObject } from 'zod/v3';

import { logger } from '../../utils/logger';
import { type LoggedToolHandler, type McpContext, type ToolResult, withLogging } from '../logging';
import { runAgentTool } from './run-agent-tool';

export interface RegisterMcpToolOptions {
	name: string;
	title?: string;
	description: string;
	inputSchema?: unknown;
	outputSchema?: unknown;
	_meta?: Record<string, unknown>;
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	handler: LoggedToolHandler<any>;
	errorMessage?: (error: unknown) => string;
}

export interface WrapAgentToolOptions<TAgentInput, TOutput, TMcpInput = TAgentInput> {
	name: string;
	agentTool: Tool<TAgentInput, TOutput>;
	title?: string;
	description?: string;
	inputSchema?: unknown;
	outputSchema?: unknown;
	_meta?: Record<string, unknown>;
	mapInput?: (input: TMcpInput) => TAgentInput;
	resolveChatId?: (input: TMcpInput) => string | null;
	formatResult?: (args: { input: TMcpInput; output: TOutput; callLogId: string }) => Promise<ToolResult> | ToolResult;
}

export function registerMcpTool(server: McpServer, ctx: McpContext, opts: RegisterMcpToolOptions): void {
	server.registerTool(
		opts.name,
		{
			title: opts.title,
			description: opts.description,
			inputSchema: toMcpSchema(opts.inputSchema),
			outputSchema: toMcpSchema(opts.outputSchema),
			_meta: opts._meta,
		},
		buildMcpHandler(opts.name, ctx, opts.handler, {
			errorMessage: opts.errorMessage,
		}) as Parameters<McpServer['registerTool']>[2],
	);
}

export function registerAgentToolAsMcp<TAgentInput, TOutput, TMcpInput = TAgentInput>(
	server: McpServer,
	ctx: McpContext,
	options: WrapAgentToolOptions<TAgentInput, TOutput, TMcpInput>,
): void {
	registerMcpTool(server, ctx, {
		name: options.name,
		title: options.title,
		description: options.description ?? options.agentTool.description ?? '',
		inputSchema: options.inputSchema ?? options.agentTool.inputSchema,
		outputSchema: options.outputSchema,
		_meta: options._meta,
		handler: async (input, _extra, callLogId) => {
			const agentInput = options.mapInput ? options.mapInput(input) : (input as unknown as TAgentInput);
			const chatId = options.resolveChatId ? options.resolveChatId(input) : undefined;
			const output = await runAgentTool(options.agentTool, agentInput, ctx, chatId);
			if (options.formatResult) {
				return options.formatResult({ input, output, callLogId });
			}
			return {
				content: [{ type: 'text' as const, text: JSON.stringify(output) }],
				structuredContent: output as Record<string, unknown>,
			};
		},
	});
}

function buildMcpHandler(
	name: string,
	ctx: McpContext,
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	fn: LoggedToolHandler<any>,
	opts?: { errorMessage?: (error: unknown) => string },
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
): LoggedToolHandler<any> {
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	const handler: LoggedToolHandler<any> = async (input, extra, callLogId) => {
		try {
			return await fn(input, extra, callLogId);
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			logger.error(`MCP ${name} error: ${message}`, {
				source: 'tool',
				context: { userId: ctx.userId, hasInput: input !== undefined },
			});
			const text = opts?.errorMessage ? opts.errorMessage(error) : `${name} failed. Please try again.`;
			return { content: [{ type: 'text' as const, text }], isError: true };
		}
	};
	return withLogging(name, ctx, handler);
}

function toMcpSchema(schema: unknown): AnyZodObject | undefined {
	return schema as AnyZodObject | undefined;
}
