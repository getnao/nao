import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
	getUserRoleInProject: vi.fn(),
	renameProject: vi.fn(),
}));

vi.mock('../src/queries/project.queries', () => ({
	getProjectByUserId: vi.fn(async () => ({ id: 'project-id', orgId: 'org-id', name: "Ada's project", path: null })),
	getUserRoleInProject: mocks.getUserRoleInProject,
	renameProject: mocks.renameProject,
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
		mocks.renameProject.mockResolvedValue(true);
	});

	it('renames the project with the trimmed name', async () => {
		await createCaller().rename({ projectId: 'project-id', name: '  Revenue analytics  ' });

		expect(mocks.renameProject).toHaveBeenCalledWith('project-id', 'org-id', 'Revenue analytics');
	});

	it('reports a conflict when the organization already has a project with that name', async () => {
		mocks.renameProject.mockResolvedValue(false);

		await expect(createCaller().rename({ projectId: 'project-id', name: 'Taken' })).rejects.toMatchObject({
			code: 'CONFLICT',
		});
	});

	it('refuses to rename when the edited project is no longer the selected one', async () => {
		await expect(createCaller().rename({ projectId: 'other-project-id', name: 'New name' })).rejects.toMatchObject({
			code: 'CONFLICT',
		});
		expect(mocks.renameProject).not.toHaveBeenCalled();
	});

	it('rejects a blank name', async () => {
		await expect(createCaller().rename({ projectId: 'project-id', name: '   ' })).rejects.toMatchObject({
			code: 'BAD_REQUEST',
		});
		expect(mocks.renameProject).not.toHaveBeenCalled();
	});

	it('only lets project admins rename the project', async () => {
		mocks.getUserRoleInProject.mockResolvedValue('user');

		await expect(createCaller().rename({ projectId: 'project-id', name: 'New name' })).rejects.toMatchObject({
			code: 'FORBIDDEN',
		});
		expect(mocks.renameProject).not.toHaveBeenCalled();
	});
});

function createCaller() {
	return testRouter.createCaller({
		session: { user: { id: 'user-id', name: 'Ada', email: 'ada@example.com' } },
		selectedProjectId: 'project-id',
	} as never);
}
