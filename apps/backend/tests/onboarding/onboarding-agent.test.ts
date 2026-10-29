import { describe, expect, it } from 'vitest';

import { onboardingAgent } from '../../src/agents/profiles/onboarding';
import { getTools } from '../../src/agents/tools';
import { onboardingTools } from '../../src/agents/tools/onboarding';
import type { AgentToolsContext } from '../../src/services/agent';

describe('onboarding agent', () => {
	it('is the only agent given the onboarding tools', async () => {
		const onboardingToolNames = Object.keys(onboardingTools);
		const runTools = await onboardingAgent.tools({ agentSettings: null } as AgentToolsContext);

		expect(Object.keys(runTools)).toEqual(['clarification', ...onboardingToolNames]);
		expect(Object.keys(getTools(null)).filter((name) => onboardingToolNames.includes(name))).toEqual([]);
	});

	it('hands the turn back to the user once it shows a choice, a form or a new conversation', () => {
		expect(onboardingAgent.turnEndingTools).toEqual([
			'request_warehouse_selection',
			'request_warehouse_credentials',
			'restart_onboarding',
		]);
	});
});
