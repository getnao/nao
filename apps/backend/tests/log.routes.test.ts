import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
	isCloud: false,
	listLogs: vi.fn(async () => []),
}));

vi.mock('../src/env', async (importOriginal) => ({
	...(await importOriginal<typeof import('../src/env')>()),
	get isCloud() {
		return mocks.isCloud;
	},
}));
vi.mock('../src/auth', () => ({ getAuth: vi.fn() }));
vi.mock('../src/queries/project.queries', () => ({
	getProjectByUserId: vi.fn(async () => ({ id: 'project-b', orgId: 'org-b', name: 'Project', path: null })),
	getUserRoleInProject: vi.fn(async () => 'admin'),
}));
vi.mock('../src/queries/log.queries', () => ({ listLogs: mocks.listLogs }));

import { logRoutes } from '../src/trpc/log.routes';
import { router } from '../src/trpc/trpc';

const testRouter = router(logRoutes);

describe('log.listLogs', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it('keeps project-less logs, which belong to no tenant, out of a cloud admin view', async () => {
		mocks.isCloud = true;

		await createCaller().listLogs({});
		expect(mocks.listLogs).toHaveBeenCalledWith('project-b', expect.anything(), { includeProjectlessLogs: false });
	});

	it('shows project-less system logs to a self-hosted admin', async () => {
		mocks.isCloud = false;

		await createCaller().listLogs({});
		expect(mocks.listLogs).toHaveBeenCalledWith('project-b', expect.anything(), { includeProjectlessLogs: true });
	});
});

function createCaller() {
	return testRouter.createCaller({
		session: { user: { id: 'admin-b', name: 'Admin B', email: 'admin-b@org-b.test' } },
		selectedProjectId: 'project-b',
	} as never);
}
