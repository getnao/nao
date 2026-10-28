import { analyticsAgent } from './analytics';
import type { AgentProfile } from './types';

/** The analytics agent answering a `nao test` prompt, so test suites measure what users get. */
export const testRunAgent: AgentProfile = {
	...analyticsAgent,
	usageCategory: 'test',
};
