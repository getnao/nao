import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { Tool, ToolExecutionOptions } from 'ai';
import type { AnyZodObject } from 'zod/v3';

import { getEnvVars, retrieveProjectById } from '../../queries/project.queries';
import { hasFeature, LICENSE_FEATURES } from '../../services/license.service';
import { getAzureAccessTokenForUser } from '../../services/microsoft-auth.service';
import type { ToolContext } from '../../types/tools';
import { logger } from '../../utils/logger';
import type { McpContext, ToolHandler } from '../logging';
import { withLogging } from '../logging';

export interface WrapAgentToolOptions<TInput, TOutput> {
	name: string;
	agentTool: Tool<TInput, TOutput>;
	title?: string;
	description?: string;
}

export function registerAgentToolAsMcp<TInput, TOutput>(
	server: McpServer,
	ctx: McpContext,
	options: WrapAgentToolOptions<TInput, TOutput>,
): void {
	const { name, agentTool, title, description = agentTool.description } = options;

	const handler: ToolHandler<TInput> = async (input) => {
		try {
			const toolContext = await buildMcpToolContext(ctx);
			const output = await agentTool.execute!(input, makeExecutionOptions(toolContext));
			return { content: [{ type: 'text' as const, text: JSON.stringify(output) }] };
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			logger.error(`MCP ${name} error: ${message}`, {
				source: 'tool',
				context: { input, userId: ctx.userId },
			});
			return { content: [{ type: 'text' as const, text: `${name} error: ${message}` }], isError: true };
		}
	};

	server.registerTool(
		name,
		{ title, description, inputSchema: agentTool.inputSchema as unknown as AnyZodObject },
		withLogging(name, ctx, handler) as Parameters<McpServer['registerTool']>[2],
	);
}

async function buildMcpToolContext(ctx: McpContext): Promise<ToolContext> {
	const project = await retrieveProjectById(ctx.projectId);
	const envVars = await getEnvVars(ctx.projectId);
	const azureAccessToken = (await hasFeature(LICENSE_FEATURES.sso))
		? await getAzureAccessTokenForUser(ctx.userId)
		: null;
	return {
		projectFolder: project.path ?? '',
		chatId: '',
		agentSettings: null,
		envVars,
		azureAccessToken,
		queryResults: new Map(),
		generatedArtifacts: { charts: [], stories: [] },
	};
}

function makeExecutionOptions(toolContext: ToolContext): ToolExecutionOptions & { experimental_context: ToolContext } {
	return { toolCallId: '', messages: [], experimental_context: toolContext };
}
