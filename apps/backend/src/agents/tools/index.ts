import displayChart from './display-chart';
import executeSql from './execute-sql';
import grep from './grep';
import list from './list';
import read from './read';
import search from './search';
import suggestFollowUps from './suggest-follow-ups';

export const tools = {
	display_chart: displayChart,
	execute_sql: executeSql,
	grep,
	list,
	read,
	search,
	suggest_follow_ups: suggestFollowUps,
};
