import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
	ContextProjectResolutionError: class ContextProjectResolutionError extends Error {},
	completeActivity: vi.fn(),
	connectContextRepository: vi.fn(),
	failActivity: vi.fn(),
	getContextFileDiff: vi.fn(),
	getFileTree: vi.fn(),
	getGithubToken: vi.fn(),
	getGitlabToken: vi.fn(),
	getContextRepositoryStatus: vi.fn(),
	getUserRoleInProject: vi.fn(),
	listContextPullActivities: vi.fn(),
	loggerWarn: vi.fn(),
	pullLiveContext: vi.fn(),
	readFileContent: vi.fn(),
	resolveContextExplorerGit: vi.fn(),
	resolveContextExplorerGitSafely: vi.fn(),
	resolveContextRepository: vi.fn(),
	sanitizeLiveContextError: vi.fn((error: unknown) =>
		error instanceof Error ? error : new Error('Context pull failed.'),
	),
	startContextPullActivity: vi.fn(),
	writeFileContent: vi.fn(),
}));

vi.mock('../src/auth', () => ({ getAuth: vi.fn() }));
vi.mock('../src/services/sso-group-mapping.service', () => ({ isGroupRoleMappingActive: vi.fn(async () => false) }));
vi.mock('../src/utils/logger', () => ({
	logger: { warn: mocks.loggerWarn },
	serializeError: (error: unknown) => ({ message: error instanceof Error ? error.message : String(error) }),
}));
vi.mock('../src/queries/activity.queries', () => ({
	completeActivity: mocks.completeActivity,
	failActivity: mocks.failActivity,
	listContextPullActivities: mocks.listContextPullActivities,
	startContextPullActivity: mocks.startContextPullActivity,
}));

vi.mock('../src/queries/project.queries', () => ({
	getProjectByUserId: vi.fn(async () => ({
		id: 'project-id',
		name: 'Test project',
		path: '/tmp/nao-project',
		envVars: {},
	})),
	getUserRoleInProject: mocks.getUserRoleInProject,
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
	getContextFileDiff: mocks.getContextFileDiff,
	getContextRepositoryStatus: mocks.getContextRepositoryStatus,
	pullLiveContext: mocks.pullLiveContext,
	resolveContextExplorerGit: mocks.resolveContextExplorerGit,
	resolveContextExplorerGitSafely: mocks.resolveContextExplorerGitSafely,
	sanitizeLiveContextError: mocks.sanitizeLiveContextError,
	suggestContextBranchName: vi.fn(),
	switchContextBranch: vi.fn(),
}));

vi.mock('../src/services/context-explorer-pr.service', () => ({
	pushContextExplorerBranch: vi.fn(),
}));

