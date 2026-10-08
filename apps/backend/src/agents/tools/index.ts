export { isPythonAvailable } from './execute-python';
export { isSandboxAvailable } from './execute-sandboxed-code';

import type { CustomBoundarySet } from '@nao/shared';
import { writeFile } from '@nao/shared/tools';
import type { SemanticLayerMode } from '@nao/shared/types';
import type { Tool } from 'ai';

import { env } from '../../env';
import { mcpService } from '../../services/mcp';
import { isSemanticQueryToolEnabled, isWarehouseSqlEnabled } from '../../services/semantic-layer.service';
import { isStorageEnabled } from '../../services/storage';
import { isCustomStoriesEnabled } from '../../services/story-mount';
import { AgentSettings } from '../../types/agent-settings';
import clarification from './clarification';
import displayChart from './display-chart';
import { createDisplayMapTool } from './display-map';
import executePython from './execute-python';
import executeSandboxedCode from './execute-sandboxed-code';
import executeSemanticQuery from './execute-semantic-query';
import executeSql, { localOnlyExecuteSql } from './execute-sql';
import generateOnboardingRules from './generate-onboarding-rules';
import grep from './grep';
import list from './list';
import loadSkill from './load-skill';
import { createMcpCallTool } from './mcp-call';
import { createMcpConnectTool } from './mcp-connect';
import onboardingCommand from './onboarding-command';
import onboardingProgress from './onboarding-progress';
import read from './read';
import readQueryResult from './read-query-result';
import requestWarehouseCredentials from './request-warehouse-credentials';
import search from './search';
import story, { buildStoryToolDescription } from './story';
import strReplace, { buildStrReplaceToolDescription } from './str-replace';
import suggestFollowUps from './suggest-follow-ups';
import task from './task';
import write, { buildWriteToolDescription } from './write';

/**
 * Tools excluded from the MCP sub-agent (`ask_nao`): it returns a text summary to the calling client,
 * so a map — which has no textual representation — cannot be surfaced. Every other surface renders it:
 * the web chat interactively, and messaging/automations as a static PNG.
 */
export const MCP_SUB_AGENT_EXCLUDED_TOOLS = ['display_map'];

export const tools = {
	story,
	clarification,
	display_chart: displayChart,
	...(executePython && { execute_python: executePython }),
	...(executeSandboxedCode && { execute_sandboxed_code: executeSandboxedCode }),
	execute_sql: executeSql,
	execute_semantic_query: executeSemanticQuery,
	read_query_result: readQueryResult,
	grep,
	list,
	load_skill: loadSkill,
	onboarding_command: onboardingCommand,
	onboarding_progress: onboardingProgress,
	request_warehouse_credentials: requestWarehouseCredentials,
	generate_onboarding_rules: generateOnboardingRules,
	read,
	search,
	task,
	write,
	str_replace: strReplace,
	suggest_follow_ups: suggestFollowUps,
};

export const uiToolset = { ...tools, display_map: createDisplayMapTool() };

