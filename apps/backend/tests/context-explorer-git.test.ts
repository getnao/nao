import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
	process.env.MODE = 'test';
	process.env.NAO_MODE = 'self-hosted';
	process.env.NAO_DEFAULT_PROJECT_PATH = '';
	delete process.env.NAO_CONTEXT_SOURCE;
	delete process.env.NAO_CONTEXT_GIT_URL;
	delete process.env.NAO_CONTEXT_GIT_BRANCH;
	delete process.env.NAO_CONTEXT_GIT_SUBPATH;
	delete process.env.NAO_CONTEXT_GIT_TOKEN;
	delete process.env.NAO_CONTEXT_GIT_SSH_KEY;
});

const branchOwnershipMocks = vi.hoisted(() => {
	const owners = new Map<string, string>();
	return {
		owners,
		claimContextBranch: vi.fn(async (projectId: string, branch: string, userId: string) => {
			const key = `${projectId}:${branch}`;
			if (owners.has(key)) {
				return false;
			}
			owners.set(key, userId);
			return true;
		}),
		releaseContextBranch: vi.fn(async (projectId: string, branch: string, userId: string) => {
			const key = `${projectId}:${branch}`;
			if (owners.get(key) === userId) {
				owners.delete(key);
			}
		}),
		getOwnedContextBranches: vi.fn(async (projectId: string, userId: string) => {
			return new Set(
				[...owners]
					.filter(([key, owner]) => key.startsWith(`${projectId}:`) && owner === userId)
					.map(([key]) => key.slice(projectId.length + 1)),
			);
		}),
		isContextBranchOwnedByUser: vi.fn(async (projectId: string, branch: string, userId: string) => {
			return owners.get(`${projectId}:${branch}`) === userId;
		}),
	};
});

const contextConfigMocks = vi.hoisted(() => ({
	getConfig: vi.fn(),
	updateConfig: vi.fn(),
}));

vi.mock('../src/queries/context-branch-ownership.queries', () => branchOwnershipMocks);
vi.mock('../src/queries/context-recommendation.queries', () => contextConfigMocks);

import { __reloadEnvForTesting } from '../src/env';
import { getFileTreeResponse, readFileContent, writeFileContent } from '../src/services/context-explorer.service';
import {
	assertSafeDestructiveWorktreeCommand,
	assertSafeDestructiveWorktreeTarget,
	cleanupContextWorktree,
	commitContextChanges,
	connectContextRepository,
	type ContextExplorerGitContext,
	type ContextRepositoryProvider,
	createContextBranch,
	createContextBranchAndCommit,
	discardAllContextChanges,
	discardContextFileChange,
	disconnectContextRepository,
	ensureContextWorktree,
	getChangedContextFiles,
	getContextRepositoryStatus,
	getDeploymentContextSource,
	normalizeRemote,
	resolveContextExplorerGit,
	sanitizeContextSourceRepositoryUrl,
	switchContextBranch,
} from '../src/services/context-explorer-git.service';
import { pushContextExplorerBranch } from '../src/services/context-explorer-pr.service';
import { getContextWorktreePath, resolveContextRepository } from '../src/utils/context-repo';

describe('deployment context source', () => {
	let originalEnv: typeof process.env;

	beforeEach(() => {
		originalEnv = { ...process.env };
	});

	afterEach(() => {
		process.env = originalEnv;
		__reloadEnvForTesting();
	});

	it.each([
		['https://user:token@host/org/repo.git', 'https://host/org/repo.git'],
		['https://host/org/repo.git', 'https://host/org/repo.git'],
		['git@host:org/repo.git', 'git@host:org/repo.git'],
	])('sanitizes repository URL %s', (repositoryUrl, expected) => {
		expect(sanitizeContextSourceRepositoryUrl(repositoryUrl)).toBe(expected);
	});

	it.each([
		['ssh-key', { token: 'secret-token', sshKey: 'private-key' }],
		['token', { token: 'secret-token' }],
		['public', {}],
	] as const)('resolves %s authentication', (authMethod, credentials) => {
		setContextSourceEnv(credentials);

		expect(getDeploymentContextSource()?.authMethod).toBe(authMethod);
	});

	it('returns no context source when deployment Git mode is unset', () => {
		setContextSourceEnv({ source: null });

		expect(getDeploymentContextSource()).toBeNull();
	});

	it('includes sanitized context source details while context editing is read-only', async () => {
		setContextSourceEnv({
			url: 'https://user:secret@github.com/nao/context.git',
			branch: 'production',
			subpath: 'projects/analytics',
			token: 'secret',
		});

		const status = await getContextRepositoryStatus({
			...baseContext(process.cwd(), null),
			integrationAvailableOverride: false,
		});

		expect(status).toMatchObject({
			managedByContextSource: true,
			gitUnavailableReason: 'no-repo',
			gitUnavailableMessage:
				'No context repository is connected. Connect one in Git settings to edit context files.',
			contextSource: {
				repositoryUrl: 'https://github.com/nao/context.git',
				branch: 'production',
				subpath: 'projects/analytics',
				authMethod: 'token',
			},
		});
	});

	it('refuses to disconnect a deployment-managed repository', async () => {
		setContextSourceEnv({});
		const updateConfig = vi.fn();

		await expect(disconnectContextRepository(baseContext(process.cwd()), { updateConfig })).rejects.toMatchObject({
			code: 'FORBIDDEN',
		});
		expect(updateConfig).not.toHaveBeenCalled();
	});
});

