import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
	process.env.MODE = 'test';
	process.env.NAO_MODE = 'self-hosted';
	process.env.NAO_DEFAULT_PROJECT_PATH = '';
});

const ownershipMocks = vi.hoisted(() => ({
	listContextBranchOwnerships: vi.fn(),
	releaseContextBranch: vi.fn(),
}));

const projectMocks = vi.hoisted(() => ({
	getProjectById: vi.fn(),
}));

const repositoryMocks = vi.hoisted(() => ({
	resolveContextRepository: vi.fn(),
}));

const providerMocks = vi.hoisted(() => ({
	getToken: vi.fn(),
	findReviewRequestByBranch: vi.fn(),
}));

vi.mock('../src/queries/context-branch-ownership.queries', () => ownershipMocks);
vi.mock('../src/queries/project.queries', () => projectMocks);
vi.mock('../src/utils/context-repo', async (importOriginal) => ({
	...(await importOriginal<typeof import('../src/utils/context-repo')>()),
	resolveContextRepository: repositoryMocks.resolveContextRepository,
}));
vi.mock('../src/services/review-request-provider', () => ({
	REVIEW_REQUEST_PROVIDERS: {
		github: providerMocks,
		gitlab: providerMocks,
	},
}));
vi.mock('../src/utils/logger', () => ({
	logger: {
		debug: vi.fn(),
		info: vi.fn(),
		warn: vi.fn(),
	},
	serializeError: (error: unknown) => ({
		message: error instanceof Error ? error.message : String(error),
	}),
}));

import { runContextBranchCleanup } from '../src/handlers/context-branch-cleanup.handler';

const NOW = Date.UTC(2026, 6, 31, 12);
const OLD_COMPLETION = new Date(NOW - 25 * 60 * 60 * 1000).toISOString();
const RECENT_COMPLETION = new Date(NOW - 23 * 60 * 60 * 1000).toISOString();

