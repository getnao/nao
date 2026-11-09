import { analyticsAgent, analyticsToolsExcluding } from './analytics';
import type { AgentProfile } from './types';

/**
 * Tools a test attempt cannot use. Nobody answers a clarifying question or clicks a follow-up,
 * and attempts run many times over, so they must not create stories or write files in the project.
 */
export const TEST_RUN_EXCLUDED_TOOLS = ['clarification', 'suggest_follow_ups', 'story', 'write', 'str_replace'];

/** The analytics agent answering a `nao test` prompt unattended, so test suites measure what users get. */
export const testRunAgent: AgentProfile = {
	...analyticsAgent,
	tools: analyticsToolsExcluding(TEST_RUN_EXCLUDED_TOOLS),
	source: 'test',
	excludesMemories: true,
	usageCategory: 'test',
};