describe('repository remote normalization', () => {
	it.each([
		['git@github.com:nao/context.git', 'https://github.com/nao/context'],
		['ssh://git@github.com:2222/nao/context.git', 'https://github.com/nao/context'],
	])('matches SSH remote %s to HTTPS', (sshRemote, httpsRemote) => {
		expect(normalizeRemote(sshRemote)).toBe(normalizeRemote(httpsRemote));
	});

	it('keeps different repositories distinct', () => {
		expect(normalizeRemote('git@github.com:nao/context.git')).not.toBe(
			normalizeRemote('https://github.com/nao/other.git'),
		);
	});

	it('ignores URL credentials and ports', () => {
		expect(normalizeRemote('https://user:token@github.com:8443/nao/context.git/')).toBe(
			normalizeRemote('https://github.com/nao/context'),
		);
	});
});

describe('context explorer worktrees', () => {
	const temporaryRoots: string[] = [];

	beforeEach(() => {
		contextConfigMocks.getConfig.mockResolvedValue(null);
		contextConfigMocks.updateConfig.mockResolvedValue(undefined);
	});

	afterEach(() => {
		for (const root of temporaryRoots.splice(0)) {
			fs.rmSync(root, { recursive: true, force: true });
		}
		branchOwnershipMocks.owners.clear();
		vi.clearAllMocks();
	});

	it('clones into the derived worktree and never changes the live folder', async () => {
		const fixture = createFixture(temporaryRoots);
		const before = snapshot(fixture.live);

		const repo = await ensureContextWorktree(fixture.context);
		const access = await fileAccess(fixture.context);
		const file = await readFileContent('/context.md', access);
		await writeFileContent('/context.md', 'worktree edit\n', file.hash, access);

		expect(repo.worktreeRoot).toBe(path.join(fixture.root, '.nao', 'worktrees', 'project-id', 'user-1'));
		expect(file.content).toBe('repository content\n');
		expect(fs.readFileSync(path.join(repo.worktreeRoot, 'context.md'), 'utf8')).toBe('worktree edit\n');
		expectLiveUnchanged(fixture.live, before);
	});

	it('encodes unsafe user ids without escaping the project worktree directory', async () => {
		const fixture = createFixture(temporaryRoots);
		const repo = await ensureContextWorktree({ ...fixture.context, userId: '../other/user' });
		const projectWorktrees = path.join(fixture.root, '.nao', 'worktrees', 'project-id');

		expect(path.dirname(repo.worktreeRoot)).toBe(projectWorktrees);
		expect(path.basename(repo.worktreeRoot)).toBe('%2E%2E%2Fother%2Fuser');
		expect(() => assertSafeDestructiveWorktreeTarget(repo.worktreeRoot, fixture.live)).not.toThrow();
	});

	it('uses git worktree add when the live folder is inside the connected clone', async () => {
		const fixture = createLocalCloneFixture(temporaryRoots);
		const before = snapshot(fixture.live);

		const repo = await ensureContextWorktree(fixture.context);

		expect(repo.projectPrefix).toBe('project');
		expect(fs.readFileSync(path.join(repo.worktreeRoot, 'project', 'context.md'), 'utf8')).toBe(
			'repository content\n',
		);
		expectLiveUnchanged(fixture.live, before);
	});

	it('isolates users in detached worktrees from the same local clone', async () => {
		const fixture = createLocalCloneFixture(temporaryRoots);
		const secondContext = { ...fixture.context, userId: 'user-2' };

		const firstRepo = await ensureContextWorktree(fixture.context);
		const secondRepo = await ensureContextWorktree(secondContext);
		const firstAccess = await fileAccess(fixture.context);
		const secondAccess = await fileAccess(secondContext);
		const firstFile = await readFileContent('/context.md', firstAccess);
		await writeFileContent('/context.md', 'first user edit\n', firstFile.hash, firstAccess);

		expect(firstRepo.worktreeRoot).not.toBe(secondRepo.worktreeRoot);
		expect(runGit(firstRepo.worktreeRoot, ['rev-parse', '--abbrev-ref', 'HEAD']).toString().trim()).toBe('HEAD');
		expect(runGit(secondRepo.worktreeRoot, ['rev-parse', '--abbrev-ref', 'HEAD']).toString().trim()).toBe('HEAD');
		expect((await getContextRepositoryStatus(fixture.context)).branches?.currentBranch).toBe('main');
		expect((await getContextRepositoryStatus(secondContext)).branches?.currentBranch).toBe('main');
		expect((await readFileContent('/context.md', secondAccess)).content).toBe('repository content\n');
	});

	it('keeps a cloned project read-only when no repository setting exists', async () => {
		const fixture = createLocalCloneFixture(temporaryRoots);
		fixture.context.configOverride = undefined;
		const worktree = getContextWorktreePath('project-id', fixture.live, 'user-1');

		const access = await fileAccess(fixture.context);
		const status = await getContextRepositoryStatus(fixture.context);
		const tree = await getFileTreeResponse(access);
		const file = await readFileContent('/context.md', access);

		expect(access.git).toMatchObject({ status: 'unavailable', reason: 'no-repo', repo: null });
		expect(status).toMatchObject({ repo: null, gitUnavailableReason: 'no-repo', isGitRepository: false });
		expect(tree.entries.map((entry) => entry.name)).toContain('context.md');
		expect(file).toMatchObject({
			content: 'repository content\n',
			isEditable: false,
			reason: 'no-repo',
			guidance: {
				message: 'No context repository is connected. Connect one in Git settings to edit context files.',
				actionKind: 'route',
				actionPath: '/settings/git',
			},
		});
		await expect(writeFileContent('/context.md', 'changed\n', file.hash, access)).rejects.toMatchObject({
			code: 'FORBIDDEN',
		});
		expect(fs.existsSync(worktree)).toBe(false);
	});

	it('uses an explicit override before the saved repository setting', async () => {
		contextConfigMocks.getConfig.mockResolvedValue({
			repoFullName: 'nao/saved',
			repoProvider: 'github',
		});

		await expect(
			resolveContextRepository('project-id', { provider: 'gitlab', repoFullName: 'nao/override' }),
		).resolves.toMatchObject({
			provider: 'gitlab',
			repoFullName: 'nao/override',
			source: 'settings',
		});
		await expect(resolveContextRepository('project-id', null)).resolves.toBeNull();
		expect(contextConfigMocks.getConfig).not.toHaveBeenCalled();
	});

	it('uses the saved repository setting when no override is provided', async () => {
		contextConfigMocks.getConfig.mockResolvedValue({
			repoFullName: 'nao/saved',
			repoProvider: 'gitlab',
		});

		await expect(resolveContextRepository('project-id')).resolves.toMatchObject({
			provider: 'gitlab',
			repoFullName: 'nao/saved',
			source: 'settings',
			webUrl: 'https://gitlab.com/nao/saved',
		});
	});

	it('connects the selected repository when the project clone points elsewhere', async () => {
		const fixture = createLocalCloneFixture(temporaryRoots);
		const selected = createFixture(temporaryRoots, {
			'nao_config.yaml': 'name: selected\n',
			'context.md': 'selected repository content\n',
		});
		const updateConfig = vi.fn().mockResolvedValue(undefined);

		const result = await connectContextRepository(
			{
				...fixture.context,
				provider: 'github',
				repoFullName: 'nao/selected',
			},
			{
				provider: localProvider(selected.bare, 'https://github.com/nao/selected.git'),
				updateConfig,
			},
		);
		const worktree = getContextWorktreePath('project-id', fixture.live, 'user-1');

		expect(result).toMatchObject({ provider: 'github', repoFullName: 'nao/selected' });
		expect(updateConfig).toHaveBeenCalledWith('project-id', {
			repoFullName: 'nao/selected',
			repoProvider: 'github',
		});
		expect(fs.readFileSync(path.join(worktree, 'context.md'), 'utf8')).toBe('selected repository content\n');
	});

	it('supports GitLab repositories below the setup boundary', async () => {
		const fixture = createFixture(temporaryRoots);
		fixture.context.configOverride = { provider: 'gitlab', repoFullName: 'nao/context' };
		fixture.context.providerOverride = localProvider(fixture.bare, 'https://gitlab.com/nao/context.git');

		const resolution = await resolveContextExplorerGit(fixture.context);

		expect(resolution).toMatchObject({
			status: 'available',
			repo: { provider: 'gitlab', repoFullName: 'nao/context' },
		});
	});

	it('self-heals a missing worktree', async () => {
		const fixture = createFixture(temporaryRoots);
		const first = await ensureContextWorktree(fixture.context);
		fs.rmSync(first.worktreeRoot, { recursive: true, force: true });

		const second = await ensureContextWorktree(fixture.context);

		expect(fs.readFileSync(path.join(second.worktreeRoot, 'context.md'), 'utf8')).toBe('repository content\n');
	});

	it('repairs a missing linked worktree through the allowed management flow', async () => {
		const fixture = createLocalCloneFixture(temporaryRoots);
		const first = await ensureContextWorktree(fixture.context);
		fs.rmSync(first.worktreeRoot, { recursive: true, force: true });

		const second = await ensureContextWorktree(fixture.context);

		expect(fs.readFileSync(path.join(second.worktreeRoot, 'project', 'context.md'), 'utf8')).toBe(
			'repository content\n',
		);
	});

	it('removes a user worktree and prunes its Git registration', async () => {
		const fixture = createLocalCloneFixture(temporaryRoots);
		const repo = await ensureContextWorktree(fixture.context);
		const repositoryRoot = runGit(fixture.live, ['rev-parse', '--show-toplevel']).toString().trim();

		await cleanupContextWorktree(fixture.context.projectId, fixture.context.projectFolder, fixture.context.userId);

		expect(fs.existsSync(repo.worktreeRoot)).toBe(false);
		expect(runGit(repositoryRoot, ['worktree', 'list', '--porcelain']).toString()).not.toContain(repo.worktreeRoot);
	});

	it('disconnects a cloned project without recreating its worktree', async () => {
		const fixture = createLocalCloneFixture(temporaryRoots);
		fixture.context.configOverride = undefined;
		let connected = true;
		contextConfigMocks.getConfig.mockImplementation(async () =>
			connected ? { repoFullName: 'nao/context', repoProvider: 'github' } : null,
		);
		const repo = await ensureContextWorktree(fixture.context);
		const updateConfig = vi.fn().mockImplementation(async () => {
			connected = false;
		});

		await disconnectContextRepository(fixture.context, { updateConfig });
		const status = await getContextRepositoryStatus(fixture.context);
		const access = await fileAccess(fixture.context);

		expect(updateConfig).toHaveBeenCalledWith('project-id', {
			repoFullName: null,
			repoProvider: null,
		});
		expect(fs.existsSync(repo.worktreeRoot)).toBe(false);
		expect(status).toMatchObject({ repo: null, gitUnavailableReason: 'no-repo', isGitRepository: false });
		expect(access.git).toMatchObject({ status: 'unavailable', reason: 'no-repo' });
		expect(fs.existsSync(repo.worktreeRoot)).toBe(false);
	});

	it('creates a branch and commits selected dirty files while leaving others uncommitted', async () => {
		const fixture = createFixture(temporaryRoots, {
			'nao_config.yaml': 'name: test\n',
			'context.md': 'repository content\n',
			'other.md': 'other\n',
		});
		const before = snapshot(fixture.live);
		const access = await fileAccess(fixture.context);
		const contextFile = await readFileContent('/context.md', access);
		const otherFile = await readFileContent('/other.md', access);
		await writeFileContent('/context.md', 'selected\n', contextFile.hash, access);
		await writeFileContent('/other.md', 'unselected\n', otherFile.hash, access);

		const result = await createContextBranchAndCommit(fixture.context, {
			paths: ['/context.md'],
			message: 'Update context',
		});
		const changed = await getChangedContextFiles(fixture.context);

		expect(result.branch).toMatch(/^nao\/context-edits-[a-z0-9]+$/);
		expect(result.baseUsed).toBe('origin/main');
		expect(result.usedFallbackBase).toBe(false);
		expect(branchOwnershipMocks.claimContextBranch).toHaveBeenCalledWith('project-id', result.branch, 'user-1');
		expect(changed).toEqual([{ path: '/other.md', kind: 'modified', additions: 1, deletions: 1 }]);
		expect(
			runGit(path.join(fixture.root, '.nao', 'worktrees', 'project-id', 'user-1'), [
				'show',
				'HEAD:context.md',
			]).toString(),
		).toBe('selected\n');
		expectLiveUnchanged(fixture.live, before);
	});

	it('rejects commits until an owned branch is checked out', async () => {
		const fixture = createFixture(temporaryRoots);
		const access = await fileAccess(fixture.context);
		const file = await readFileContent('/context.md', access);
		await writeFileContent('/context.md', 'default branch edit\n', file.hash, access);
		const repo = await ensureContextWorktree(fixture.context);
		const head = runGit(repo.worktreeRoot, ['rev-parse', 'HEAD']).toString().trim();

		await expect(
			commitContextChanges(fixture.context, {
				paths: ['/context.md'],
				message: 'Unreachable commit',
			}),
		).rejects.toMatchObject({
			code: 'BAD_REQUEST',
			message: 'Create a branch before committing context changes.',
		});

		expect(runGit(repo.worktreeRoot, ['rev-parse', 'HEAD']).toString().trim()).toBe(head);
		expect(await getChangedContextFiles(fixture.context)).toHaveLength(1);
	});

	it('reports commits that have not been pushed to the current branch', async () => {
		const fixture = createFixture(temporaryRoots);
		const before = snapshot(fixture.live);

		const defaultStatus = await getContextRepositoryStatus(fixture.context);
		expect(defaultStatus.branches).toMatchObject({
			aheadCommitCount: 0,
			unpushedCommitCount: 0,
		});

		await createContextBranch(fixture.context, 'nao/empty');
		const emptyBranchStatus = await getContextRepositoryStatus(fixture.context);
		expect(emptyBranchStatus.branches).toMatchObject({
			currentBranch: 'nao/empty',
			defaultBranch: 'main',
			aheadCommitCount: 0,
			unpushedCommitCount: 0,
		});

		const access = await fileAccess(fixture.context);
		const file = await readFileContent('/context.md', access);
		await writeFileContent('/context.md', 'committed branch edit\n', file.hash, access);
		await commitContextChanges(fixture.context, {
			paths: ['/context.md'],
			message: 'Commit branch edit',
		});

		const committedBranchStatus = await getContextRepositoryStatus(fixture.context);
		expect(committedBranchStatus.branches).toMatchObject({
			aheadCommitCount: 1,
			unpushedCommitCount: 1,
		});

		await pushContextExplorerBranch(fixture.context);
		const pushedBranchStatus = await getContextRepositoryStatus(fixture.context);
		expect(pushedBranchStatus.branches).toMatchObject({
			aheadCommitCount: 1,
			unpushedCommitCount: 0,
		});

		const pushedFile = await readFileContent('/context.md', access);
		await writeFileContent('/context.md', 'another branch edit\n', pushedFile.hash, access);
		await commitContextChanges(fixture.context, {
			paths: ['/context.md'],
			message: 'Commit another edit',
		});
		const newCommitStatus = await getContextRepositoryStatus(fixture.context);
		expect(newCommitStatus.branches?.unpushedCommitCount).toBe(1);
		expectLiveUnchanged(fixture.live, before);
	});

	it('shows only the default branch and branches owned by the current user', async () => {
		const fixture = createFixture(temporaryRoots);
		const repo = await ensureContextWorktree(fixture.context);
		runGit(repo.worktreeRoot, ['update-ref', 'refs/remotes/origin/owned', 'HEAD']);
		runGit(repo.worktreeRoot, ['update-ref', 'refs/remotes/origin/colleague', 'HEAD']);
		runGit(repo.worktreeRoot, ['symbolic-ref', 'refs/remotes/origin/HEAD', 'refs/remotes/origin/main']);
		branchOwnershipMocks.owners.set('project-id:owned', 'user-1');
		branchOwnershipMocks.owners.set('project-id:colleague', 'user-2');

		const status = await getContextRepositoryStatus(fixture.context);

		expect(status.branches?.branches).toEqual(['main', 'owned']);
		expect(status.branches?.branches).not.toContain('origin');
	});

	it('rejects switching to a branch owned by another user', async () => {
		const fixture = createFixture(temporaryRoots);
		const repo = await ensureContextWorktree(fixture.context);
		runGit(repo.worktreeRoot, ['branch', 'colleague']);
		branchOwnershipMocks.owners.set('project-id:colleague', 'user-2');

		await expect(switchContextBranch(fixture.context, 'colleague')).rejects.toMatchObject({
			code: 'FORBIDDEN',
		});
	});

	it('returns an unavailable status when git is unavailable or no repository is connected', async () => {
		const fixture = createFixture(temporaryRoots);
		const before = snapshot(fixture.live);
		await ensureContextWorktree(fixture.context);
		const originalPath = process.env.PATH;

		try {
			process.env.PATH = '';
			await expect(getContextRepositoryStatus(fixture.context)).resolves.toMatchObject({
				gitUnavailableReason: 'git-unavailable',
				branches: null,
			});
			await expect(getChangedContextFiles(fixture.context)).resolves.toEqual([]);
		} finally {
			process.env.PATH = originalPath;
		}

		const disconnectedContext = { ...fixture.context, configOverride: null };
		await expect(getContextRepositoryStatus(disconnectedContext)).resolves.toMatchObject({
			gitUnavailableReason: 'no-repo',
			branches: null,
		});
		await expect(getChangedContextFiles(disconnectedContext)).resolves.toEqual([]);
		expectLiveUnchanged(fixture.live, before);
	});

	it('reports line changes for tracked, untracked, and binary files without changing the live folder', async () => {
		const fixture = createFixture(temporaryRoots, {
			'nao_config.yaml': 'name: test\n',
			'context.md': 'repository content\n',
			'binary.dat': 'plain text\n',
		});
		const before = snapshot(fixture.live);
		const repo = await ensureContextWorktree(fixture.context);
		fs.writeFileSync(path.join(repo.worktreeRoot, 'context.md'), 'replacement\nextra\n');
		fs.writeFileSync(path.join(repo.worktreeRoot, 'new.md'), 'first\nsecond\n');
		fs.writeFileSync(path.join(repo.worktreeRoot, 'binary.dat'), Buffer.from([0, 1, 2, 3]));

		await expect(getChangedContextFiles(fixture.context)).resolves.toEqual([
			{ path: '/binary.dat', kind: 'modified', additions: null, deletions: null },
			{ path: '/context.md', kind: 'modified', additions: 2, deletions: 1 },
			{ path: '/new.md', kind: 'untracked', additions: 2, deletions: 0 },
		]);
		expectLiveUnchanged(fixture.live, before);
	});

	it('falls back to the current HEAD when the fetched default cannot accept dirty edits', async () => {
		const fixture = createFixture(temporaryRoots);
		const access = await fileAccess(fixture.context);
		const file = await readFileContent('/context.md', access);
		await writeFileContent('/context.md', 'local edit\n', file.hash, access);
		const repo = await ensureContextWorktree(fixture.context);
		writeRemoteChange(fixture, 'context.md', 'remote edit\n');

		const result = await createContextBranchAndCommit(fixture.context, {
			branch: 'nao/fallback',
			paths: ['/context.md'],
			message: 'Keep local edit',
		});

		expect(result.usedFallbackBase).toBe(true);
		expect(result.baseUsed).toMatch(/^[a-f0-9]{40}$/);
		expect(runGit(repo.worktreeRoot, ['show', 'HEAD:context.md']).toString()).toBe('local edit\n');
	});

	it('creates a branch from the current HEAD when the fetched default cannot accept dirty edits', async () => {
		const fixture = createFixture(temporaryRoots);
		const access = await fileAccess(fixture.context);
		const file = await readFileContent('/context.md', access);
		await writeFileContent('/context.md', 'local edit\n', file.hash, access);
		const repo = await ensureContextWorktree(fixture.context);
		writeRemoteChange(fixture, 'context.md', 'remote edit\n');

		const result = await createContextBranch(fixture.context, 'nao/fallback-without-commit');

		expect(result.usedFallbackBase).toBe(true);
		expect(result.currentBranch).toBe('nao/fallback-without-commit');
		expect(fs.readFileSync(path.join(repo.worktreeRoot, 'context.md'), 'utf8')).toBe('local edit\n');
		expect(await getChangedContextFiles(fixture.context)).toEqual([
			{ path: '/context.md', kind: 'modified', additions: 1, deletions: 1 },
		]);
	});

	it('releases branch ownership when branch creation fails', async () => {
		const fixture = createFixture(temporaryRoots);
		const repo = await ensureContextWorktree(fixture.context);
		const indexLockPath = path.resolve(
			repo.worktreeRoot,
			runGit(repo.worktreeRoot, ['rev-parse', '--git-path', 'index.lock']).toString().trim(),
		);
		fs.writeFileSync(indexLockPath, 'locked');

		await expect(createContextBranch(fixture.context, 'nao/failed')).rejects.toThrow();

		expect(branchOwnershipMocks.releaseContextBranch).toHaveBeenCalledWith('project-id', 'nao/failed', 'user-1');
		expect(branchOwnershipMocks.owners.has('project-id:nao/failed')).toBe(false);
	});

	it('commits selected files, then pushes and opens a pull request', async () => {
		const fixture = createFixture(temporaryRoots);
		const access = await fileAccess(fixture.context);
		const file = await readFileContent('/context.md', access);
		await writeFileContent('/context.md', 'pull request edit\n', file.hash, access);

		const commit = await createContextBranchAndCommit(fixture.context, {
			paths: ['/context.md'],
			message: 'Update shared context',
		});
		const result = await pushContextExplorerBranch(fixture.context);

		expect(result).toEqual({
			url: 'https://github.com/nao/context/pull/1',
			branch: commit.branch,
			reviewRequest: 'opened',
		});
		expect(
			runGit(fixture.root, ['--git-dir', fixture.bare, 'show', `${result.branch}:context.md`]).toString(),
		).toBe('pull request edit\n');
	});

	it('switches clean existing branches and discards one or all changed paths', async () => {
		const fixture = createFixture(temporaryRoots, {
			'nao_config.yaml': 'name: test\n',
			'context.md': 'repository content\n',
			'other.md': 'other\n',
		});
		const before = snapshot(fixture.live);
		const repo = await ensureContextWorktree(fixture.context);
		runGit(repo.worktreeRoot, ['branch', 'review']);
		branchOwnershipMocks.owners.set('project-id:review', 'user-1');
		await switchContextBranch(fixture.context, 'review');
		const access = await fileAccess(fixture.context);
		const first = await readFileContent('/context.md', access);
		const second = await readFileContent('/other.md', access);
		await writeFileContent('/context.md', 'first edit\n', first.hash, access);
		await writeFileContent('/other.md', 'second edit\n', second.hash, access);

		await discardContextFileChange(fixture.context, '/context.md');
		expect(await getChangedContextFiles(fixture.context)).toEqual([
			{ path: '/other.md', kind: 'modified', additions: 1, deletions: 1 },
		]);
		await discardAllContextChanges(fixture.context);
		expect(await getChangedContextFiles(fixture.context)).toEqual([]);
		expectLiveUnchanged(fixture.live, before);
	});

	it('resolves a subdirectory project and never touches a same-named root file', async () => {
		const fixture = createFixture(temporaryRoots, {
			'context.md': 'root context\n',
			'analytics/nao_config.yaml': 'name: analytics\n',
			'analytics/context.md': 'analytics repository\n',
		});
		const access = await fileAccess(fixture.context);
		const file = await readFileContent('/context.md', access);
		await writeFileContent('/context.md', 'analytics edit\n', file.hash, access);
		const repo = await ensureContextWorktree(fixture.context);

		expect(repo.projectPrefix).toBe('analytics');
		expect(fs.readFileSync(path.join(repo.worktreeRoot, 'context.md'), 'utf8')).toBe('root context\n');
		expect(fs.readFileSync(path.join(repo.worktreeRoot, 'analytics', 'context.md'), 'utf8')).toBe(
			'analytics edit\n',
		);
	});

	it('opens a pull request from branch commit messages in oldest-first order', async () => {
		const fixture = createFixture(temporaryRoots);
		const before = snapshot(fixture.live);
		const provider = fixture.context.providerOverride;
		if (!provider) {
			throw new Error('Expected a local provider.');
		}
		const openReviewRequest = vi.spyOn(provider, 'openReviewRequest');
		const access = await fileAccess(fixture.context);
		const file = await readFileContent('/context.md', access);
		await writeFileContent('/context.md', 'separately committed\n', file.hash, access);
		const committed = await createContextBranchAndCommit(fixture.context, {
			paths: ['/context.md'],
			message: 'Update shared context',
		});
		const committedFile = await readFileContent('/context.md', access);
		await writeFileContent('/context.md', 'second committed edit\n', committedFile.hash, access);
		await commitContextChanges(fixture.context, {
			paths: ['/context.md'],
			message: 'Clarify context details',
		});

		const result = await pushContextExplorerBranch(fixture.context);

		expect(result.branch).toBe(committed.branch);
		expect(openReviewRequest).toHaveBeenCalledWith('test-token', 'nao/context', {
			title: 'Update shared context',
			body: '- Update shared context\n- Clarify context details',
			head: committed.branch,
			base: 'main',
		});
		expect(
			runGit(fixture.root, ['--git-dir', fixture.bare, 'show', `${committed.branch}:context.md`]).toString(),
		).toBe('second committed edit\n');
		expectLiveUnchanged(fixture.live, before);
	});

	it('pushes commits to an existing pull request without opening another', async () => {
		const fixture = createFixture(temporaryRoots);
		const before = snapshot(fixture.live);
		const provider = fixture.context.providerOverride;
		if (!provider) {
			throw new Error('Expected a local provider.');
		}
		const existingPullRequest = { url: 'https://github.com/nao/context/pull/7' };
		vi.spyOn(provider, 'findOpenReviewRequest').mockResolvedValue(existingPullRequest);
		const openReviewRequest = vi.spyOn(provider, 'openReviewRequest');
		const access = await fileAccess(fixture.context);
		const file = await readFileContent('/context.md', access);
		await writeFileContent('/context.md', 'existing pull request edit\n', file.hash, access);
		const committed = await createContextBranchAndCommit(fixture.context, {
			paths: ['/context.md'],
			message: 'Update existing proposal',
		});

		const result = await pushContextExplorerBranch(fixture.context);

		expect(result).toEqual({
			url: existingPullRequest.url,
			branch: committed.branch,
			reviewRequest: 'updated',
		});
		expect(openReviewRequest).not.toHaveBeenCalled();
		expect(
			runGit(fixture.root, ['--git-dir', fixture.bare, 'show', `${committed.branch}:context.md`]).toString(),
		).toBe('existing pull request edit\n');
		expectLiveUnchanged(fixture.live, before);
	});

	it('reports an empty branch as having nothing to push without throwing', async () => {
		const fixture = createFixture(temporaryRoots);
		const before = snapshot(fixture.live);
		await createContextBranch(fixture.context, 'nao/empty-proposal');

		await expect(getContextRepositoryStatus(fixture.context)).resolves.toMatchObject({
			branches: {
				currentBranch: 'nao/empty-proposal',
				aheadCommitCount: 0,
				unpushedCommitCount: 0,
			},
			openReviewRequest: null,
		});
		expectLiveUnchanged(fixture.live, before);
	});

	it('degrades missing and ambiguous projects to read-only live browsing', async () => {
		for (const files of [
			{ 'context.md': 'repository\n' },
			{ 'one/nao_config.yaml': 'one\n', 'two/nao_config.yaml': 'two\n' },
		]) {
			const fixture = createFixture(temporaryRoots, files);
			const before = snapshot(fixture.live);
			const access = await fileAccess(fixture.context);
			const tree = await getFileTreeResponse(access);
			const file = await readFileContent('/context.md', access);

			expect(access.git.status).toBe('unavailable');
			expect(tree.entries.some((entry) => entry.name === 'context.md')).toBe(true);
			expect(file.isEditable).toBe(false);
			expectLiveUnchanged(fixture.live, before);
		}
	});

	it('keeps browsing available with no repo or token while refusing mutation', async () => {
		const root = temporaryRoot(temporaryRoots);
		const live = path.join(root, 'live');
		fs.mkdirSync(live);
		fs.writeFileSync(path.join(live, 'context.md'), 'live\n');
		const contexts: ContextExplorerGitContext[] = [baseContext(live, null), { ...baseContext(live), token: null }];

		for (const context of contexts) {
			const access = await fileAccess(context);
			const file = await readFileContent('/context.md', access);
			expect(file.content).toBe('live\n');
			expect(file.isEditable).toBe(false);
			await expect(writeFileContent('/context.md', 'blocked\n', file.hash, access)).rejects.toMatchObject({
				code: 'FORBIDDEN',
			});
			await expect(discardAllContextChanges(context)).rejects.toMatchObject({ code: 'FORBIDDEN' });
		}
	});

	it('rejects every unsafe destructive target, including a repository containing the live folder', () => {
		const root = temporaryRoot(temporaryRoots);
		const live = path.join(root, 'repo', 'project');
		fs.mkdirSync(live, { recursive: true });

		expect(() => assertSafeDestructiveWorktreeTarget(path.join(root, 'repo'), live)).toThrow(
			'outside a .nao/worktrees',
		);
		expect(() => assertSafeDestructiveWorktreeTarget(live, live)).toThrow();
		expect(() => assertSafeDestructiveWorktreeTarget(path.join(root, '.nao', 'worktrees'), live)).toThrow();
		expect(() => assertSafeDestructiveWorktreeTarget(path.join(root, '.nao', 'worktrees', 'safe'), live)).toThrow();
		expect(() =>
			assertSafeDestructiveWorktreeTarget(path.join(root, '.nao', 'worktrees', 'safe', 'user'), live),
		).not.toThrow();
	});

	it('allows only worktree management commands outside the asserted worktree', () => {
		const root = temporaryRoot(temporaryRoots);
		const live = path.join(root, 'live');
		const worktree = path.join(root, '.nao', 'worktrees', 'safe', 'user');

		expect(() => assertSafeDestructiveWorktreeCommand(worktree, root, ['restore', '--worktree', '.'])).toThrow(
			'outside the context worktree',
		);
		expect(() =>
			assertSafeDestructiveWorktreeCommand(worktree, root, ['worktree', 'add', '--detach', worktree, 'main']),
		).not.toThrow();
		expect(() =>
			assertSafeDestructiveWorktreeCommand(worktree, root, ['worktree', 'remove', '--force', worktree]),
		).not.toThrow();
		expect(() => assertSafeDestructiveWorktreeCommand(worktree, root, ['worktree', 'prune'])).not.toThrow();
		expect(fs.existsSync(live)).toBe(false);
	});

	it('refuses every destructive operation before touching a repository containing the live folder', async () => {
		const root = temporaryRoot(temporaryRoots);
		const repository = path.join(root, 'repository');
		const live = path.join(repository, 'project');
		fs.mkdirSync(live, { recursive: true });
		initRepository(repository);
		fs.writeFileSync(path.join(repository, 'preserve.md'), 'preserve\n');
		const before = snapshot(repository);
		const unsafe = { ...baseContext(live), projectId: '..' };
		const operations = [
			() => switchContextBranch(unsafe, 'main'),
			() => createContextBranch(unsafe, 'nao/test'),
			() => createContextBranchAndCommit(unsafe, { paths: ['/context.md'], message: 'test' }),
			() => commitContextChanges(unsafe, { paths: ['/context.md'], message: 'test' }),
			() => discardContextFileChange(unsafe, '/context.md'),
			() => discardAllContextChanges(unsafe),
			() => pushContextExplorerBranch(unsafe),
		];

		for (const operation of operations) {
			await expect(operation()).rejects.toThrow('Invalid project id');
		}
		await expect(ensureContextWorktree({ ...baseContext(live), userId: '' })).rejects.toThrow('Invalid user id');
		expect(snapshot(repository)).toEqual(before);
	});

	it.each([
		['no-repo', null, 'token'],
		['no-token', { provider: 'github' as const, repoFullName: 'nao/context' }, null],
	])('returns %s while preserving live browsing', async (reason, configOverride, token) => {
		const root = temporaryRoot(temporaryRoots);
		const live = path.join(root, 'live');
		fs.mkdirSync(live);
		fs.writeFileSync(path.join(live, 'context.md'), 'live\n');
		const context = { ...baseContext(live, configOverride), token };
		const access = await fileAccess(context);

		expect(access.git).toMatchObject({ status: 'unavailable', reason });
		expect((await readFileContent('/context.md', access)).content).toBe('live\n');
	});

	it.each([
		['plain repository', 'repository'],
		['live folder', 'live'],
		['worktrees parent', 'worktrees'],
	])('rejects unsafe guard target: %s', (_label, targetKind) => {
		const root = temporaryRoot(temporaryRoots);
		const live = path.join(root, 'repository', 'project');
		fs.mkdirSync(live, { recursive: true });
		const target =
			targetKind === 'live'
				? live
				: targetKind === 'worktrees'
					? path.join(root, '.nao', 'worktrees')
					: path.join(root, 'repository');
		expect(() => assertSafeDestructiveWorktreeTarget(target, live)).toThrow();
	});
});

