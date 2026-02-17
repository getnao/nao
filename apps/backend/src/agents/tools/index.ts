import { mcpService } from '../../services/mcp.service';
import { AgentSettings } from '../../types/agent-settings';
import displayChart from './display-chart';
import executePython, { isPythonAvailable } from './execute-python';
import executeSql from './execute-sql';
import grep from './grep';
import list from './list';
import read from './read';
import search from './search';
import suggestFollowUps from './suggest-follow-ups';

export const tools = {
	display_chart: displayChart,
	...(executePython && { execute_python: executePython }),
	execute_sql: executeSql,
	grep,
	list,
	read,
	search,
	suggest_follow_ups: suggestFollowUps,
};

export { isPythonAvailable };

export const getTools = async (agentSettings: AgentSettings | null, projectId: string) => {
	const mcpTools = await mcpService.getMcpTools(projectId);

	const { execute_python, ...baseTools } = tools;

	return {
		...baseTools,
		...mcpTools,
		...(agentSettings?.experimental?.pythonSandboxing && execute_python && { execute_python }),
	};
};
