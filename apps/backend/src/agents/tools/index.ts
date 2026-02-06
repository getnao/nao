import { mcpService } from '../../services/mcp.service';
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
	execute_sql: executeSql,
	execute_python: executePython,
	grep,
	list,
	read,
	search,
	suggest_follow_ups: suggestFollowUps,
};

export const getTools = () => {
	const mcpTools = mcpService.getMcpTools();

	return { ...tools, ...mcpTools };
};