interface Fixture {
	root: string;
	bare: string;
	seed: string;
	live: string;
	context: ContextExplorerGitContext;
}

function createFixture(
	temporaryRoots: string[],
	files: Record<string, string> = {
		'nao_config.yaml': 'name: test\n',
		'context.md': 'repository content\n',
	},
): Fixture {
	const root = temporaryRoot(temporaryRoots);
	const bare = path.join(root, 'remote.git');
	const seed = path.join(root, 'seed');
	const live = path.join(root, 'live');
	fs.mkdirSync(seed);
	fs.mkdirSync(live);
	initRepository(seed);
	writeFiles(seed, files);
	commitAll(seed, 'initial');
	runGit(root, ['init', '--bare', '--quiet', '--initial-branch=main', bare]);
	runGit(seed, ['push', bare, 'main']);
	runGit(root, ['--git-dir', bare, 'symbolic-ref', 'HEAD', 'refs/heads/main']);
	fs.writeFileSync(path.join(live, 'context.md'), 'live content\n');
	fs.writeFileSync(path.join(live, 'nao_config.yaml'), 'name: live\n');
	return {
		root,
		bare,
		seed,
		live,
		context: {
			...baseContext(live),
			providerOverride: localProvider(bare),
		},
	};
}

function createLocalCloneFixture(temporaryRoots: string[]): Fixture {
	const fixture = createFixture(temporaryRoots, {
		'project/nao_config.yaml': 'name: test\n',
		'project/context.md': 'repository content\n',
	});
	const clone = path.join(fixture.root, 'clone');
	runGit(fixture.root, ['clone', fixture.bare, clone]);
	runGit(clone, ['remote', 'set-url', 'origin', 'https://github.com/nao/context.git']);
	fixture.live = path.join(clone, 'project');
	fixture.context = {
		...baseContext(fixture.live),
		providerOverride: localProvider(fixture.bare),
	};
	return fixture;
}

