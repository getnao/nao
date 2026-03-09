export { isPythonAvailable } from './execute-python';
export { isSandboxAvailable } from './execute-sandboxed-code';

import { mcpService } from '../../services/mcp.service';
import { AgentSettings } from '../../types/agent-settings';
import displayChart from './display-chart';
import executePython from './execute-python';
import executeSandboxedCode from './execute-sandboxed-code';
import executeSql from './execute-sql';
import grep from './grep';
import list from './list';
import read from './read';
import search from './search';
import story from './story';
import suggestFollowUps from './suggest-follow-ups';

export const tools = {
	story,
	display_chart: displayChart,
	...(executePython && { execute_python: executePython }),
	...(executeSandboxedCode && { execute_sandboxed_code: executeSandboxedCode }),
	execute_sql: executeSql,
	grep,
	list,
	read,
	search,
	suggest_follow_ups: suggestFollowUps,
};

export const getTools = (agentSettings: AgentSettings | null, extraTools?: Record<string, unknown>) => {
	const mcpTools = mcpService.getMcpTools();

	const { execute_python, execute_sandboxed_code, ...baseTools } = tools;

	return {
		...baseTools,
		...mcpTools,
		...(agentSettings?.experimental?.pythonSandboxing && execute_python && { execute_python }),
		...(agentSettings?.experimental?.sandboxes && execute_sandboxed_code && { execute_sandboxed_code }),
		...extraTools,
	};
};