describe('context branch cleanup', () => {
	const temporaryRoots: string[] = [];

	beforeEach(() => {
		vi.useFakeTimers({ toFake: ['Date'] });
		vi.setSystemTime(NOW);
		ownershipMocks.listContextBranchOwnerships.mockResolvedValue([]);
		ownershipMocks.releaseContextBranch.mockResolvedValue(undefined);
		providerMocks.getToken.mockResolvedValue('test-token');
		providerMocks.findReviewRequestByBranch.mockResolvedValue(mergedReviewRequest(OLD_COMPLETION));
		repositoryMocks.resolveContextRepository.mockResolvedValue({
			provider: 'github',
			repoFullName: 'nao/context',
			branch: 'main',
			source: 'settings',
			webUrl: 'https://github.com/nao/context',
		});
	});

	afterEach(() => {
		vi.useRealTimers();
		for (const root of temporaryRoots.splice(0)) {
			fs.rmSync(root, { recursive: true, force: true });
		}
		vi.clearAllMocks();
	});

	it('deletes a branch merged more than 24 hours ago and releases ownership', async () => {
		const fixture = createFixture(temporaryRoots);
		const branch = 'nao/context-edits-old';
		const worktree = createOwnedBranch(fixture, 'user-1', branch, { push: true, checkedOut: false });
		configureProject(fixture, [ownership(branch)]);

		await runContextBranchCleanup();

		expect(hasBranch(worktree, branch)).toBe(false);
		expect(ownershipMocks.releaseContextBranch).toHaveBeenCalledWith('project-id', branch, 'user-1');
	});

	it('keeps a branch merged less than 24 hours ago', async () => {
		const fixture = createFixture(temporaryRoots);
		const branch = 'nao/context-edits-recent';
		const worktree = createOwnedBranch(fixture, 'user-1', branch, { push: true, checkedOut: false });
		configureProject(fixture, [ownership(branch)]);
		providerMocks.findReviewRequestByBranch.mockResolvedValue(mergedReviewRequest(RECENT_COMPLETION));

		await runContextBranchCleanup();

		expect(hasBranch(worktree, branch)).toBe(true);
		expect(ownershipMocks.releaseContextBranch).not.toHaveBeenCalled();
	});

	it('keeps a branch while its review request is open', async () => {
		const fixture = createFixture(temporaryRoots);
		const branch = 'nao/context-edits-open';
		const worktree = createOwnedBranch(fixture, 'user-1', branch, { push: true, checkedOut: false });
		configureProject(fixture, [ownership(branch)]);
		providerMocks.findReviewRequestByBranch.mockResolvedValue({
			url: 'https://github.com/nao/context/pull/1',
			state: 'open',
			mergedAt: null,
			closedAt: null,
		});

		await runContextBranchCleanup();

		expect(hasBranch(worktree, branch)).toBe(true);
		expect(ownershipMocks.releaseContextBranch).not.toHaveBeenCalled();
	});

	it('keeps a branch when no review request is found', async () => {
		const fixture = createFixture(temporaryRoots);
		const branch = 'nao/context-edits-no-pr';
		const worktree = createOwnedBranch(fixture, 'user-1', branch, { push: true, checkedOut: false });
		configureProject(fixture, [ownership(branch)]);
		providerMocks.findReviewRequestByBranch.mockResolvedValue(null);

		await runContextBranchCleanup();

		expect(hasBranch(worktree, branch)).toBe(true);
		expect(ownershipMocks.releaseContextBranch).not.toHaveBeenCalled();
	});

	it('keeps a branch when its owner has no provider token', async () => {
		const fixture = createFixture(temporaryRoots);
		const branch = 'nao/context-edits-no-token';
		const worktree = createOwnedBranch(fixture, 'user-1', branch, { push: true, checkedOut: false });
		configureProject(fixture, [ownership(branch)]);
		providerMocks.getToken.mockResolvedValue(null);

		await runContextBranchCleanup();

		expect(hasBranch(worktree, branch)).toBe(true);
		expect(providerMocks.findReviewRequestByBranch).not.toHaveBeenCalled();
		expect(ownershipMocks.releaseContextBranch).not.toHaveBeenCalled();
	});

	it('keeps a branch with a commit absent from origin and the default branch', async () => {
		const fixture = createFixture(temporaryRoots);
		const branch = 'nao/context-edits-unpublished';
		const worktree = createOwnedBranch(fixture, 'user-1', branch, { push: false, checkedOut: false });
		configureProject(fixture, [ownership(branch)]);

		await runContextBranchCleanup();

		expect(hasBranch(worktree, branch)).toBe(true);
		expect(ownershipMocks.releaseContextBranch).not.toHaveBeenCalled();
	});

	it('keeps a branch when the worktree has uncommitted changes', async () => {
		const fixture = createFixture(temporaryRoots);
		const branch = 'nao/context-edits-dirty';
		const worktree = createOwnedBranch(fixture, 'user-1', branch, { push: true, checkedOut: false });
		fs.writeFileSync(path.join(worktree, 'uncommitted.md'), 'keep me\n');
		configureProject(fixture, [ownership(branch)]);

		await runContextBranchCleanup();

		expect(hasBranch(worktree, branch)).toBe(true);
		expect(ownershipMocks.releaseContextBranch).not.toHaveBeenCalled();
	});

	it('releases ownership without cloning when the worktree is missing', async () => {
		const fixture = createFixture(temporaryRoots);
		const branch = 'nao/context-edits-missing-worktree';
		configureProject(fixture, [ownership(branch)]);

		await runContextBranchCleanup();

		expect(ownershipMocks.releaseContextBranch).toHaveBeenCalledWith('project-id', branch, 'user-1');
		expect(fs.existsSync(path.join(fixture.root, '.nao', 'worktrees', 'project-id', 'user-1'))).toBe(false);
	});

	it('skips cleanup when no context repository is connected', async () => {
		const fixture = createFixture(temporaryRoots);
		const branch = 'nao/context-edits-disconnected';
		configureProject(fixture, [ownership(branch)]);
		repositoryMocks.resolveContextRepository.mockResolvedValue(null);

		await runContextBranchCleanup();

		expect(repositoryMocks.resolveContextRepository).toHaveBeenCalledWith('project-id');
		expect(providerMocks.getToken).not.toHaveBeenCalled();
		expect(providerMocks.findReviewRequestByBranch).not.toHaveBeenCalled();
		expect(ownershipMocks.releaseContextBranch).not.toHaveBeenCalled();
	});

	it('switches off a checked-out branch before deleting it', async () => {
		const fixture = createFixture(temporaryRoots);
		const branch = 'nao/context-edits-checked-out';
		const worktree = createOwnedBranch(fixture, 'user-1', branch, { push: true, checkedOut: true });
		configureProject(fixture, [ownership(branch)]);

		await runContextBranchCleanup();

		expect(hasBranch(worktree, branch)).toBe(false);
		expect(runGit(worktree, ['rev-parse', '--abbrev-ref', 'HEAD']).toString().trim()).toBe('HEAD');
		expect(ownershipMocks.releaseContextBranch).toHaveBeenCalledWith('project-id', branch, 'user-1');
	});

	it('continues processing later rows when one row throws', async () => {
		const fixture = createFixture(temporaryRoots);
		const failingBranch = 'nao/context-edits-failing';
		const cleanedBranch = 'nao/context-edits-cleaned';
		const firstWorktree = createOwnedBranch(fixture, 'user-1', failingBranch, { push: true, checkedOut: false });
		const secondWorktree = createOwnedBranch(fixture, 'user-2', cleanedBranch, { push: true, checkedOut: false });
		configureProject(fixture, [ownership(failingBranch), ownership(cleanedBranch, 'user-2')]);
		providerMocks.findReviewRequestByBranch.mockImplementation(async (_token, _repo, branch) => {
			if (branch === failingBranch) {
				throw new Error('provider unavailable');
			}
			return mergedReviewRequest(OLD_COMPLETION);
		});

		await runContextBranchCleanup();

		expect(hasBranch(firstWorktree, failingBranch)).toBe(true);
		expect(hasBranch(secondWorktree, cleanedBranch)).toBe(false);
		expect(ownershipMocks.releaseContextBranch).toHaveBeenCalledWith('project-id', cleanedBranch, 'user-2');
	});
});