async function fileAccess(context: ContextExplorerGitContext) {
	return {
		projectFolder: context.projectFolder,
		git: await resolveContextExplorerGit(context),
	};
}

function baseContext(
	projectFolder: string,
	configOverride: ContextExplorerGitContext['configOverride'] = {
		provider: 'github',
		repoFullName: 'nao/context',
	},
): ContextExplorerGitContext {
	return {
		projectId: 'project-id',
		projectFolder,
		userId: 'user-1',
		token: 'test-token',
		configOverride,
		integrationAvailableOverride: true,
	};
}

function setContextSourceEnv({
	source = 'git',
	url = 'https://github.com/nao/context.git',
	branch,
	subpath,
	token,
	sshKey,
}: {
	source?: string | null;
	url?: string;
	branch?: string;
	subpath?: string;
	token?: string;
	sshKey?: string;
}): void {
	delete process.env.NAO_CONTEXT_SOURCE;
	delete process.env.NAO_CONTEXT_GIT_URL;
	delete process.env.NAO_CONTEXT_GIT_BRANCH;
	delete process.env.NAO_CONTEXT_GIT_SUBPATH;
	delete process.env.NAO_CONTEXT_GIT_TOKEN;
	delete process.env.NAO_CONTEXT_GIT_SSH_KEY;
	if (source) {
		process.env.NAO_CONTEXT_SOURCE = source;
	}
	if (url !== undefined) {
		process.env.NAO_CONTEXT_GIT_URL = url;
	}
	if (branch !== undefined) {
		process.env.NAO_CONTEXT_GIT_BRANCH = branch;
	}
	if (subpath !== undefined) {
		process.env.NAO_CONTEXT_GIT_SUBPATH = subpath;
	}
	if (token !== undefined) {
		process.env.NAO_CONTEXT_GIT_TOKEN = token;
	}
	if (sshKey !== undefined) {
		process.env.NAO_CONTEXT_GIT_SSH_KEY = sshKey;
	}
	__reloadEnvForTesting();
}

