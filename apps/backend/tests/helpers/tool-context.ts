import type { Tool, ToolCallOptions } from 'ai';

import type { ToolContext } from '../../src/types/tools';

/** An unrestricted agent run: no access policy is enforced and nothing is generated yet. */
export function createToolContext(overrides: Partial<ToolContext> = {}): ToolContext {
	return {
		projectFolder: '/tmp/project',
		chatId: 'chat-1',
		userId: 'user-1',
		projectId: 'project-1',
		supportsCustomCharts: false,
		agentSettings: null,
		envVars: {},
		warehouseTableAccess: { enforced: false },
		warehouseRowSecurity: { enforced: false },
		docsContextAccess: { enforced: false },
		filesContextAccess: { enforced: false },
		userGroupFeatures: [],
		userRulesGroupAccess: { enforced: false },
		azureAccessToken: null,
		queryResults: new Map(),
		generatedArtifacts: { charts: [], maps: [], stories: [] },
		...overrides,
	};
}

export async function executeTool<TInput, TOutput>(
	tool: Tool<TInput, TOutput>,
	input: TInput,
	context: ToolContext,
): Promise<TOutput> {
	const options: ToolCallOptions = { toolCallId: 'tool-call-id', messages: [], experimental_context: context };
	return (await tool.execute!(input, options)) as TOutput;
}
