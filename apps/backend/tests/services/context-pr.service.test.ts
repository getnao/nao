import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { beforeEach, describe, expect, it, type Mock, vi } from 'vitest';

vi.hoisted(() => {
	process.env.MODE = 'test';
	process.env.NAO_CONTEXT_SOURCE = 'local';
});

import {
	createRecommendationPullRequest,
	createReviewRequest,
	resolveRecommendationRepo,
} from '../../src/services/context-pr.service';
import { GENERIC_GIT_PROVIDER } from '../../src/services/generic-git';
import type { ProposedEdit } from '../../src/types/context-recommendation';

const mocks = vi.hoisted(() => {
	const createProviderMocks = () => ({
		cloneRepo: vi.fn(),
		commitAllAndPushBranch: vi.fn(),
		getGitInfo: vi.fn(),
		getUserGitIdentity: vi.fn(),
	});
	return {
		getConfig: vi.fn(),
		getGithubToken: vi.fn(),
		getGitlabToken: vi.fn(),
		getProjectById: vi.fn(),
		getRecommendationById: vi.fn(),
		getRepoSubPath: vi.fn(),
		getUser: vi.fn(),
		setRecommendationPr: vi.fn(),
		github: { ...createProviderMocks(), createPullRequest: vi.fn(), findContextConfigSubPath: vi.fn() },
		gitlab: { ...createProviderMocks(), createMergeRequest: vi.fn() },
	};
});

vi.mock('../../src/queries/context-recommendation.queries', () => ({
	getConfig: mocks.getConfig,
	getRecommendationById: mocks.getRecommendationById,
	listRecommendations: vi.fn(),
	setRecommendationPr: mocks.setRecommendationPr,
	setRecommendationStatus: vi.fn(),
}));

vi.mock('../../src/queries/project.queries', () => ({
	getProjectById: mocks.getProjectById,
}));

vi.mock('../../src/queries/user.queries', () => ({
	getGithubToken: mocks.getGithubToken,
	getGitlabToken: mocks.getGitlabToken,
	getUser: mocks.getUser,
}));

vi.mock('../../src/utils/logger', () => ({
	logger: {
		error: vi.fn(),
		info: vi.fn(),
		warn: vi.fn(),
	},
	serializeError: (error: unknown) => ({
		message: error instanceof Error ? error.message : String(error),
	}),
}));

vi.mock('../../src/services/git-repo', async (importOriginal) => ({
	...(await importOriginal<typeof import('../../src/services/git-repo')>()),
	getRepoSubPath: mocks.getRepoSubPath,
}));

vi.mock('../../src/services/github', () => ({
	NAO_CO_AUTHOR: { email: 'bot@nao.dev', name: 'nao' },
	...mocks.github,
	pushBranch: vi.fn(),
}));

vi.mock('../../src/services/gitlab', () => ({
	NAO_CO_AUTHOR: { email: 'bot@nao.dev', name: 'nao' },
	...mocks.gitlab,
	gitlabBaseUrl: () => 'https://gitlab.com',
	pushBranch: vi.fn(),
}));

const RECOMMENDATION_ID = 'rec-123456789';
const RECOMMENDATION_BRANCH = /^nao\/context-rec-1234/;
const USER = { id: 'user-1', name: 'User', email: 'user@example.com' };
const GIT_IDENTITY = { email: 'user@example.com', name: 'User' };
const GITHUB_PR_URL = 'https://github.com/nao/context/pull/1';
const GITLAB_MR_URL = 'https://gitlab.com/nao/context/-/merge_requests/1';
const CONTEXT_CONFIG = 'project_name: demo\n';

beforeEach(() => {
	vi.resetAllMocks();
	mocks.getProjectById.mockResolvedValue({ path: null });
	mocks.getUser.mockResolvedValue(USER);
	mocks.getGithubToken.mockResolvedValue('github-token');
	mocks.github.findContextConfigSubPath.mockResolvedValue('');
});

