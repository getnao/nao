import { analyticsAgent, analyticsToolsExcluding } from './analytics';
import type { AgentProfile } from './types';

/**
 * The analytics agent answering a `nao test` prompt, so test suites measure what users get.
 * Follow-up suggestions are UI-only and grade nothing, so the tool is left out.
 */
export const testRunAgent: AgentProfile = {
	...analyticsAgent,
	tools: analyticsToolsExcluding(['suggest_follow_ups']),
	usageCategory: 'test',
};
