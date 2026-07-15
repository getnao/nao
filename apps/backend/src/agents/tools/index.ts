export { isPythonAvailable } from './execute-python';
export { isSandboxAvailable } from './execute-sandboxed-code';

import type { Tool } from 'ai';

import { mcpService } from '../../services/mcp';
import { AgentSettings } from '../../types/agent-settings';
import clarification from './clarification';
import displayChart from './display-chart';
import displayMap from './display-map';
import executePython from './execute-python';
import executeSandboxedCode from './execute-sandboxed-code';
import executeSql from './execute-sql';
import grep from './grep';
import list from './list';
import { createMcpCallTool } from './mcp-call';
import read from './read';
import readQueryResult from './read-query-result';
import search from './search';
import story from './story';
import suggestFollowUps from './suggest-follow-ups';

/**
 * Tools whose output only the web chat can render — excluded from automations, MCP sub-agent and
 * WhatsApp runs. Slack, Teams and Telegram keep them and degrade to an "open in nao" link card.
 * TODO: WhatsApp has no block UI for a link card yet — post a plain-text chat link instead of
 * excluding the tool.
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
	read,
	search,
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
		? { mcp_call: createMcpCallTool(options.mcpServers ?? null) }
		: {};

	const {
		execute_python,
		execute_sandboxed_code,
		clarification: clarificationTool,
		suggest_follow_ups,
		...rest
	} = tools;
	const baseTools = options.excludeFollowUps ? rest : { ...rest, suggest_follow_ups };

	const allTools = {
		...baseTools,
		...(!options.testMode && { clarification: clarificationTool }),
		...mcpTools,
		...(agentSettings?.experimental?.pythonSandboxing && execute_python && { execute_python }),
		...(agentSettings?.experimental?.sandboxes && execute_sandboxed_code && { execute_sandboxed_code }),
		...extraTools,
	};

	let result = allTools;
	if (options.builtinToolAllowlist) {
		const allowed = new Set([...options.builtinToolAllowlist, ...Object.keys(extraTools ?? {})]);
		result = Object.fromEntries(Object.entries(result).filter(([name]) => allowed.has(name))) as typeof allTools;
	}
	if (options.excludeBuiltinTools) {
		const excluded = new Set(options.excludeBuiltinTools);
		const extraToolNames = new Set(Object.keys(extraTools ?? {}));
		result = Object.fromEntries(
			Object.entries(result).filter(([name]) => !excluded.has(name) || extraToolNames.has(name)),
		) as typeof allTools;
	}

	return result;
};
