import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
	resolveUserGroupAccess: vi.fn(),
}));

vi.mock('../src/services/user-group-availability.service', () => ({
	resolveAvailableUserGroupAccess: mocks.resolveUserGroupAccess,
}));
import {
	appendAgentUserGroupRestrictions,
	assertUserGroupFeature,
	getEffectiveUserGroupAccess,
	getEffectiveUserGroupAccessForUserDetail,
	getEffectiveUserGroupFeatureFlags,
	hasUserGroupFeature,
	resolveAgentUserGroupAccess,
} from '../src/services/user-group-feature-access.service';

describe('user group feature access service', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mocks.resolveUserGroupAccess.mockResolvedValue({
			features: ['storyCreation'],
			databaseAccess: { mode: 'restricted', strict: false, grants: [], patterns: [] },
			docsAccess: { mode: 'restricted', grants: [{ kind: 'folder', path: 'finance' }] },
			rowPolicies: [{ version: 1, policies: [] }],
			toolCallDensityPolicy: {
				defaultDensity: 'compact',
				canChange: false,
			},
		});
	});

	it('formats resolved group policies as effective access', async () => {
		await expect(getEffectiveUserGroupAccess('project-id', 'user-id')).resolves.toEqual({
			features: {
				storyCreation: true,
				automationCreation: false,
			},
			toolCallDensityPolicy: {
				defaultDensity: 'compact',
				canChange: false,
			},
			databaseAccess: { mode: 'restricted', strict: false, grants: [], patterns: [] },
			docsAccess: { mode: 'restricted', grants: [{ kind: 'folder', path: 'finance' }] },
		});
		expect(mocks.resolveUserGroupAccess).toHaveBeenCalledWith('project-id', 'user-id');
	});

	it('returns typed flags for effective grants', async () => {
		await expect(getEffectiveUserGroupFeatureFlags('project-id', 'user-id')).resolves.toEqual({
			storyCreation: true,
			automationCreation: false,
		});
		await expect(getEffectiveUserGroupAccess('project-id', 'user-id')).resolves.toMatchObject({
			databaseAccess: { mode: 'restricted', strict: false, grants: [], patterns: [] },
			docsAccess: { mode: 'restricted', grants: [{ kind: 'folder', path: 'finance' }] },
			toolCallDensityPolicy: {
				defaultDensity: 'compact',
				canChange: false,
			},
		});
	});

	it('returns row policies for the admin user detail', async () => {
		await expect(getEffectiveUserGroupAccessForUserDetail('project-id', 'user-id')).resolves.toMatchObject({
			rowPolicies: [{ version: 1, policies: [] }],
		});
	});

	it('allows and denies feature checks', async () => {
		await expect(hasUserGroupFeature('project-id', 'user-id', 'storyCreation')).resolves.toBe(true);
		await expect(assertUserGroupFeature('project-id', 'user-id', 'automationCreation')).rejects.toMatchObject({
			codeMessage: 'FORBIDDEN',
			message: 'Automation creation is not enabled for your user group.',
		});
	});

	it('prepares tool-aware agent restrictions from canonical feature flags', () => {
		expect(resolveAgentUserGroupAccess([], { story: {}, execute_sql: {} })).toEqual({
			features: {
				storyCreation: false,
				automationCreation: false,
			},
			restrictedFeatures: ['storyCreation', 'automationCreation'],
		});
		expect(resolveAgentUserGroupAccess([], { execute_sql: {}, custom: {} })).toEqual({
			features: {
				storyCreation: false,
				automationCreation: false,
			},
			restrictedFeatures: ['automationCreation'],
		});
	});

	it('adds all relevant agent restrictions under one heading', () => {
		const access = resolveAgentUserGroupAccess([], { story: {}, execute_sql: {} });
		const prompt = appendAgentUserGroupRestrictions('Custom project prompt', access);

		expect(prompt).toContain('Custom project prompt');
		expect(prompt).toContain('## User group permissions');
		expect(prompt).toContain('Do not attempt or offer to create a new Story');
		expect(prompt).toContain('You may update or replace existing Stories');
		expect(prompt).toContain('Automation creation is unavailable');
		expect(prompt).toContain('user can still view and manage existing Automations');
		expect(prompt.match(/## User group permissions/g)).toHaveLength(1);
	});

	it('omits allowed and tool-irrelevant agent restrictions', () => {
		const allowed = resolveAgentUserGroupAccess(['storyCreation', 'automationCreation'], { story: {} });
		expect(appendAgentUserGroupRestrictions('Allowed prompt', allowed)).toBe('Allowed prompt');

		const automationOnly = resolveAgentUserGroupAccess([], { execute_sql: {} });
		const prompt = appendAgentUserGroupRestrictions('Prompt', automationOnly);
		expect(prompt).not.toContain('Story creation through the agent is unavailable');
		expect(prompt).toContain('Automation creation is unavailable');
	});
});
