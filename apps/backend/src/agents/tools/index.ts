export { isPythonAvailable } from './execute-python';
export { isSandboxAvailable } from './execute-sandboxed-code';

import type { Tool } from 'ai';

import { mcpService } from '../../services/mcp';
import { isStorageEnabled } from '../../services/storage';
import { AgentSettings } from '../../types/agent-settings';
import clarification from './clarification';
import displayChart from './display-chart';
import displayMap from './display-map';
import executePython from './execute-python';
import executeSandboxedCode from './execute-sandboxed-code';
import executeSql from './execute-sql';
import grep from './grep';
import list from './list';
import loadSkill from './load-skill';
import { createMcpCallTool } from './mcp-call';
import { createMcpConnectTool } from './mcp-connect';
import read from './read';
import readQueryResult from './read-query-result';
import search from './search';
import story from './story';
import suggestFollowUps from './suggest-follow-ups';
import write from './write';

/**
 * Tools whose output only the web chat can render — excluded from automations and the MCP sub-agent.
 * Messaging providers keep them and degrade to an "open in nao" link (a card on Slack/Teams/Telegram,
 * a plain-text link on WhatsApp).
 */
export const WEB_CHAT_ONLY_TOOLS = ['display_map'];

export const tools = {
	story,
	clarification,
	display_chart: displayChart,
	display_map: displayMap,
	...(executePython && { execute_python: executePython }),
	...(executeSandboxedCode && { execute_sandboxed_code: executeSandboxedCode }),
	execute_sql: executeSql,
	read_query_result: readQueryResult,
	grep,
	list,
	load_skill: loadSkill,
	read,
	search,
	write,
	suggest_follow_ups: suggestFollowUps,
};

export const getTools = (
	agentSettings: AgentSettings | null,
	extraTools?: Record<string, unknown>,
	options: {
		testMode?: boolean;
		mcpEnabled?: boolean;
		mcpServers?: string[] | null;
		excludeFollowUps?: boolean;
		/**
		 * Restricts the built-in tools to this allowlist (by tool name). MCP, python,
		 * sandboxing and clarification tools are dropped entirely. `extraTools` are
		 * always kept. Used by focused runs (e.g. context recommendations) that should
		 * only discover context, not query the warehouse or render charts.
		 */
		builtinToolAllowlist?: string[];
		/**
		 * Drops these built-in tools from the returned set. Used by runs whose
		 * surface cannot render a tool's output (e.g. `display_map` outside the
		 * web chat: automations, MCP sub-agent, WhatsApp).
		 */
		excludeBuiltinTools?: string[];
	} = {},
) => {
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
		clarification: clarificationTool,
		suggest_follow_ups,
		display_map: displayMapTool,
		write: writeTool,
		...rest
	} = tools;
	const baseTools = {
		...rest,
		...(!options.excludeFollowUps && { suggest_follow_ups }),
		...(isStorageEnabled() && { write: writeTool }),
	};

	const allTools = {
		...baseTools,
		...(!options.testMode && { clarification: clarificationTool }),
		...mcpTools,
		...(agentSettings?.experimental?.pythonSandboxing && execute_python && { execute_python }),
		...(agentSettings?.experimental?.sandboxes && execute_sandboxed_code && { execute_sandboxed_code }),
		...(agentSettings?.experimental?.displayMap && { display_map: displayMapTool }),
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