describe('createRecommendationPullRequest', () => {
	beforeEach(() => {
		mocks.getConfig.mockResolvedValue({ repoFullName: 'nao/context' });
		mocks.github.getGitInfo.mockReturnValue({ branch: 'main', isGithub: true, repoFullName: 'nao/context' });
		mocks.github.getUserGitIdentity.mockResolvedValue(GIT_IDENTITY);
		mocks.github.createPullRequest.mockResolvedValue({ html_url: GITHUB_PR_URL });
	});

	it('writes proposed edits into the cloned repository', async () => {
		mocks.getRecommendationById.mockResolvedValue(recommendation());
		cloneRepoWithFiles(mocks.github.cloneRepo, { 'RULES.md': 'old' });
		expectFilesOnPush(mocks.github.commitAllAndPushBranch, { 'RULES.md': 'new' });

		await expect(createRecommendationPr()).resolves.toEqual({
			branch: expect.stringMatching(RECOMMENDATION_BRANCH),
			url: GITHUB_PR_URL,
		});

		expect(mocks.github.commitAllAndPushBranch).toHaveBeenCalledOnce();
		expect(mocks.setRecommendationPr).toHaveBeenCalledWith(RECOMMENDATION_ID, {
			prBranch: expect.stringMatching(RECOMMENDATION_BRANCH),
			prCreatedAt: expect.any(Date),
			prUrl: GITHUB_PR_URL,
		});
	});

	it('does not resolve or open context pull requests from the project folder remote', async () => {
		mocks.getConfig.mockResolvedValue(null);
		mocks.getProjectById.mockResolvedValue({ path: '/project-clone' });
		mocks.getRecommendationById.mockResolvedValue(recommendation());

		await expect(resolveRecommendationRepo('project-1')).resolves.toBeNull();
		await expect(createRecommendationPr()).rejects.toThrow(
			'No context repository is connected. Connect one in Settings → Git.',
		);

		expect(mocks.getProjectById).not.toHaveBeenCalled();
		expect(mocks.github.getGitInfo).not.toHaveBeenCalled();
		expect(mocks.github.cloneRepo).not.toHaveBeenCalled();
		expect(mocks.github.createPullRequest).not.toHaveBeenCalled();
	});

	it('opens linked repo edits without a connected context repository', async () => {
		mocks.getConfig.mockResolvedValue(null);
		mocks.getRecommendationById.mockResolvedValue(recommendation([linkedRepoEdit('github', 'main')]));
		cloneRepoWithFiles(mocks.github.cloneRepo, { 'models/orders.sql': 'old' });
		expectFilesOnPush(mocks.github.commitAllAndPushBranch, {
			'models/orders.sql': 'new',
			'repos/dbt-models/models/orders.sql': null,
		});

		await expect(createRecommendationPr()).resolves.toEqual({
			branch: expect.stringMatching(RECOMMENDATION_BRANCH),
			url: GITHUB_PR_URL,
		});

		expect(mocks.github.commitAllAndPushBranch).toHaveBeenCalledWith(
			expect.objectContaining({ repoFullName: 'nao/dbt-models' }),
		);
		expect(mocks.github.cloneRepo).toHaveBeenCalledWith(
			'github-token',
			'nao/dbt-models',
			expect.any(String),
			'main',
		);
	});

	it('rejects recommendations that mix context and linked repo edits', async () => {
		mocks.getRecommendationById.mockResolvedValue(recommendation([edit(), linkedRepoEdit('github', null)]));

		await expect(createRecommendationPr()).rejects.toThrow(
			'cannot mix context repository edits with linked repository edits',
		);
		expect(mocks.github.cloneRepo).not.toHaveBeenCalled();
	});

	it('rejects proposed edits that would write through repository symlinks', async () => {
		const outsideDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nao-context-pr-outside-'));
		const outsideFile = path.join(outsideDir, 'RULES.md');
		fs.writeFileSync(outsideFile, 'outside');

		try {
			mocks.getRecommendationById.mockResolvedValue(recommendation());
			mocks.github.cloneRepo.mockImplementation((_token: string, _repoFullName: string, dir: string) => {
				fs.symlinkSync(outsideFile, path.join(dir, 'RULES.md'));
			});

			await expect(createRecommendationPr()).rejects.toThrow('Refusing to write through a symlink');

			expect(fs.readFileSync(outsideFile, 'utf-8')).toBe('outside');
			expect(mocks.github.commitAllAndPushBranch).not.toHaveBeenCalled();
			expect(mocks.github.createPullRequest).not.toHaveBeenCalled();
		} finally {
			fs.rmSync(outsideDir, { force: true, recursive: true });
		}
	});

	it('returns the review link printed while pushing a recommendation branch', async () => {
		const workdir = fs.mkdtempSync(path.join(os.tmpdir(), 'nao-context-pr-test-'));
		const link = 'http://git.example.com/nao/context/merge_requests/new?source=nao/recommendation';
		const commitAllAndPushBranch = vi.fn().mockReturnValue(`remote: Create merge request:\nremote:   ${link}`);

		try {
			await expect(
				createReviewRequest({
					provider: {
						...GENERIC_GIT_PROVIDER,
						getToken: async () => '',
						cloneRepo: (_token, _repoFullName, dir) => {
							fs.writeFileSync(path.join(dir, 'RULES.md'), 'old');
						},
						getGitInfo: () => ({ branch: 'main' }),
						commitAllAndPushBranch,
					},
					userId: 'user-1',
					repoFullName: 'git@git.example.com:nao/context.git',
					workdir,
					branch: 'nao/recommendation',
					configuredBase: 'main',
					edits: [{ path: 'RULES.md', newContent: 'new' }],
					title: 'Update context',
					commitMessage: 'Update context',
					body: 'Update the context rules.',
				}),
			).resolves.toEqual({ url: link });
			expect(commitAllAndPushBranch).toHaveBeenCalledOnce();
		} finally {
			fs.rmSync(workdir, { force: true, recursive: true });
		}
	});

	it('auto-detects the monorepo subPath from nao_config.yaml when none is configured', async () => {
		mocks.getRecommendationById.mockResolvedValue(recommendation());
		cloneRepoWithFiles(mocks.github.cloneRepo, {
			'apps/nao/nao_config.yaml': CONTEXT_CONFIG,
			'apps/nao/RULES.md': 'old',
		});
		expectFilesOnPush(mocks.github.commitAllAndPushBranch, { 'apps/nao/RULES.md': 'new', 'RULES.md': null });

		await expect(createRecommendationPr()).resolves.toMatchObject({ url: GITHUB_PR_URL });

		expect(mocks.github.commitAllAndPushBranch).toHaveBeenCalledOnce();
	});

	it('prefers the sub-path from the project git checkout when the clone confirms it', async () => {
		mocks.getProjectById.mockResolvedValue({ path: '/local/project' });
		mocks.getRepoSubPath.mockReturnValue('apps/nao');
		mocks.getRecommendationById.mockResolvedValue(recommendation());
		cloneRepoWithFiles(mocks.github.cloneRepo, {
			'apps/nao/nao_config.yaml': CONTEXT_CONFIG,
			'apps/nao/RULES.md': 'old',
			'elsewhere/nao_config.yaml': CONTEXT_CONFIG,
		});
		expectFilesOnPush(mocks.github.commitAllAndPushBranch, {
			'apps/nao/RULES.md': 'new',
			'elsewhere/RULES.md': null,
		});

		await expect(createRecommendationPr()).resolves.toMatchObject({ url: GITHUB_PR_URL });

		expect(mocks.github.commitAllAndPushBranch).toHaveBeenCalledOnce();
	});

	it('falls back to clone detection when the local sub-path is absent in the context repo', async () => {
		mocks.getProjectById.mockResolvedValue({ path: '/local/project' });
		mocks.getRepoSubPath.mockReturnValue('apps/nao');
		mocks.getRecommendationById.mockResolvedValue(recommendation());
		cloneRepoWithFiles(mocks.github.cloneRepo, {
			'context/nao_config.yaml': CONTEXT_CONFIG,
			'context/RULES.md': 'old',
		});
		expectFilesOnPush(mocks.github.commitAllAndPushBranch, {
			'context/RULES.md': 'new',
			'apps/nao/RULES.md': null,
		});

		await expect(createRecommendationPr()).resolves.toMatchObject({ url: GITHUB_PR_URL });

		expect(mocks.github.commitAllAndPushBranch).toHaveBeenCalledOnce();
	});

	it('writes at the repository root when nao_config.yaml sits at the root', async () => {
		mocks.getRecommendationById.mockResolvedValue(recommendation());
		cloneRepoWithFiles(mocks.github.cloneRepo, { 'nao_config.yaml': CONTEXT_CONFIG, 'RULES.md': 'old' });
		expectFilesOnPush(mocks.github.commitAllAndPushBranch, { 'RULES.md': 'new' });

		await expect(createRecommendationPr()).resolves.toMatchObject({ url: GITHUB_PR_URL });

		expect(mocks.github.commitAllAndPushBranch).toHaveBeenCalledOnce();
	});
});

