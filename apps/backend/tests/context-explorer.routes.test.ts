import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
	connectContextRepository: vi.fn(),
	getGithubToken: vi.fn(),
	getGitlabToken: vi.fn(),
}));

vi.mock('../src/auth', () => ({ getAuth: vi.fn() }));

vi.mock('../src/queries/project.queries', () => ({
	getProjectByUserId: vi.fn(async () => ({
		id: 'project-id',
		name: 'Test project',
		path: '/tmp/nao-project',
		envVars: {},
	})),
	getUserRoleInProject: vi.fn(async () => 'admin'),
}));

vi.mock('../src/queries/user.queries', () => ({
	getGithubToken: mocks.getGithubToken,
	getGitlabToken: mocks.getGitlabToken,
}));

vi.mock('../src/services/context-explorer.service', () => ({
	getFileTreeResponse: vi.fn(),
	MAX_CONTEXT_FILE_SIZE: 1024 * 1024,
	readFileContent: vi.fn(),
	searchFileContents: vi.fn(),
	writeFileContent: vi.fn(),
}));

vi.mock('../src/services/context-explorer-git.service', () => ({
	commitContextChanges: vi.fn(),
	connectContextRepository: mocks.connectContextRepository,
	createContextBranch: vi.fn(),
	createContextBranchAndCommit: vi.fn(),
	discardAllContextChanges: vi.fn(),
	discardContextFileChange: vi.fn(),
	disconnectContextRepository: vi.fn(),
	getChangedContextFiles: vi.fn(),
	getContextFileDiff: vi.fn(),
	getContextRepositoryStatus: vi.fn(),
	resolveContextExplorerGit: vi.fn(),
	suggestContextBranchName: vi.fn(),
	switchContextBranch: vi.fn(),
}));

vi.mock('../src/services/context-explorer-pr.service', () => ({
	pushContextExplorerBranch: vi.fn(),
}));

import { contextExplorerRoutes } from '../src/trpc/context-explorer.routes';
import { router } from '../src/trpc/trpc';

const testRouter = router(contextExplorerRoutes);

describe('context explorer repository connection', () => {
	beforeEach(() => {
		vi.resetAllMocks();
		mocks.getGithubToken.mockResolvedValue('github-token');
		mocks.getGitlabToken.mockResolvedValue('gitlab-token');
		mocks.connectContextRepository.mockResolvedValue({
			provider: 'gitlab',
			repoFullName: 'nao/context',
			defaultBranch: 'main',
			branch: 'main',
			connectionType: 'linked-existing-commit',
		});
	});

	it('connects a GitHub repository with the GitHub token', async () => {
		await createCaller().connectRepository({ provider: 'github', repoFullName: 'nao/context' });

		expect(mocks.getGithubToken).toHaveBeenCalledWith('user-id');
		expect(mocks.getGitlabToken).not.toHaveBeenCalled();
		expect(mocks.connectContextRepository).toHaveBeenCalledWith(
			expect.objectContaining({
				provider: 'github',
				repoFullName: 'nao/context',
				token: 'github-token',
			}),
		);
	});

	it('connects a GitLab repository with the GitLab token', async () => {
		await expect(
			createCaller().connectRepository({ provider: 'gitlab', repoFullName: 'nao/context' }),
		).resolves.toMatchObject({
			provider: 'gitlab',
			repoFullName: 'nao/context',
		});

		expect(mocks.getGitlabToken).toHaveBeenCalledWith('user-id');
		expect(mocks.getGithubToken).not.toHaveBeenCalled();
		expect(mocks.connectContextRepository).toHaveBeenCalledWith(
			expect.objectContaining({
				provider: 'gitlab',
				repoFullName: 'nao/context',
				token: 'gitlab-token',
			}),
		);
	});

	it('names GitLab when its token is missing', async () => {
		mocks.getGitlabToken.mockResolvedValue(null);

		await expect(
			createCaller().connectRepository({ provider: 'gitlab', repoFullName: 'nao/context' }),
		).rejects.toMatchObject({
			code: 'FORBIDDEN',
			message: 'Connect your GitLab account first.',
		});
		expect(mocks.connectContextRepository).not.toHaveBeenCalled();
	});
});

function createCaller() {
	return testRouter.createCaller({
		session: {
			user: {
				id: 'user-id',
				name: 'Test User',
				email: 'test@example.com',
			},
		},
		selectedProjectId: 'project-id',
	} as never);
}
