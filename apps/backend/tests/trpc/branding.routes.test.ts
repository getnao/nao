import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createTestCaller } from '../helpers/trpc-caller';

const mocks = vi.hoisted(() => ({
	isCloud: false,
	updateBranding: vi.fn(),
	removeBrandingAsset: vi.fn(),
}));

vi.mock('../../src/env', async (importOriginal) => ({
	...(await importOriginal<typeof import('../../src/env')>()),
	get isCloud() {
		return mocks.isCloud;
	},
}));
vi.mock('../../src/auth', () => ({ getAuth: vi.fn() }));
vi.mock('../../src/queries/project.queries', () => ({
	getProjectByUserId: vi.fn(async () => ({ id: 'project-id', orgId: 'org-id', name: 'Project', path: null })),
	getUserRoleInProject: vi.fn(async () => 'admin'),
}));
vi.mock('../../src/services/branding.service', () => ({
	getActiveBranding: vi.fn(),
	isWhiteLabelEnabled: vi.fn(async () => true),
	updateBranding: mocks.updateBranding,
	removeBrandingAsset: mocks.removeBrandingAsset,
}));

import { brandingRoutes } from '../../src/trpc/branding.routes';
import { router } from '../../src/trpc/trpc';

const testRouter = router(brandingRoutes);
const caller = createTestCaller(testRouter);

describe('branding edits', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it('refuses a project admin rebranding the whole cloud deployment', async () => {
		mocks.isCloud = true;

		await expect(caller.update({ appName: 'Pwned' })).rejects.toMatchObject({ code: 'FORBIDDEN' });
		await expect(caller.removeAsset({ kind: 'logo' })).rejects.toMatchObject({ code: 'FORBIDDEN' });
		expect(mocks.updateBranding).not.toHaveBeenCalled();
		expect(mocks.removeBrandingAsset).not.toHaveBeenCalled();
	});

	it('lets an admin rebrand a self-hosted deployment', async () => {
		mocks.isCloud = false;

		await expect(caller.update({ appName: 'Acme' })).resolves.toEqual({ ok: true });
		expect(mocks.updateBranding).toHaveBeenCalledWith({ appName: 'Acme' });
	});
});