describe('createRecommendationPullRequest (GitLab)', () => {
	beforeEach(() => {
		mocks.getConfig.mockResolvedValue({ repoFullName: 'nao/context', repoProvider: 'gitlab' });
		mocks.getGitlabToken.mockResolvedValue('gitlab-token');
		mocks.gitlab.getGitInfo.mockReturnValue({ branch: 'main', isGitlab: true, repoFullName: 'nao/context' });
		mocks.gitlab.getUserGitIdentity.mockResolvedValue(GIT_IDENTITY);
		mocks.gitlab.createMergeRequest.mockResolvedValue({ iid: 1, web_url: GITLAB_MR_URL });
	});

	it('writes proposed edits into the cloned repository and opens a merge request', async () => {
		mocks.getRecommendationById.mockResolvedValue(recommendation());
		cloneRepoWithFiles(mocks.gitlab.cloneRepo, { 'RULES.md': 'old' });
		expectFilesOnPush(mocks.gitlab.commitAllAndPushBranch, { 'RULES.md': 'new' });

		await expect(createRecommendationPr()).resolves.toEqual({
			branch: expect.stringMatching(RECOMMENDATION_BRANCH),
			url: GITLAB_MR_URL,
		});

		expect(mocks.gitlab.commitAllAndPushBranch).toHaveBeenCalledOnce();
		expect(mocks.setRecommendationPr).toHaveBeenCalledWith(RECOMMENDATION_ID, {
			prBranch: expect.stringMatching(RECOMMENDATION_BRANCH),
			prCreatedAt: expect.any(Date),
			prUrl: GITLAB_MR_URL,
		});
	});

	it('opens the merge request against the base branch from the cloned repo', async () => {
		mocks.getRecommendationById.mockResolvedValue(recommendation());
		mocks.gitlab.getGitInfo.mockReturnValue({ branch: 'develop', isGitlab: true, repoFullName: 'nao/context' });
		cloneRepoWithFiles(mocks.gitlab.cloneRepo, { 'RULES.md': 'old' });

		await createRecommendationPr();

		expect(mocks.gitlab.createMergeRequest).toHaveBeenCalledWith(
			'gitlab-token',
			'nao/context',
			expect.objectContaining({ target_branch: 'develop' }),
		);
	});

	it('opens linked GitLab repo edits against the upstream repository path', async () => {
		mocks.getRecommendationById.mockResolvedValue(recommendation([linkedRepoEdit('gitlab', 'main')]));
		cloneRepoWithFiles(mocks.gitlab.cloneRepo, { 'models/orders.sql': 'old' });
		expectFilesOnPush(mocks.gitlab.commitAllAndPushBranch, { 'models/orders.sql': 'new' });

		await expect(createRecommendationPr()).resolves.toEqual({
			branch: expect.stringMatching(RECOMMENDATION_BRANCH),
			url: GITLAB_MR_URL,
		});

		expect(mocks.gitlab.commitAllAndPushBranch).toHaveBeenCalledWith(
			expect.objectContaining({ repoFullName: 'nao/dbt-models' }),
		);
		expect(mocks.gitlab.cloneRepo).toHaveBeenCalledWith(
			'gitlab-token',
			'nao/dbt-models',
			expect.any(String),
			'main',
		);
	});

	it('rejects when GitLab token is not connected', async () => {
		mocks.getRecommendationById.mockResolvedValue(recommendation());
		mocks.getGitlabToken.mockResolvedValue(null);

		await expect(createRecommendationPr()).rejects.toThrow('GitLab is not connected');
		expect(mocks.gitlab.cloneRepo).not.toHaveBeenCalled();
	});
});

