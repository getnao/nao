import type { AgentToolsResolver } from '../../services/agent';
import { customStoryAuthoringError } from '../../services/story-mount';
import { getTools } from '../tools';
import type { AgentProfile } from './types';

/** The analytics agent of the web chat: every built-in tool, MCP and web search over the project context. */
export const analyticsAgent: AgentProfile = {
	source: 'web',
	tools: analyticsToolsExcluding([]),
};

/** Analytics tool set minus the given built-ins, for surfaces that cannot render them, plus the surface's own tools. */
export function analyticsToolsExcluding(
	excludeBuiltinTools: string[],
	surfaceTools: Record<string, unknown> = {},
): AgentToolsResolver {
	return ({ agentSettings, toolContext, webTools, customBoundaries }) =>
		getTools(
			agentSettings,
			{ ...webTools, ...surfaceTools },
			{
				excludeBuiltinTools,
				customBoundaries,
				projectId: toolContext.projectId,
				mcpAccess: toolContext.mcpAccess,
				semanticLayerMode: toolContext.semanticLayerMode,
				customStoryAuthoring: customStoryAuthoringError(toolContext.userGroupFeatures) === null,
			},
		);
}
