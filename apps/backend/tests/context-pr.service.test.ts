import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
	process.env.MODE = 'test';
	process.env.NAO_CONTEXT_SOURCE = 'local';
});

import {
	createRecommendationPullRequest,
	createReviewRequest,
	resolveRecommendationRepo,
} from '../src/services/context-pr.service';
import { GENERIC_GIT_PROVIDER } from '../src/services/generic-git';
import type { ProposedEdit } from '../src/types/context-recommendation';

const mocks = vi.hoisted(() => ({
	cloneRepo: vi.fn(),
	commitAllAndPushBranch: vi.fn(),
	createPullRequest: vi.fn(),
	findContextConfigSubPath: vi.fn().mockResolvedValue(''),
	getConfig: vi.fn(),
	getGitInfo: vi.fn(),
	getGithubToken: vi.fn(),
	getUser: vi.fn(),
	getProjectById: vi.fn(),
	getRecommendationById: vi.fn(),
	getRepoSubPath: vi.fn().mockReturnValue(''),
	getUserGitIdentity: vi.fn(),
	setRecommendationPr: vi.fn(),
}));

vi.mock('../src/queries/context-recommendation.queries', () => ({
	getConfig: mocks.getConfig,
	getRecommendationById: mocks.getRecommendationById,
	listRecommendations: vi.fn(),
	setRecommendationPr: mocks.setRecommendationPr,
	setRecommendationStatus: vi.fn(),
}));

vi.mock('../src/queries/project.queries', () => ({
	getProjectById: mocks.getProjectById,
}));

vi.mock('../src/queries/user.queries', () => ({
	getGithubToken: mocks.getGithubToken,
	getGitlabToken: vi.fn(),
	getUser: mocks.getUser,
}));

vi.mock('../src/utils/logger', () => ({
	logger: {
		error: vi.fn(),
		info: vi.fn(),
		warn: vi.fn(),
	},
	serializeError: (error: unknown) => ({
		message: error instanceof Error ? error.message : String(error),
	}),
}));

vi.mock('../src/services/git-repo', async (importOriginal) => ({
	...(await importOriginal<typeof import('../src/services/git-repo')>()),
	getRepoSubPath: mocks.getRepoSubPath,
}));

vi.mock('../src/services/github', () => ({
	NAO_CO_AUTHOR: { email: 'bot@nao.dev', name: 'nao' },
	cloneRepo: mocks.cloneRepo,
	commitAllAndPushBranch: mocks.commitAllAndPushBranch,
	createPullRequest: mocks.createPullRequest,
	findContextConfigSubPath: mocks.findContextConfigSubPath,
	getGitInfo: mocks.getGitInfo,
	getUserGitIdentity: mocks.getUserGitIdentity,
	pushBranch: vi.fn(),
}));