vi.mock('../src/utils/context-repo', () => ({
	ContextProjectResolutionError: mocks.ContextProjectResolutionError,
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
		mocks.getUserRoleInProject.mockResolvedValue('admin');
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
		mocks.getUserRoleInProject.mockResolvedValue('admin');
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

	it('passes validated historical commit ranges to the file diff service', async () => {
		const from = 'a'.repeat(40);
		const to = 'B'.repeat(64);
		mocks.resolveContextExplorerGit.mockResolvedValue({ status: 'available', repo: {}, context: {} });
		mocks.getContextFileDiff.mockResolvedValue({
			path: '/context.md',
			kind: 'modified',
			additions: 1,
			deletions: 1,
			oldContent: 'old\n',
			newContent: 'new\n',
		});

		await createCaller().getFileDiff({ path: '/context.md', from, to });

		expect(mocks.getContextFileDiff).toHaveBeenCalledWith(
			expect.objectContaining({ projectId: 'project-id', projectFolder: '/tmp/nao-project' }),
			'/context.md',
			{ fromCommit: from, toCommit: to },
		);
	});

	it.each([
		{ path: '/context.md', from: 'abc1234', to: 'b'.repeat(40) },
		{ path: '/context.md', from: 'a'.repeat(40) },
		{ path: '/context.md', to: 'b'.repeat(40) },
	])('rejects invalid or partial historical commit ranges', async (input) => {
		await expect(createCaller().getFileDiff(input)).rejects.toMatchObject({ code: 'BAD_REQUEST' });
		expect(mocks.getContextFileDiff).not.toHaveBeenCalled();
	});
});

describe('live context update access', () => {
	beforeEach(() => {
		vi.resetAllMocks();
		mocks.getUserRoleInProject.mockResolvedValue('admin');
		mocks.getGithubToken.mockResolvedValue('github-token');
		mocks.resolveContextRepository.mockResolvedValue({ provider: 'github' });
		mocks.getContextRepositoryStatus.mockResolvedValue({
			liveContextUpdate: { enabled: true, available: true, configuredBranch: 'main' },
		});
		mocks.sanitizeLiveContextError.mockImplementation((error: unknown) =>
			error instanceof Error ? error : new Error('Context pull failed.'),
		);
		mocks.startContextPullActivity.mockResolvedValue({ id: 'activity-id' });
		mocks.pullLiveContext.mockReturnValue({
			changed: false,
			checkedAt: '2026-08-27T10:00:00.000Z',
			configuredBranch: 'main',
			oldCommit: 'a'.repeat(40),
			newCommit: 'a'.repeat(40),
			files: [],
		});
	});

	it('records a successful no-change pull for project admins', async () => {
		await expect(createCaller().pullLiveContext()).resolves.toMatchObject({ changed: false, files: [] });

		expect(mocks.startContextPullActivity).toHaveBeenCalledWith('project-id', 'user-id');
		expect(mocks.pullLiveContext).toHaveBeenCalledWith(
			expect.objectContaining({
				projectId: 'project-id',
				projectFolder: '/tmp/nao-project',
				userId: 'user-id',
				token: 'github-token',
			}),
		);
		expect(mocks.completeActivity).toHaveBeenCalledWith('activity-id', {
			configuredBranch: 'main',
			changed: false,
			oldCommit: 'a'.repeat(40),
			newCommit: 'a'.repeat(40),
			fileCount: 0,
			files: [],
		});
	});

	it('records changed file details for a successful pull', async () => {
		const files = [{ path: '/context.md', additions: 2, deletions: 1 }];
		mocks.pullLiveContext.mockReturnValue({
			changed: true,
			checkedAt: '2026-08-27T10:00:00.000Z',
			configuredBranch: 'main',
			oldCommit: 'a'.repeat(40),
			newCommit: 'b'.repeat(40),
			files,
		});

		await createCaller().pullLiveContext();

		expect(mocks.completeActivity).toHaveBeenCalledWith(
			'activity-id',
			expect.objectContaining({ configuredBranch: 'main', changed: true, files }),
		);
	});

	it('limits persisted file details without truncating the pull result', async () => {
		const files = Array.from({ length: 1_001 }, (_, index) => ({
			path: `/context-${index}.md`,
			additions: 1,
			deletions: 0,
		}));
		mocks.pullLiveContext.mockReturnValue({
			changed: true,
			checkedAt: '2026-08-27T10:00:00.000Z',
			configuredBranch: 'main',
			oldCommit: 'a'.repeat(40),
			newCommit: 'b'.repeat(40),
			files,
		});

		const result = await createCaller().pullLiveContext();

		expect(result.files).toEqual(files);
		expect(result.files).toHaveLength(1_001);
		expect(mocks.completeActivity).toHaveBeenCalledWith(
			'activity-id',
			expect.objectContaining({
				newCommit: 'b'.repeat(40),
				fileCount: 1_001,
				files: files.slice(0, 1_000),
			}),
		);
		mocks.listContextPullActivities.mockResolvedValue([
			{
				id: 'large-pull',
				status: 'completed',
				payload: mocks.completeActivity.mock.calls[0][1],
				errorMessage: null,
				startedAt: new Date('2026-08-27T10:00:00.000Z'),
				completedAt: new Date('2026-08-27T10:00:01.000Z'),
				actorName: 'Admin User',
			},
		]);

		await expect(createCaller().getLiveContextPullHistory()).resolves.toEqual([
			expect.objectContaining({
				newCommit: 'b'.repeat(40),
				fileCount: 1_001,
				files: files.slice(0, 1_000),
			}),
		]);
	});

	it('records and parses a first repository clone without an old commit', async () => {
		mocks.pullLiveContext.mockReturnValue({
			changed: true,
			checkedAt: '2026-08-27T10:00:00.000Z',
			configuredBranch: 'main',
			oldCommit: null,
			newCommit: 'b'.repeat(40),
			files: [{ path: '/context.md', additions: 1, deletions: 0 }],
		});

		await createCaller().pullLiveContext();

		expect(mocks.completeActivity).toHaveBeenCalledWith(
			'activity-id',
			expect.objectContaining({ oldCommit: null, newCommit: 'b'.repeat(40) }),
		);
		mocks.listContextPullActivities.mockResolvedValue([
			{
				id: 'initial-clone',
				status: 'completed',
				payload: {
					configuredBranch: 'main',
					changed: true,
					oldCommit: null,
					newCommit: 'b'.repeat(40),
					files: [{ path: '/context.md', additions: 1, deletions: 0 }],
				},
				errorMessage: null,
				startedAt: new Date('2026-08-27T10:00:00.000Z'),
				completedAt: new Date('2026-08-27T10:00:01.000Z'),
				actorName: 'Admin User',
			},
		]);

		await expect(createCaller().getLiveContextPullHistory()).resolves.toEqual([
			expect.objectContaining({ oldCommit: null, newCommit: 'b'.repeat(40) }),
		]);
	});

	it('returns a successful pull when completing its history fails', async () => {
		mocks.completeActivity.mockRejectedValue(new Error('database unavailable'));

		await expect(createCaller().pullLiveContext()).resolves.toMatchObject({ changed: false });

		expect(mocks.failActivity).not.toHaveBeenCalled();
		expect(mocks.loggerWarn).toHaveBeenCalledWith('Context pull completed, but its history could not be saved.', {
			source: 'system',
			context: {
				projectId: 'project-id',
				activityId: 'activity-id',
				error: { message: 'database unavailable' },
			},
		});
	});

	it('records sanitized pull failures', async () => {
		mocks.pullLiveContext.mockImplementation(() => {
			throw new Error('safe pull failure');
		});

		await expect(createCaller().pullLiveContext()).rejects.toThrow('safe pull failure');

		expect(mocks.failActivity).toHaveBeenCalledWith('activity-id', 'safe pull failure');
	});

	it('maps context project resolution failures to bad requests', async () => {
		mocks.pullLiveContext.mockImplementation(() => {
			throw new mocks.ContextProjectResolutionError('Configured context subfolder was not found.');
		});

		await expect(createCaller().pullLiveContext()).rejects.toMatchObject({
			code: 'BAD_REQUEST',
			message: 'Configured context subfolder was not found.',
		});
		expect(mocks.failActivity).toHaveBeenCalledWith('activity-id', 'Configured context subfolder was not found.');
	});

	it('records failures while creating the Git context', async () => {
		const setupError = new Error('repository setup failed');
		mocks.resolveContextRepository.mockRejectedValue(setupError);

		await expect(createCaller().pullLiveContext()).rejects.toMatchObject({
			code: 'INTERNAL_SERVER_ERROR',
			message: 'repository setup failed',
		});
		expect(mocks.sanitizeLiveContextError).toHaveBeenCalledWith(setupError, undefined);
		expect(mocks.failActivity).toHaveBeenCalledWith('activity-id', 'repository setup failed');
		expect(mocks.pullLiveContext).not.toHaveBeenCalled();
	});

	it('lets context admins read status but not pull the live context', async () => {
		mocks.getUserRoleInProject.mockResolvedValue('context_admin');

		await expect(createCaller().getRepositoryStatus()).resolves.toMatchObject({
			liveContextUpdate: { enabled: true, available: true },
		});
		await expect(createCaller().pullLiveContext()).rejects.toMatchObject({ code: 'FORBIDDEN' });
		expect(mocks.pullLiveContext).not.toHaveBeenCalled();
	});

	it('returns safely parsed history newest first to context admins', async () => {
		mocks.getUserRoleInProject.mockResolvedValue('context_admin');
		mocks.listContextPullActivities.mockResolvedValue([
			{
				id: 'newest',
				status: 'completed',
				payload: {
					configuredBranch: 'main',
					changed: true,
					oldCommit: 'a'.repeat(40),
					newCommit: 'b'.repeat(40),
					files: [{ path: '/context.md', additions: 1, deletions: 0 }],
				},
				errorMessage: null,
				startedAt: new Date('2026-08-27T11:00:00.000Z'),
				completedAt: new Date('2026-08-27T11:00:01.000Z'),
				actorName: 'Admin User',
			},
			{
				id: 'legacy',
				status: 'completed',
				payload: {
					configuredBranch: 'main',
					changed: false,
					oldCommit: 'a'.repeat(40),
					newCommit: 'a'.repeat(40),
					files: [],
				},
				errorMessage: null,
				startedAt: new Date('2026-08-27T10:30:00.000Z'),
				completedAt: new Date('2026-08-27T10:30:01.000Z'),
				actorName: 'Legacy Admin',
			},
			{
				id: 'older',
				status: 'failed',
				payload: { untrusted: true },
				errorMessage: 'Safe failure',
				startedAt: new Date('2026-08-27T10:00:00.000Z'),
				completedAt: new Date('2026-08-27T10:00:01.000Z'),
				actorName: null,
			},
		]);

		const history = await createCaller().getLiveContextPullHistory();

		expect(history).toEqual([
			expect.objectContaining({
				id: 'newest',
				changed: true,
				fileCount: 1,
				files: [{ path: '/context.md', additions: 1, deletions: 0 }],
			}),
			expect.objectContaining({
				id: 'legacy',
				changed: false,
				newCommit: 'a'.repeat(40),
				fileCount: 0,
			}),
			expect.objectContaining({
				id: 'older',
				changed: null,
				fileCount: 0,
				files: [],
				errorMessage: 'Safe failure',
			}),
		]);
		expect(history[0]).not.toHaveProperty('actorName');
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
