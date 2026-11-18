import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
	assertProjectCloudBillingAccess: vi.fn(),
	getUserRoleInProject: vi.fn(),
}));

vi.mock('../../src/queries/project.queries', () => ({
	getUserRoleInProject: mocks.getUserRoleInProject,
}));
vi.mock('../../src/services/cloud-billing-access.service', () => ({
	assertProjectCloudBillingAccess: mocks.assertProjectCloudBillingAccess,
}));

import { adminAgent } from '../../src/agents/profiles/admin';
import { analyticsAgent } from '../../src/agents/profiles/analytics';
import { contextEditorAgent } from '../../src/agents/profiles/context-editor';
import { exampleAgent } from '../../src/agents/profiles/example';
import { messagingAgent } from '../../src/agents/profiles/messaging';
import { testRunAgent } from '../../src/agents/profiles/test-run';
import { SystemPrompt } from '../../src/components/ai/system-prompt';
import { env } from '../../src/env';
import { renderToMarkdown } from '../../src/lib/markdown';
import type { AgentToolsContext } from '../../src/services/agent';
import { authorizeAgentRun } from '../../src/services/agent-run';
import type { AgentRequest } from '../../src/types/chat';

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

	it.each(['clarification', 'suggest_follow_ups', 'story'])('leaves %s out of nao test runs', async (toolName) => {
		const context = { agentSettings: null, toolContext: { userGroupFeatures: [] } } as unknown as AgentToolsContext;

		expect(await analyticsAgent.tools(context)).toHaveProperty(toolName);
		expect(await testRunAgent.tools(context)).not.toHaveProperty(toolName);
		expect(testRunAgent.usageCategory).toBe('test');
	});

	it('keeps the query and chart tools in nao test runs', async () => {
		const context = { agentSettings: null, toolContext: { userGroupFeatures: [] } } as unknown as AgentToolsContext;

		const tools = await testRunAgent.tools(context);

		expect(tools).toHaveProperty('execute_sql');
		expect(tools).toHaveProperty('display_chart');
		expect(tools).not.toHaveProperty('write');
		expect(tools).not.toHaveProperty('str_replace');
	});

	it('keeps the published RULES.md and the user memories out of the Context Hub agent prompt', () => {
		const profile = contextEditorAgent({
			editor: { id: 'user-1', name: 'Ada', email: 'ada@example.com' },
			openPath: null,
		});

		expect(profile).toMatchObject({ source: 'contextEditor', excludesUserRules: true, excludesMemories: true });
		expect(profile.promptAppendix).toContain('is not part of your instructions here');
		expect(analyticsAgent.excludesUserRules).toBeUndefined();
	});

	it.each([
		{ isEnabled: true, label: 'gives' },
		{ isEnabled: false, label: 'keeps out' },
	])('$label the Context Hub agent the recommendations when they are enabled: $isEnabled', async ({ isEnabled }) => {
		const wasEnabled = env.BETA_CONTEXT_RECOMMENDATIONS_ENABLED;
		env.BETA_CONTEXT_RECOMMENDATIONS_ENABLED = isEnabled;
		try {
			const profile = contextEditorAgent({
				editor: { id: 'user-1', name: 'Ada', email: 'ada@example.com' },
				openPath: null,
			});
			const context = {
				agentSettings: null,
				toolContext: { userGroupFeatures: [] },
			} as unknown as AgentToolsContext;
			const tools = await profile.tools(context);

			expect(tools).toHaveProperty('edit_context_file');
			expect('apply_recommendation' in tools).toBe(isEnabled);
			expect(profile.promptAppendix?.includes('list_recommendations')).toBe(isEnabled);
		} finally {
			env.BETA_CONTEXT_RECOMMENDATIONS_ENABLED = wasEnabled;
		}
	});

	it('introduces the Context Hub agent as the context editor instead of the data analyst', () => {
		const profile = contextEditorAgent({
			editor: { id: 'user-1', name: 'Ada', email: 'ada@example.com' },
			openPath: null,
		});

		const prompt = renderToMarkdown(SystemPrompt({ role: profile.role }));

		expect(prompt).toContain('You are nao, the context editor of the Context Hub');
		expect(prompt).not.toContain('expert AI data analyst');
		expect(renderToMarkdown(SystemPrompt({}))).toContain('expert AI data analyst');
	});

	it('teaches only the Context Hub agent to link context files', () => {
		const profile = contextEditorAgent({
			editor: { id: 'user-1', name: 'Ada', email: 'ada@example.com' },
			openPath: null,
		});

		expect(profile.promptAppendix).toContain('<context-file path="docs/glossary.md" lines="4-8">');
		expect(renderToMarkdown(SystemPrompt({}))).not.toContain('<context-file');
	});

	it('adapts the analytics agent to the chat app it answers in', () => {
		expect(messagingAgent('slack')).toMatchObject({
			source: 'slack',
			messagingProvider: 'slack',
			supportsCustomCharts: false,
		});
	});
});
