import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
	assertProjectCloudBillingAccess: vi.fn(),
	assertProjectUserCloudBillingAccess: vi.fn(),
	getUserRoleInProject: vi.fn(),
}));

vi.mock('../src/queries/project.queries', () => ({
	getUserRoleInProject: mocks.getUserRoleInProject,
}));
vi.mock('../src/services/cloud-billing-access.service', () => ({
	assertProjectCloudBillingAccess: mocks.assertProjectCloudBillingAccess,
	assertProjectUserCloudBillingAccess: mocks.assertProjectUserCloudBillingAccess,
}));

import { adminAgent } from '../src/agents/profiles/admin';
import { analyticsAgent } from '../src/agents/profiles/analytics';
import { exampleAgent } from '../src/agents/profiles/example';
import { messagingAgent } from '../src/agents/profiles/messaging';
import { authorizeAgentRun } from '../src/services/agent-run';
import type { AgentRequest } from '../src/types/chat';

describe('agent profiles', () => {
	beforeEach(() => {
		mocks.assertProjectCloudBillingAccess.mockReset().mockResolvedValue(undefined);
		mocks.getUserRoleInProject.mockReset();
	});

	it.each([
		{ role: 'admin', adminMode: true, profile: adminAgent },
		{ role: 'context_admin', adminMode: true, profile: adminAgent },
		{ role: 'user', adminMode: true, profile: analyticsAgent },
		{ role: 'admin', adminMode: false, profile: analyticsAgent },
	] as const)(
		'gives a project $role with adminMode $adminMode the right agent',
		async ({ role, adminMode, profile }) => {
			mocks.getUserRoleInProject.mockResolvedValue(role);

			const run = await authorizeAgentRun({
				userId: 'user-1',
				currentProject: { id: 'project-1' } as never,
				body: { message: { text: 'Hello' }, mode: 'default', adminMode } as AgentRequest,
			});

			expect(run.profile).toBe(profile);
		},
	);

	it('keeps the example agent to the Jaffle Shop data on top of the analytics agent', () => {
		expect(exampleAgent.tools).toBe(analyticsAgent.tools);
		expect(exampleAgent.promptAppendix).toContain(
			'Only answer analytical questions about the Jaffle Shop database',
		);
		expect(exampleAgent.promptAppendix).toContain('Analyze files attached by the user');
		expect(exampleAgent.promptAppendix).toContain('Respond naturally to greetings');
		expect(analyticsAgent.promptAppendix).toBeUndefined();
	});

	it('adapts the analytics agent to the chat app it answers in', () => {
		expect(messagingAgent('slack')).toMatchObject({
			source: 'slack',
			messagingProvider: 'slack',
			supportsCustomCharts: false,
		});
	});
});
