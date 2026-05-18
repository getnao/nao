import type { Tool, ToolExecutionOptions } from 'ai';

import { getAgentSettings, getEnvVars, retrieveProjectById } from '../../queries/project.queries';
import { hasFeature, LICENSE_FEATURES } from '../../services/license.service';
import { getAzureAccessTokenForUser } from '../../services/microsoft-auth.service';
import type { ToolContext } from '../../types/tools';
import type { McpContext } from '../logging';

export async function runAgentTool<I, O>(tool: Tool<I, O>, input: I, ctx: McpContext): Promise<O> {
	if (!tool.execute) {
		throw new Error(`Agent tool has no execute function`);
	}
	const toolContext = await buildToolContext(ctx);
	return tool.execute(input, makeExecutionOptions(toolContext)) as Promise<O>;
}

async function buildToolContext(ctx: McpContext): Promise<ToolContext> {
	const project = await retrieveProjectById(ctx.projectId);
	if (!project.path) {
		throw new Error('Project path not configured. Run `nao sync` first.');
	}
	const [envVars, agentSettings, azureAccessToken] = await Promise.all([
		getEnvVars(ctx.projectId),
		getAgentSettings(ctx.projectId),
		hasFeature(LICENSE_FEATURES.sso).then((has) => (has ? getAzureAccessTokenForUser(ctx.userId) : null)),
	]);
	return {
		projectFolder: project.path,
		chatId: '',
		agentSettings,
		envVars,
		azureAccessToken,
		queryResults: new Map(),
		generatedArtifacts: { charts: [], stories: [] },
	};
}

function makeExecutionOptions(toolContext: ToolContext): ToolExecutionOptions & { experimental_context: ToolContext } {
	return { toolCallId: '', messages: [], experimental_context: toolContext };
}
