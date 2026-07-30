import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { getFileTreeResponse, readFileContent, writeFileContent } from '../src/services/context-explorer.service';
import type {
	ContextExplorerGitContext,
	ContextRepositoryProvider,
} from '../src/services/context-explorer-git.service';
import {
	assertSafeDestructiveWorktreeTarget,
	commitContextChanges,
	createContextBranch,
	createContextBranchAndCommit,
	discardAllContextChanges,
	discardContextFileChange,
	ensureContextWorktree,
	getChangedContextFiles,
	resolveContextExplorerGit,
	switchContextBranch,
} from '../src/services/context-explorer-git.service';
import { createContextExplorerPullRequest } from '../src/services/context-explorer-pr.service';

describe('context explorer worktrees', () => {
	const temporaryRoots: string[] = [];

	afterEach(() => {
		for (const root of temporaryRoots.splice(0)) {
			fs.rmSync(root, { recursive: true, force: true });
		}
	});

	it('clones into the derived worktree and never changes the live folder', async () => {
		const fixture = createFixture(temporaryRoots);
		const before = snapshot(fixture.live);

		const repo = await ensureContextWorktree(fixture.context);
		const access = await fileAccess(fixture.context);
		const file = await readFileContent('/context.md', access);
		await writeFileContent('/context.md', 'worktree edit\n', file.hash, access);

		expect(repo.worktreeRoot).toBe(path.join(fixture.root, '.nao', 'worktrees', 'project-id'));
		expect(file.content).toBe('repository content\n');
		expect(fs.readFileSync(path.join(repo.worktreeRoot, 'context.md'), 'utf8')).toBe('worktree edit\n');
		expectLiveUnchanged(fixture.live, before);
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

	it('self-heals a missing worktree', async () => {
		const fixture = createFixture(temporaryRoots);
		const first = await ensureContextWorktree(fixture.context);
		fs.rmSync(first.worktreeRoot, { recursive: true, force: true });

		const second = await ensureContextWorktree(fixture.context);

		expect(fs.readFileSync(path.join(second.worktreeRoot, 'context.md'), 'utf8')).toBe('repository content\n');
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
		expect(changed).toEqual([{ path: '/other.md', kind: 'modified' }]);
		expect(
			runGit(path.join(fixture.root, '.nao', 'worktrees', 'project-id'), ['show', 'HEAD:context.md']).toString(),
		).toBe('selected\n');
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

	it('switches clean existing branches and discards one or all changed paths', async () => {
		const fixture = createFixture(temporaryRoots, {
			'nao_config.yaml': 'name: test\n',
			'context.md': 'repository content\n',
			'other.md': 'other\n',
		});
		const before = snapshot(fixture.live);
		const repo = await ensureContextWorktree(fixture.context);
		runGit(repo.worktreeRoot, ['branch', 'review']);
		await switchContextBranch(fixture.context, 'review');
		const access = await fileAccess(fixture.context);
		const first = await readFileContent('/context.md', access);
		const second = await readFileContent('/other.md', access);
		await writeFileContent('/context.md', 'first edit\n', first.hash, access);
		await writeFileContent('/other.md', 'second edit\n', second.hash, access);

		await discardContextFileChange(fixture.context, '/context.md');
		expect(await getChangedContextFiles(fixture.context)).toEqual([{ path: '/other.md', kind: 'modified' }]);
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

	it('keeps browsing available for no repo, no token, and GitLab while refusing mutation', async () => {
		const root = temporaryRoot(temporaryRoots);
		const live = path.join(root, 'live');
		fs.mkdirSync(live);
		fs.writeFileSync(path.join(live, 'context.md'), 'live\n');
		const contexts: ContextExplorerGitContext[] = [
			baseContext(live, null),
			{ ...baseContext(live), token: null },
			{ ...baseContext(live), configOverride: { provider: 'gitlab', repoFullName: 'nao/context' } },
		];

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
		expect(() =>
			assertSafeDestructiveWorktreeTarget(path.join(root, '.nao', 'worktrees', 'safe'), live),
		).not.toThrow();
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
			() => createContextExplorerPullRequest(unsafe, { title: 'test' }),
		];

		for (const operation of operations) {
			await expect(operation()).rejects.toThrow('Invalid project id');
		}
		expect(snapshot(repository)).toEqual(before);
	});

	it.each([
		['no-repo', null, 'token'],
		['no-token', { provider: 'github' as const, repoFullName: 'nao/context' }, null],
		['unsupported-provider', { provider: 'gitlab' as const, repoFullName: 'nao/context' }, 'token'],
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
		projectId: context.projectId,
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
		token: 'test-token',
		configOverride,
		integrationAvailableOverride: true,
		includeEditorMetadata: false,
	};
}

function localProvider(bare: string): ContextRepositoryProvider {
	return {
		authenticatedRepoUrl: () => bare,
		publicRepoUrl: () => 'https://github.com/nao/context.git',
		getUserGitIdentity: async () => ({ name: 'Test User', email: 'test@example.com' }),
		coAuthor: { name: 'nao', email: 'naoagent@getnao.io' },
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
