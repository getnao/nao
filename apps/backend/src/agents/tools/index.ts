import { mcpService } from '../../services/mcp.service';
import { AgentSettings } from '../../types/agent-settings';
import displayChart from './display-chart';
import executePython from './execute-python';
import executeSql from './execute-sql';
import grep from './grep';
import list from './list';
import read from './read';
import search from './search';
import suggestFollowUps from './suggest-follow-ups';

export const tools = {
	display_chart: displayChart,
	execute_python: executePython,
	execute_sql: executeSql,
	grep,
	list,
	read,
	search,
	suggest_follow_ups: suggestFollowUps,
};

export const getTools = (agentSettings: AgentSettings | null) => {
	const mcpTools = mcpService.getMcpTools();

	const { execute_python, ...baseTools } = tools;

	return {
		...baseTools,
		...mcpTools,
		...(agentSettings?.experimental?.pythonSandboxing && { execute_python }),
	};
};