describe('createRecommendationPullRequest', () => {
	beforeEach(() => {
		vi.resetAllMocks();
		mocks.getProjectById.mockResolvedValue({ path: null });
		mocks.getConfig.mockResolvedValue({ repoFullName: 'nao/context' });
		mocks.getGithubToken.mockResolvedValue('github-token');
		mocks.getUser.mockResolvedValue({ id: 'user-1', name: 'User', email: 'user@example.com' });
		mocks.getGitInfo.mockReturnValue({ branch: 'main', isGithub: true, repoFullName: 'nao/context' });
		mocks.getRepoSubPath.mockReturnValue('');
		mocks.getUserGitIdentity.mockResolvedValue({ email: 'user@example.com', name: 'User' });
		mocks.createPullRequest.mockResolvedValue({ html_url: 'https://github.com/nao/context/pull/1' });
		mocks.findContextConfigSubPath.mockResolvedValue('');
	});

	it('writes proposed edits into the cloned repository', async () => {
		mocks.getRecommendationById.mockResolvedValue(recommendation());
		mocks.cloneRepo.mockImplementation((_token: string, _repoFullName: string, dir: string) => {
			fs.writeFileSync(path.join(dir, 'RULES.md'), 'old');
		});
		mocks.commitAllAndPushBranch.mockImplementation(({ dir }: { dir: string }) => {
			expect(fs.readFileSync(path.join(dir, 'RULES.md'), 'utf-8')).toBe('new');
		});

		await expect(createRecommendationPullRequest('project-1', 'rec-123456789', 'user-1')).resolves.toEqual({
			branch: expect.stringMatching(/^nao\/context-rec-1234/),
			url: 'https://github.com/nao/context/pull/1',
		});

		expect(mocks.commitAllAndPushBranch).toHaveBeenCalledOnce();
		expect(mocks.setRecommendationPr).toHaveBeenCalledWith('rec-123456789', {
			prBranch: expect.stringMatching(/^nao\/context-rec-1234/),
			prCreatedAt: expect.any(Date),
			prUrl: 'https://github.com/nao/context/pull/1',
		});
	});

	it('does not resolve or open context pull requests from the project folder remote', async () => {
		mocks.getConfig.mockResolvedValue(null);
		mocks.getProjectById.mockResolvedValue({ path: '/project-clone' });
		mocks.getRecommendationById.mockResolvedValue(recommendation());

		await expect(resolveRecommendationRepo('project-1')).resolves.toBeNull();
		await expect(createRecommendationPullRequest('project-1', 'rec-123456789', 'user-1')).rejects.toThrow(
			'No context repository is connected. Connect one in Settings → Git.',
		);

		expect(mocks.getProjectById).not.toHaveBeenCalled();
		expect(mocks.getGitInfo).not.toHaveBeenCalled();
		expect(mocks.cloneRepo).not.toHaveBeenCalled();
		expect(mocks.createPullRequest).not.toHaveBeenCalled();
	});

	it('opens linked repo edits without a connected context repository', async () => {
		mocks.getConfig.mockResolvedValue(null);
		mocks.getRecommendationById.mockResolvedValue(
			recommendation([
				edit({
					path: 'repos/dbt-models/models/orders.sql',
					targetRepo: {
						repoFullName: 'nao/dbt-models',
						branch: 'main',
						path: 'models/orders.sql',
						provider: 'github',
					},
				}),
			]),
		);
		mocks.cloneRepo.mockImplementation((_token: string, _repoFullName: string, dir: string) => {
			fs.mkdirSync(path.join(dir, 'models'), { recursive: true });
			fs.writeFileSync(path.join(dir, 'models/orders.sql'), 'old');
		});
		mocks.commitAllAndPushBranch.mockImplementation(
			({ dir, repoFullName }: { dir: string; repoFullName: string }) => {
				expect(repoFullName).toBe('nao/dbt-models');
				expect(fs.readFileSync(path.join(dir, 'models/orders.sql'), 'utf-8')).toBe('new');
				expect(fs.existsSync(path.join(dir, 'repos/dbt-models/models/orders.sql'))).toBe(false);
			},
		);

		await expect(createRecommendationPullRequest('project-1', 'rec-123456789', 'user-1')).resolves.toEqual({
			branch: expect.stringMatching(/^nao\/context-rec-1234/),
			url: 'https://github.com/nao/context/pull/1',
		});

		expect(mocks.cloneRepo).toHaveBeenCalledWith('github-token', 'nao/dbt-models', expect.any(String), 'main');
	});

	it('rejects recommendations that mix context and linked repo edits', async () => {
		mocks.getRecommendationById.mockResolvedValue(
			recommendation([
				edit(),
				edit({
					path: 'repos/dbt-models/models/orders.sql',
					targetRepo: {
						repoFullName: 'nao/dbt-models',
						branch: null,
						path: 'models/orders.sql',
						provider: 'github',
					},
				}),
			]),
		);

		await expect(createRecommendationPullRequest('project-1', 'rec-123456789', 'user-1')).rejects.toThrow(
			'cannot mix context repository edits with linked repository edits',
		);
		expect(mocks.cloneRepo).not.toHaveBeenCalled();
	});

	it('rejects proposed edits that would write through repository symlinks', async () => {
		const outsideDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nao-context-pr-outside-'));
		const outsideFile = path.join(outsideDir, 'RULES.md');
		fs.writeFileSync(outsideFile, 'outside');

		try {
			mocks.getRecommendationById.mockResolvedValue(recommendation());
			mocks.cloneRepo.mockImplementation((_token: string, _repoFullName: string, dir: string) => {
				fs.symlinkSync(outsideFile, path.join(dir, 'RULES.md'));
			});

			await expect(createRecommendationPullRequest('project-1', 'rec-123456789', 'user-1')).rejects.toThrow(
				'Refusing to write through a symlink',
			);

			expect(fs.readFileSync(outsideFile, 'utf-8')).toBe('outside');
			expect(mocks.commitAllAndPushBranch).not.toHaveBeenCalled();
			expect(mocks.createPullRequest).not.toHaveBeenCalled();
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
		mocks.getConfig.mockResolvedValue({ repoFullName: 'nao/context' });
		mocks.getRecommendationById.mockResolvedValue(recommendation());
		mocks.cloneRepo.mockImplementation((_token: string, _repoFullName: string, dir: string) => {
			fs.mkdirSync(path.join(dir, 'apps', 'nao'), { recursive: true });
			fs.writeFileSync(path.join(dir, 'apps', 'nao', 'nao_config.yaml'), 'project_name: demo\n');
			fs.writeFileSync(path.join(dir, 'apps', 'nao', 'RULES.md'), 'old');
		});
		mocks.commitAllAndPushBranch.mockImplementation(({ dir }: { dir: string }) => {
			expect(fs.readFileSync(path.join(dir, 'apps', 'nao', 'RULES.md'), 'utf-8')).toBe('new');
			expect(fs.existsSync(path.join(dir, 'RULES.md'))).toBe(false);
		});

		await expect(createRecommendationPullRequest('project-1', 'rec-123456789', 'user-1')).resolves.toMatchObject({
			url: 'https://github.com/nao/context/pull/1',
		});

		expect(mocks.commitAllAndPushBranch).toHaveBeenCalledOnce();
	});

	it('prefers the sub-path from the project git checkout when the clone confirms it', async () => {
		mocks.getProjectById.mockResolvedValue({ path: '/local/project' });
		mocks.getRepoSubPath.mockReturnValue('apps/nao');
		mocks.getRecommendationById.mockResolvedValue(recommendation());
		mocks.cloneRepo.mockImplementation((_token: string, _repoFullName: string, dir: string) => {
			fs.mkdirSync(path.join(dir, 'apps', 'nao'), { recursive: true });
			fs.writeFileSync(path.join(dir, 'apps', 'nao', 'nao_config.yaml'), 'project_name: demo\n');
			fs.writeFileSync(path.join(dir, 'apps', 'nao', 'RULES.md'), 'old');
			fs.mkdirSync(path.join(dir, 'elsewhere'), { recursive: true });
			fs.writeFileSync(path.join(dir, 'elsewhere', 'nao_config.yaml'), 'project_name: demo\n');
		});
		mocks.commitAllAndPushBranch.mockImplementation(({ dir }: { dir: string }) => {
			expect(fs.readFileSync(path.join(dir, 'apps', 'nao', 'RULES.md'), 'utf-8')).toBe('new');
			expect(fs.existsSync(path.join(dir, 'elsewhere', 'RULES.md'))).toBe(false);
		});

		await expect(createRecommendationPullRequest('project-1', 'rec-123456789', 'user-1')).resolves.toMatchObject({
			url: 'https://github.com/nao/context/pull/1',
		});

		expect(mocks.commitAllAndPushBranch).toHaveBeenCalledOnce();
	});

	it('falls back to clone detection when the local sub-path is absent in the context repo', async () => {
		mocks.getProjectById.mockResolvedValue({ path: '/local/project' });
		mocks.getRepoSubPath.mockReturnValue('apps/nao');
		mocks.getRecommendationById.mockResolvedValue(recommendation());
		mocks.cloneRepo.mockImplementation((_token: string, _repoFullName: string, dir: string) => {
			fs.mkdirSync(path.join(dir, 'context'), { recursive: true });
			fs.writeFileSync(path.join(dir, 'context', 'nao_config.yaml'), 'project_name: demo\n');
			fs.writeFileSync(path.join(dir, 'context', 'RULES.md'), 'old');
		});
		mocks.commitAllAndPushBranch.mockImplementation(({ dir }: { dir: string }) => {
			expect(fs.readFileSync(path.join(dir, 'context', 'RULES.md'), 'utf-8')).toBe('new');
			expect(fs.existsSync(path.join(dir, 'apps', 'nao', 'RULES.md'))).toBe(false);
		});

		await expect(createRecommendationPullRequest('project-1', 'rec-123456789', 'user-1')).resolves.toMatchObject({
			url: 'https://github.com/nao/context/pull/1',
		});

		expect(mocks.commitAllAndPushBranch).toHaveBeenCalledOnce();
	});

	it('writes at the repository root when nao_config.yaml sits at the root', async () => {
		mocks.getConfig.mockResolvedValue({ repoFullName: 'nao/context' });
		mocks.getRecommendationById.mockResolvedValue(recommendation());
		mocks.cloneRepo.mockImplementation((_token: string, _repoFullName: string, dir: string) => {
			fs.writeFileSync(path.join(dir, 'nao_config.yaml'), 'project_name: demo\n');
			fs.writeFileSync(path.join(dir, 'RULES.md'), 'old');
		});
		mocks.commitAllAndPushBranch.mockImplementation(({ dir }: { dir: string }) => {
			expect(fs.readFileSync(path.join(dir, 'RULES.md'), 'utf-8')).toBe('new');
		});

		await expect(createRecommendationPullRequest('project-1', 'rec-123456789', 'user-1')).resolves.toMatchObject({
			url: 'https://github.com/nao/context/pull/1',
		});

		expect(mocks.commitAllAndPushBranch).toHaveBeenCalledOnce();
	});
});

describe('resolveRecommendationRepo', () => {
	beforeEach(() => {
		vi.resetAllMocks();
		mocks.getProjectById.mockResolvedValue({ path: null });
		mocks.getConfig.mockResolvedValue({ repoFullName: 'sarah/lph' });
		mocks.getGithubToken.mockResolvedValue('github-token');
		mocks.findContextConfigSubPath.mockResolvedValue('');
	});

	it('leaves the sub-path empty when no user is provided to detect it', async () => {
		mocks.findContextConfigSubPath.mockResolvedValue('apps/example');

		const repo = await resolveRecommendationRepo('project-1');

		expect(repo).toMatchObject({ repoFullName: 'sarah/lph', source: 'settings', subPath: '' });
		expect(mocks.findContextConfigSubPath).not.toHaveBeenCalled();
	});

	it('detects the monorepo sub-path of a configured repo for the copyable prompt', async () => {
		mocks.findContextConfigSubPath.mockResolvedValue('apps/example');

		const repo = await resolveRecommendationRepo('project-1', 'user-1');

		expect(repo).toMatchObject({ repoFullName: 'sarah/lph', source: 'settings', subPath: 'apps/example' });
		expect(mocks.findContextConfigSubPath).toHaveBeenCalledWith('github-token', 'sarah/lph');
	});

	it('falls back to the repo root when nao_config.yaml cannot be located', async () => {
		mocks.findContextConfigSubPath.mockResolvedValue('');

		const repo = await resolveRecommendationRepo('project-1', 'user-1');

		expect(repo).toMatchObject({ subPath: '' });
	});
});

function recommendation(edits: ProposedEdit[] = [edit()]): unknown {
	return {
		fixKind: 'patch',
		id: 'rec-123456789',
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
