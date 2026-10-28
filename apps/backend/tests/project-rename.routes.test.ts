import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
	getUserRoleInProject: vi.fn(),
	getProjectByOrgAndName: vi.fn(),
	updateProjectName: vi.fn(),
}));

vi.mock('../src/queries/project.queries', () => ({
	getProjectByUserId: vi.fn(async () => ({ id: 'project-id', orgId: 'org-id', name: "Ada's project", path: null })),
	getUserRoleInProject: mocks.getUserRoleInProject,
	getProjectByOrgAndName: mocks.getProjectByOrgAndName,
	updateProjectName: mocks.updateProjectName,
}));
vi.mock('../src/queries/user.queries', () => ({}));
vi.mock('../src/queries/chat.queries', () => ({}));
vi.mock('../src/queries/project-llm-config.queries', () => ({}));
vi.mock('../src/queries/project-saved-prompt.queries', () => ({}));
vi.mock('../src/queries/project-slack-config.queries', () => ({}));
vi.mock('../src/queries/project-teams-config.queries', () => ({}));
vi.mock('../src/queries/project-telegram-config.queries', () => ({}));
vi.mock('../src/queries/project-whatsapp-config.queries', () => ({}));
vi.mock('../src/queries/project-whatsapp-link.queries', () => ({}));
vi.mock('../src/agents/user-rules', () => ({ getDatabaseObjects: vi.fn() }));
vi.mock('../src/auth', () => ({ getAuth: vi.fn() }));
vi.mock('../src/services/posthog', () => ({ posthog: {}, PostHogEvent: {} }));
vi.mock('../src/services/slack', () => ({ slackService: {} }));
vi.mock('../src/services/transcribe.service', () => ({ listAvailableTranscribeModels: vi.fn() }));
vi.mock('../src/utils/logger', () => ({
	logger: { error: vi.fn(), info: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

import { projectRoutes } from '../src/trpc/project.routes';
import { router } from '../src/trpc/trpc';

const testRouter = router(projectRoutes);

describe('project.rename', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mocks.getUserRoleInProject.mockResolvedValue('admin');
		mocks.getProjectByOrgAndName.mockResolvedValue(null);
	});

	it('renames the project with the trimmed name', async () => {
		await createCaller().rename({ name: '  Revenue analytics  ' });

		expect(mocks.getProjectByOrgAndName).toHaveBeenCalledWith('org-id', 'Revenue analytics');
		expect(mocks.updateProjectName).toHaveBeenCalledWith('project-id', 'Revenue analytics');
	});

	it('refuses a name already used by another project of the organization', async () => {
		mocks.getProjectByOrgAndName.mockResolvedValue({ id: 'other-project-id' });

		await expect(createCaller().rename({ name: 'Taken' })).rejects.toMatchObject({ code: 'CONFLICT' });
		expect(mocks.updateProjectName).not.toHaveBeenCalled();
	});

	it('accepts the current name of the project itself', async () => {
		mocks.getProjectByOrgAndName.mockResolvedValue({ id: 'project-id' });

		await createCaller().rename({ name: "Ada's project" });

		expect(mocks.updateProjectName).toHaveBeenCalledWith('project-id', "Ada's project");
	});

	it('rejects a blank name', async () => {
		await expect(createCaller().rename({ name: '   ' })).rejects.toMatchObject({ code: 'BAD_REQUEST' });
		expect(mocks.updateProjectName).not.toHaveBeenCalled();
	});

	it('only lets project admins rename the project', async () => {
		mocks.getUserRoleInProject.mockResolvedValue('user');

		await expect(createCaller().rename({ name: 'New name' })).rejects.toMatchObject({ code: 'FORBIDDEN' });
		expect(mocks.updateProjectName).not.toHaveBeenCalled();
	});
});

function createCaller() {
	return testRouter.createCaller({
		session: { user: { id: 'user-id', name: 'Ada', email: 'ada@example.com' } },
		selectedProjectId: 'project-id',
	} as never);
}
