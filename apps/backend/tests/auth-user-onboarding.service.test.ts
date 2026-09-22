import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
	addDefaultOrganization: vi.fn(),
	addDefaultProject: vi.fn(),
	initializeDefaultOrganization: vi.fn(),
	isMicrosoft: vi.fn(),
	isOidc: vi.fn(),
}));

vi.mock('../src/queries/organization.queries', () => ({
	addUserToDefaultOrganizationIfExists: mocks.addDefaultOrganization,
	addUserToDefaultProjectIfExists: mocks.addDefaultProject,
	initializeDefaultOrganizationForFirstUser: mocks.initializeDefaultOrganization,
}));
vi.mock('../src/services/microsoft-auth.service', () => ({
	isSocialProviderMicrosoft: mocks.isMicrosoft,
}));
vi.mock('../src/services/oidc-auth.service', () => ({
	isSocialProviderOidc: mocks.isOidc,
}));

import { initializeSelfHostedUserAfterCreation } from '../src/services/auth-user-onboarding.service';

beforeEach(() => {
	mocks.addDefaultOrganization.mockReset().mockResolvedValue(undefined);
	mocks.addDefaultProject.mockReset().mockResolvedValue(undefined);
	mocks.initializeDefaultOrganization.mockReset().mockResolvedValue(undefined);
	mocks.isMicrosoft.mockReset().mockReturnValue(false);
	mocks.isOidc.mockReset().mockReturnValue(false);
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
	});
});
