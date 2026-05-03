export { isPythonAvailable } from './execute-python';
export { isSandboxAvailable } from './execute-sandboxed-code';

import { mcpService } from '../../services/mcp';
import { AgentSettings } from '../../types/agent-settings';
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
	excludeTools?: readonly string[],
) => {
	const mcpTools = mcpService.getMcpTools();
	const { execute_python, execute_sandboxed_code, ...baseTools } = tools;
	const include = (key: string) => !excludeTools?.includes(key);

	return {
		...Object.fromEntries(Object.entries(baseTools).filter(([k]) => include(k))),
		...Object.fromEntries(Object.entries(mcpTools).filter(([k]) => include(k))),
		...(agentSettings?.experimental?.pythonSandboxing &&
			execute_python &&
			include('execute_python') && { execute_python }),
		...(agentSettings?.experimental?.sandboxes &&
			execute_sandboxed_code &&
			include('execute_sandboxed_code') && { execute_sandboxed_code }),
		...Object.fromEntries(Object.entries(extraTools ?? {}).filter(([k]) => include(k))),
	};
};
