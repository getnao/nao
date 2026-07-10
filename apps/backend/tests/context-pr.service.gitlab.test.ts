import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createRecommendationPullRequest } from '../src/services/context-pr.service';
import type { ProposedEdit } from '../src/types/context-recommendation';

const mocks = vi.hoisted(() => ({
	cloneRepo: vi.fn(),
	commitAllAndPushBranch: vi.fn(),
	createMergeRequest: vi.fn(),
	getConfig: vi.fn(),
	getGitInfo: vi.fn(),
	getGitlabToken: vi.fn(),
	getGithubToken: vi.fn(),
	getProjectById: vi.fn(),
	getRecommendationById: vi.fn(),
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
	getGitlabToken: mocks.getGitlabToken,
}));

vi.mock('../src/utils/logger', () => ({
	logger: {
		error: vi.fn(),
		info: vi.fn(),
		warn: vi.fn(),
	},
}));

vi.mock('../src/services/github', () => ({
	NAO_CO_AUTHOR: { email: 'bot@nao.dev', name: 'nao' },
	cloneRepo: vi.fn(),
	commitAllAndPushBranch: vi.fn(),
	createPullRequest: vi.fn(),
	getGitInfo: vi.fn().mockReturnValue({ branch: null, isGithub: false, repoFullName: null }),
	getUserGitIdentity: vi.fn(),
}));

vi.mock('../src/services/gitlab', () => ({
	NAO_CO_AUTHOR: { email: 'bot@nao.dev', name: 'nao' },
	cloneRepo: mocks.cloneRepo,
	commitAllAndPushBranch: mocks.commitAllAndPushBranch,
	createMergeRequest: mocks.createMergeRequest,
	getGitInfo: mocks.getGitInfo,
	getUserGitIdentity: mocks.getUserGitIdentity,
	gitlabBaseUrl: () => 'https://gitlab.com',
}));

describe('createRecommendationPullRequest (GitLab)', () => {
	beforeEach(() => {
		vi.resetAllMocks();
		mocks.getProjectById.mockResolvedValue({ path: null });
		mocks.getConfig.mockResolvedValue({ repoFullName: 'nao/context', repoProvider: 'gitlab' });
		mocks.getGitlabToken.mockResolvedValue('gitlab-token');
		mocks.getGitInfo.mockReturnValue({ branch: 'main', isGitlab: true, repoFullName: 'nao/context' });
		mocks.getUserGitIdentity.mockResolvedValue({ email: 'user@example.com', name: 'User' });
		mocks.createMergeRequest.mockResolvedValue({
			iid: 1,
			web_url: 'https://gitlab.com/nao/context/-/merge_requests/1',
		});
	});

	it('writes proposed edits into the cloned repository and opens a merge request', async () => {
		mocks.getRecommendationById.mockResolvedValue(recommendation());
		mocks.cloneRepo.mockImplementation((_token: string, _repoFullName: string, dir: string) => {
			fs.writeFileSync(path.join(dir, 'RULES.md'), 'old');
		});
		mocks.commitAllAndPushBranch.mockImplementation(({ dir }: { dir: string }) => {
			expect(fs.readFileSync(path.join(dir, 'RULES.md'), 'utf-8')).toBe('new');
		});

		await expect(createRecommendationPullRequest('project-1', 'rec-123456789', 'user-1')).resolves.toEqual({
			branch: expect.stringMatching(/^nao\/context-rec-1234/),
			url: 'https://gitlab.com/nao/context/-/merge_requests/1',
		});

		expect(mocks.commitAllAndPushBranch).toHaveBeenCalledOnce();
		expect(mocks.setRecommendationPr).toHaveBeenCalledWith('rec-123456789', {
			prBranch: expect.stringMatching(/^nao\/context-rec-1234/),
			prCreatedAt: expect.any(Date),
			prUrl: 'https://gitlab.com/nao/context/-/merge_requests/1',
		});
	});

	it('opens the merge request against the base branch from the cloned repo', async () => {
		mocks.getRecommendationById.mockResolvedValue(recommendation());
		mocks.getGitInfo.mockReturnValue({ branch: 'develop', isGitlab: true, repoFullName: 'nao/context' });
		mocks.cloneRepo.mockImplementation((_token: string, _repoFullName: string, dir: string) => {
			fs.writeFileSync(path.join(dir, 'RULES.md'), 'old');
		});

		await createRecommendationPullRequest('project-1', 'rec-123456789', 'user-1');

		expect(mocks.createMergeRequest).toHaveBeenCalledWith(
			'gitlab-token',
			'nao/context',
			expect.objectContaining({ target_branch: 'develop' }),
		);
	});

	it('opens linked GitLab repo edits against the upstream repository path', async () => {
		mocks.getRecommendationById.mockResolvedValue(
			recommendation([
				edit({
					path: 'repos/dbt-models/models/orders.sql',
					targetRepo: {
						repoFullName: 'nao/dbt-models',
						branch: 'main',
						path: 'models/orders.sql',
						provider: 'gitlab',
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
			},
		);

		await expect(createRecommendationPullRequest('project-1', 'rec-123456789', 'user-1')).resolves.toEqual({
			branch: expect.stringMatching(/^nao\/context-rec-1234/),
			url: 'https://gitlab.com/nao/context/-/merge_requests/1',
		});

		expect(mocks.cloneRepo).toHaveBeenCalledWith('gitlab-token', 'nao/dbt-models', expect.any(String));
	});

	it('rejects when GitLab token is not connected', async () => {
		mocks.getRecommendationById.mockResolvedValue(recommendation());
		mocks.getGitlabToken.mockResolvedValue(null);

		await expect(createRecommendationPullRequest('project-1', 'rec-123456789', 'user-1')).rejects.toThrow(
			'GitLab is not connected',
		);
		expect(mocks.cloneRepo).not.toHaveBeenCalled();
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
						provider: 'gitlab',
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
			expect(mocks.createMergeRequest).not.toHaveBeenCalled();
		} finally {
			fs.rmSync(outsideDir, { force: true, recursive: true });
		}
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