interface Fixture {
	root: string;
	bare: string;
	live: string;
}

function createFixture(temporaryRoots: string[]): Fixture {
	const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nao-context-cleanup-'));
	temporaryRoots.push(root);
	const seed = path.join(root, 'seed');
	const live = path.join(root, 'live');
	const bare = path.join(root, 'remote.git');
	fs.mkdirSync(seed);
	fs.mkdirSync(live);
	runGit(seed, ['init', '--quiet', '--initial-branch=main']);
	fs.writeFileSync(path.join(seed, 'nao_config.yaml'), 'name: test\n');
	commitAll(seed, 'initial');
	runGit(root, ['init', '--bare', '--quiet', '--initial-branch=main', bare]);
	runGit(seed, ['push', bare, 'main']);
	return { root, bare, live };
}

function createOwnedBranch(
	fixture: Fixture,
	userId: string,
	branch: string,
	options: { push: boolean; checkedOut: boolean },
): string {
	const worktree = path.join(fixture.root, '.nao', 'worktrees', 'project-id', userId);
	fs.mkdirSync(path.dirname(worktree), { recursive: true });
	runGit(fixture.root, ['clone', '--quiet', fixture.bare, worktree]);
	runGit(worktree, ['switch', '--quiet', '-c', branch]);
	fs.writeFileSync(path.join(worktree, `${userId}.md`), `${branch}\n`);
	commitAll(worktree, branch);
	if (options.push) {
		runGit(worktree, ['push', '--quiet', '-u', 'origin', branch]);
	}
	if (!options.checkedOut) {
		runGit(worktree, ['switch', '--quiet', '--detach', 'origin/main']);
	}
	return worktree;
}

function configureProject(fixture: Fixture, ownerships: ReturnType<typeof ownership>[]): void {
	projectMocks.getProjectById.mockResolvedValue({ id: 'project-id', path: fixture.live });
	ownershipMocks.listContextBranchOwnerships.mockResolvedValue(ownerships);
}

function ownership(branch: string, userId = 'user-1') {
	return {
		id: `${userId}:${branch}`,
		projectId: 'project-id',
		branch,
		userId,
	};
}

function mergedReviewRequest(mergedAt: string) {
	return {
		url: 'https://github.com/nao/context/pull/1',
		state: 'merged' as const,
		mergedAt,
		closedAt: mergedAt,
	};
}

function hasBranch(worktree: string, branch: string): boolean {
	try {
		runGit(worktree, ['show-ref', '--verify', '--quiet', `refs/heads/${branch}`]);
		return true;
	} catch {
		return false;
	}
}

function commitAll(folder: string, message: string): void {
	runGit(folder, ['add', '-A']);
	runGit(folder, ['-c', 'user.name=Test', '-c', 'user.email=test@example.com', 'commit', '--quiet', '-m', message]);
}

function runGit(cwd: string, args: string[]): Buffer {
	return execFileSync('git', args, { cwd, stdio: 'pipe', timeout: 10_000 });
}
