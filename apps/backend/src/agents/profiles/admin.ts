import { renderAdminSystemPrompt } from '../../components/ai';
import { getTools } from '../tools';
import type { AgentProfile } from './types';

const ADMIN_TOOLS = [
	'execute_sql',
	'page_query_result',
	'display_chart',
	'suggest_follow_ups',
	'story',
	'clarification',
];

/** Answers project admins about how nao itself is used, from nao's app database rather than the warehouse. */
export const adminAgent: AgentProfile = {
	source: 'admin',
	tools: ({ agentSettings }) => getTools(agentSettings, {}, { builtinToolAllowlist: ADMIN_TOOLS }),
	systemPrompt: ({ timezone }) => renderAdminSystemPrompt({ timezone }),
	queriesAppDatabase: true,
};
