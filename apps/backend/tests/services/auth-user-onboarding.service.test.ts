import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
	addDefaultOrganization: vi.fn(),
	addDefaultProject: vi.fn(),
	getDefaultProject: vi.fn(),
	initializeDefaultOrganization: vi.fn(),
	isMicrosoft: vi.fn(),
	isOidc: vi.fn(),
	registerEnvLlmConfigs: vi.fn(),
}));

vi.mock('../../src/queries/organization.queries', () => ({
	addUserToDefaultOrganizationIfExists: mocks.addDefaultOrganization,
	addUserToDefaultProjectIfExists: mocks.addDefaultProject,
	initializeDefaultOrganizationForFirstUser: mocks.initializeDefaultOrganization,
}));
vi.mock('../../src/services/microsoft-auth.service', () => ({
	isSocialProviderMicrosoft: mocks.isMicrosoft,
}));
vi.mock('../../src/services/oidc-auth.service', () => ({
	isSocialProviderOidc: mocks.isOidc,
}));
vi.mock('../../src/queries/project.queries', () => ({
	getDefaultProject: mocks.getDefaultProject,
}));
vi.mock('../../src/services/env-llm-config.service', () => ({
	registerEnvLlmConfigs: mocks.registerEnvLlmConfigs,
}));

import { initializeSelfHostedUserAfterCreation } from '../../src/services/auth-user-onboarding.service';

beforeEach(() => {
	mocks.addDefaultOrganization.mockReset().mockResolvedValue(undefined);
	mocks.addDefaultProject.mockReset().mockResolvedValue(undefined);
	mocks.initializeDefaultOrganization.mockReset().mockResolvedValue(undefined);
	mocks.isMicrosoft.mockReset().mockReturnValue(false);
	mocks.isOidc.mockReset().mockReturnValue(false);
	mocks.getDefaultProject.mockReset().mockResolvedValue(null);
	mocks.registerEnvLlmConfigs.mockReset().mockResolvedValue(0);
});

describe('initializeSelfHostedUserAfterCreation', () => {
	it('adds a new OIDC user only to the default organization', async () => {
		mocks.isOidc.mockReturnValue(true);

		await initializeSelfHostedUserAfterCreation('user-1', 'okta', true);

		expect(mocks.initializeDefaultOrganization).toHaveBeenCalledWith('user-1');
		expect(mocks.addDefaultOrganization).toHaveBeenCalledWith('user-1');
		expect(mocks.addDefaultProject).not.toHaveBeenCalled();
	});

	it('adds a new Microsoft user only to the default organization', async () => {
		mocks.isMicrosoft.mockReturnValue(true);

		await initializeSelfHostedUserAfterCreation('user-1', 'microsoft', true);

		expect(mocks.addDefaultOrganization).toHaveBeenCalledWith('user-1');
		expect(mocks.addDefaultProject).not.toHaveBeenCalled();
	});

	it.each(['google', 'github', 'gitlab'])('preserves default project onboarding for %s', async (providerId) => {
		await initializeSelfHostedUserAfterCreation('user-1', providerId, true);

		expect(mocks.initializeDefaultOrganization).toHaveBeenCalledWith('user-1');
		expect(mocks.addDefaultProject).toHaveBeenCalledWith('user-1');
		expect(mocks.addDefaultOrganization).not.toHaveBeenCalled();
	});

	it('does not add an email and password user to the default project', async () => {
		await initializeSelfHostedUserAfterCreation('user-1', undefined, true);

		expect(mocks.initializeDefaultOrganization).toHaveBeenCalledWith('user-1');
		expect(mocks.addDefaultOrganization).not.toHaveBeenCalled();
		expect(mocks.addDefaultProject).not.toHaveBeenCalled();
		expect(mocks.registerEnvLlmConfigs).not.toHaveBeenCalled();
	});

	it('registers env credentials when a default project exists', async () => {
		mocks.getDefaultProject.mockResolvedValue({ id: 'project-1' });

		await initializeSelfHostedUserAfterCreation('user-1', undefined, true);

		expect(mocks.registerEnvLlmConfigs).toHaveBeenCalledWith('project-1');
	});
});