export const getTools = (
	agentSettings: AgentSettings | null,
	extraTools?: Record<string, unknown>,
	options: {
		mcpEnabled?: boolean;
		mcpServers?: string[] | null;
		excludeFollowUps?: boolean;
		onboarding?: boolean;
		/**
		 * Restricts generated tools to this allowlist by tool name. `extraTools` are always
		 * kept. Used by focused runs (e.g. context recommendations) that should only discover
		 * context, not query the warehouse or render charts.
		 */
		builtinToolAllowlist?: string[];
		/**
		 * Drops these built-in tools from the returned set. Used by runs whose
		 * surface cannot render a tool's output (e.g. `display_map` outside the
		 * web chat: automations, MCP sub-agent, WhatsApp).
		 */
		excludeBuiltinTools?: string[];
		/** Custom GeoJSON boundary sets defined by the project admin. */
		customBoundaries?: CustomBoundarySet[];
		/**
		 * Semantic layer mode of the run (`ToolContext.semanticLayerMode`). `execute_semantic_query`
		 * is only exposed for the querying modes, and `exclusive` restricts `execute_sql` to the
		 * local database; omit when the project has no semantic layer.
		 */
		semanticLayerMode?: SemanticLayerMode | null;
		/**
		 * Whether the run's user may author custom stories. Tool descriptions only mention
		 * `/stories` when they can; omit to follow the instance flag alone.
		 */
		customStoryAuthoring?: boolean;
	} = {},
) => {
	const customStoryAuthoring = options.customStoryAuthoring ?? isCustomStoriesEnabled();
	const configuredServers = new Set(mcpService.getConfiguredServerNames());
	const includeMcp =
		options.mcpEnabled !== false &&
		(options.mcpServers == null
			? configuredServers.size > 0
			: options.mcpServers.some((server) => configuredServers.has(server)));
	const mcpTools: Record<string, Tool> = includeMcp
		? {
				mcp_call: createMcpCallTool(options.mcpServers ?? null),
				mcp_connect: createMcpConnectTool(options.mcpServers ?? null),
			}
		: {};

	const {
		execute_python,
		execute_sandboxed_code,
		execute_semantic_query,
		execute_sql,
		clarification: clarificationTool,
		onboarding_command: onboardingCommandTool,
		onboarding_progress: onboardingProgressTool,
		request_warehouse_credentials: requestWarehouseCredentialsTool,
		generate_onboarding_rules: generateOnboardingRulesTool,
		suggest_follow_ups,
		task: taskTool,
		write: writeTool,
		str_replace: strReplaceTool,
		...rest
	} = tools;
	const baseTools = {
		...rest,
		...(env.BETA_SUBAGENTS_ENABLED && { task: taskTool }),
		execute_sql: isWarehouseSqlEnabled(options.semanticLayerMode) ? execute_sql : localOnlyExecuteSql,
		...(isSemanticQueryToolEnabled(options.semanticLayerMode) && { execute_semantic_query }),
		...((isStorageEnabled() || customStoryAuthoring) && {
			write: writeTool,
			str_replace: {
				...strReplaceTool,
				description: buildStrReplaceToolDescription({ customStories: customStoryAuthoring }),
			},
		}),
		...(!options.excludeFollowUps && { suggest_follow_ups }),
	};

	const allTools = {
		...baseTools,
		clarification: clarificationTool,
		...(options.onboarding && {
			onboarding_command: onboardingCommandTool,
			onboarding_progress: onboardingProgressTool,
			request_warehouse_credentials: requestWarehouseCredentialsTool,
			generate_onboarding_rules: generateOnboardingRulesTool,
		}),
		...mcpTools,
		...(agentSettings?.experimental?.pythonSandboxing && execute_python && { execute_python }),
		...(agentSettings?.experimental?.sandboxes && execute_sandboxed_code && { execute_sandboxed_code }),
		...(agentSettings?.mapEnabled !== false && {
			display_map: createDisplayMapTool(options.customBoundaries ?? []),
		}),
		...extraTools,
	};

	let result = allTools;
	if (options.builtinToolAllowlist) {
		const allowed = new Set(options.builtinToolAllowlist);
		result = keepTools(result, extraTools, (name) => allowed.has(name));
	}
	if (options.excludeBuiltinTools) {
		const excluded = new Set(options.excludeBuiltinTools);
		result = keepTools(result, extraTools, (name) => !excluded.has(name));
	}

	const canReplace = 'str_replace' in result;
	if ('write' in result) {
		result = {
			...result,
			write: {
				...writeTool,
				description: buildWriteToolDescription({ customStories: customStoryAuthoring, canReplace }),
				inputSchema: writeFile.buildInputSchema({ customStories: customStoryAuthoring }),
			},
		};
	}
	if ('story' in result) {
		const mapsEnabled = 'display_map' in result;
		const customStories = customStoryAuthoring && 'write' in result;
		result = {
			...result,
			story: {
				...result.story,
				description: buildStoryToolDescription({ mapsEnabled, customStories, canReplace }),
			},
		};
	}

	return result;
};

const keepTools = <T extends Record<string, unknown>>(
	toolset: T,
	extraTools: Record<string, unknown> | undefined,
	shouldKeep: (name: string) => boolean,
): T => {
	const extraToolNames = new Set(Object.keys(extraTools ?? {}));
	return Object.fromEntries(
		Object.entries(toolset).filter(([name]) => shouldKeep(name) || extraToolNames.has(name)),
	) as T;
};
