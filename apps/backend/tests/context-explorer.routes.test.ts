import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
	connectContextRepository: vi.fn(),
	getFileTree: vi.fn(),
	getGithubToken: vi.fn(),
	getGitlabToken: vi.fn(),
	readFileContent: vi.fn(),
	resolveContextExplorerGit: vi.fn(),
	resolveContextExplorerGitSafely: vi.fn(),
	resolveContextRepository: vi.fn(),
	writeFileContent: vi.fn(),
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
	getFileTree: mocks.getFileTree,
	MAX_CONTEXT_FILE_SIZE: 1024 * 1024,
	readFileContent: mocks.readFileContent,
	searchFileContents: vi.fn(),
	writeFileContent: mocks.writeFileContent,
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
	resolveContextExplorerGit: mocks.resolveContextExplorerGit,
	resolveContextExplorerGitSafely: mocks.resolveContextExplorerGitSafely,
	suggestContextBranchName: vi.fn(),
	switchContextBranch: vi.fn(),
}));

vi.mock('../src/services/context-explorer-pr.service', () => ({
	pushContextExplorerBranch: vi.fn(),
}));

vi.mock('../src/utils/context-repo', () => ({
	resolveContextRepository: mocks.resolveContextRepository,
	resolveContextSourceGitToken: vi.fn(() => null),
	sanitizeContextSourceRepositoryUrl: vi.fn((url: string) => url),
}));

import { contextExplorerRoutes } from '../src/trpc/context-explorer.routes';
import { router } from '../src/trpc/trpc';

const testRouter = router(contextExplorerRoutes);

describe('context explorer repository connection', () => {
	beforeEach(() => {
		vi.resetAllMocks();
		mocks.getGithubToken.mockResolvedValue('github-token');
		mocks.getGitlabToken.mockResolvedValue('gitlab-token');
		mocks.resolveContextRepository.mockResolvedValue({
			provider: 'github',
		});
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

describe('context explorer file access', () => {
	beforeEach(() => {
		vi.resetAllMocks();
		mocks.getGithubToken.mockResolvedValue('github-token');
		mocks.resolveContextRepository.mockResolvedValue({ provider: 'github' });
	});

	it('returns the source file tree without resolving Git', async () => {
		const entries = [
			{ name: 'folder', path: '/folder', type: 'directory', children: [] },
			{ name: 'nao_config.yaml', path: '/nao_config.yaml', type: 'file' },
		];
		mocks.getFileTree.mockResolvedValue(entries);
		mocks.resolveContextExplorerGit.mockRejectedValue(new Error('clone failed'));
		mocks.resolveContextExplorerGitSafely.mockRejectedValue(new Error('clone failed'));

		await expect(createCaller().getFileTree()).resolves.toEqual({ entries });

		expect(mocks.getFileTree).toHaveBeenCalledWith('/tmp/nao-project');
		expect(mocks.resolveContextExplorerGit).not.toHaveBeenCalled();
		expect(mocks.resolveContextExplorerGitSafely).not.toHaveBeenCalled();
	});

	it('uses safe Git resolution for reads and strict resolution for writes', async () => {
		const unavailableGit = {
			status: 'unavailable',
			reason: 'git-unavailable',
			message: 'Repository status is temporarily unavailable.',
			repo: null,
		};
		const availableGit = {
			status: 'available',
			repo: {},
			context: {},
		};
		mocks.resolveContextExplorerGitSafely.mockResolvedValue(unavailableGit);
		mocks.resolveContextExplorerGit.mockResolvedValue(availableGit);
		mocks.readFileContent.mockResolvedValue({
			content: 'source\n',
			hash: 'hash',
			isEditable: false,
			reason: 'git-unavailable',
		});
		mocks.writeFileContent.mockResolvedValue({ hash: 'updated-hash' });

		await createCaller().readFile({ path: '/context.md' });
		expect(mocks.resolveContextExplorerGitSafely).toHaveBeenCalledOnce();
		expect(mocks.readFileContent).toHaveBeenCalledWith(
			'/context.md',
			expect.objectContaining({ git: unavailableGit }),
		);

		await createCaller().writeFile({
			path: '/context.md',
			content: 'updated\n',
			expectedHash: '0'.repeat(64),
		});
		expect(mocks.resolveContextExplorerGit).toHaveBeenCalledOnce();
		expect(mocks.writeFileContent).toHaveBeenCalledWith(
			'/context.md',
			'updated\n',
			'0'.repeat(64),
			expect.objectContaining({ git: availableGit }),
		);
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