function localProvider(bare: string, publicUrl = 'https://github.com/nao/context.git'): ContextRepositoryProvider {
	let openReviewRequest: { url: string } | null = null;
	return {
		getToken: async () => 'test-token',
		notConnectedMessage: 'Not connected.',
		isIntegrationAvailable: () => true,
		authenticatedRepoUrl: () => bare,
		publicRepoUrl: () => publicUrl,
		cloneRepo: () => undefined,
		getGitInfo: () => ({ branch: 'main' }),
		getUserGitIdentity: async () => ({ name: 'Test User', email: 'test@example.com' }),
		coAuthor: { name: 'nao', email: 'naoagent@getnao.io' },
		commitAllAndPushBranch: () => undefined,
		pushBranch: ({ dir, branch }) => {
			runGit(dir, ['push', bare, `HEAD:refs/heads/${branch}`]);
		},
		findOpenReviewRequest: async () => openReviewRequest,
		findReviewRequestByBranch: async () => null,
		openReviewRequest: async () => {
			openReviewRequest = { url: 'https://github.com/nao/context/pull/1' };
			return openReviewRequest;
		},
	};
}

function writeRemoteChange(fixture: Fixture, filePath: string, content: string): void {
	fs.writeFileSync(path.join(fixture.seed, filePath), content);
	commitAll(fixture.seed, 'remote change');
	runGit(fixture.seed, ['push', fixture.bare, 'main']);
}

