export { isPythonAvailable } from './execute-python';
export { isSandboxAvailable } from './execute-sandboxed-code';

import { mcpService } from '../../services/mcp';
import { AgentSettings } from '../../types/agent-settings';
import clarification from './clarification';
import displayChart from './display-chart';
import executePython from './execute-python';
import executeSandboxedCode from './execute-sandboxed-code';
import executeSql from './execute-sql';
import grep from './grep';
import list from './list';
import read from './read';
import readQueryResult from './read-query-result';
import search from './search';
import story from './story';
import suggestFollowUps from './suggest-follow-ups';

export const tools = {
	story,
	clarification,
	display_chart: displayChart,
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
	} = {},
) => {
	const mcpTools = options.mcpEnabled === false ? {} : mcpService.getMcpTools(options.mcpServers);

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

	if (options.builtinToolAllowlist) {
		const allowed = new Set([...options.builtinToolAllowlist, ...Object.keys(extraTools ?? {})]);
		return Object.fromEntries(Object.entries(allTools).filter(([name]) => allowed.has(name))) as typeof allTools;
	}

	return allTools;
};