describe('resolveRecommendationRepo', () => {
	beforeEach(() => {
		mocks.getConfig.mockResolvedValue({ repoFullName: 'sarah/lph' });
	});

	it('leaves the sub-path empty when no user is provided to detect it', async () => {
		mocks.github.findContextConfigSubPath.mockResolvedValue('apps/example');

		const repo = await resolveRecommendationRepo('project-1');

		expect(repo).toMatchObject({ repoFullName: 'sarah/lph', source: 'settings', subPath: '' });
		expect(mocks.github.findContextConfigSubPath).not.toHaveBeenCalled();
	});

	it('detects the monorepo sub-path of a configured repo for the copyable prompt', async () => {
		mocks.github.findContextConfigSubPath.mockResolvedValue('apps/example');

		const repo = await resolveRecommendationRepo('project-1', 'user-1');

		expect(repo).toMatchObject({ repoFullName: 'sarah/lph', source: 'settings', subPath: 'apps/example' });
		expect(mocks.github.findContextConfigSubPath).toHaveBeenCalledWith('github-token', 'sarah/lph');
	});
});

function createRecommendationPr() {
	return createRecommendationPullRequest('project-1', RECOMMENDATION_ID, 'user-1');
}

function cloneRepoWithFiles(cloneRepo: Mock, files: Record<string, string>): void {
	cloneRepo.mockImplementation((_token: string, _repoFullName: string, dir: string) => {
		for (const [relativePath, content] of Object.entries(files)) {
			const filePath = path.join(dir, relativePath);
			fs.mkdirSync(path.dirname(filePath), { recursive: true });
			fs.writeFileSync(filePath, content);
		}
	});
}