function initRepository(folder: string): void {
	runGit(folder, ['init', '--quiet', '--initial-branch=main']);
}

function commitAll(folder: string, message: string): void {
	runGit(folder, ['add', '-A']);
	runGit(folder, ['-c', 'user.name=Test', '-c', 'user.email=test@example.com', 'commit', '--quiet', '-m', message]);
}

function writeFiles(root: string, files: Record<string, string>): void {
	for (const [filePath, content] of Object.entries(files)) {
		const target = path.join(root, filePath);
		fs.mkdirSync(path.dirname(target), { recursive: true });
		fs.writeFileSync(target, content);
	}
}

function temporaryRoot(temporaryRoots: string[]): string {
	const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nao-context-worktree-'));
	temporaryRoots.push(root);
	return root;
}

function runGit(cwd: string, args: string[]): Buffer {
	return execFileSync('git', args, { cwd, stdio: 'pipe', timeout: 10_000 });
}

function snapshot(root: string): Record<string, Buffer> {
	const result: Record<string, Buffer> = {};
	for (const entry of fs.readdirSync(root, { recursive: true, withFileTypes: true })) {
		if (!entry.isFile()) {
			continue;
		}
		const parent = entry.parentPath ?? entry.path;
		const absolute = path.join(parent, entry.name);
		result[path.relative(root, absolute)] = fs.readFileSync(absolute);
	}
	return result;
}

function expectLiveUnchanged(live: string, before: Record<string, Buffer>): void {
	expect(snapshot(live)).toEqual(before);
	expect(fs.existsSync(path.join(live, '.git'))).toBe(false);
}