/** Asserts the workdir content at push time; a `null` content means the file must not exist. */
function expectFilesOnPush(commitAllAndPushBranch: Mock, expectedFiles: Record<string, string | null>): void {
	commitAllAndPushBranch.mockImplementation(({ dir }: { dir: string }) => {
		for (const [relativePath, content] of Object.entries(expectedFiles)) {
			const filePath = path.join(dir, relativePath);
			if (content === null) {
				expect(fs.existsSync(filePath)).toBe(false);
			} else {
				expect(fs.readFileSync(filePath, 'utf-8')).toBe(content);
			}
		}
	});
}

function recommendation(edits: ProposedEdit[] = [edit()]): unknown {
	return {
		fixKind: 'patch',
		id: RECOMMENDATION_ID,
		prBranch: null,
		prUrl: null,
		projectId: 'project-1',
		proposedEdits: edits,
		suggestedAction: 'Update the rules.',
		summary: 'The current rules need an update.',
		title: 'Update rules',
	};
}

function edit(overrides: Partial<ProposedEdit> = {}): ProposedEdit {
	return {
		kind: 'edit',
		newContent: 'new',
		oldContent: 'old',
		path: 'RULES.md',
		...overrides,
	};
}

function linkedRepoEdit(provider: 'github' | 'gitlab', branch: string | null): ProposedEdit {
	return edit({
		path: 'repos/dbt-models/models/orders.sql',
		targetRepo: { repoFullName: 'nao/dbt-models', branch, path: 'models/orders.sql', provider },
	});
}
