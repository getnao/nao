import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
	process.env.MODE = 'test';
	process.env.NAO_MODE = 'self-hosted';
	process.env.NAO_DEFAULT_PROJECT_PATH = '';
	process.env.NAO_CONTEXT_SOURCE = 'local';
});

import type { ContextExplorerFileAccess } from '../src/services/context-explorer.service';
import {
	getFileTreeResponse,
	MAX_CONTEXT_FILE_SIZE,
	readFileContent,
	searchFileContents,
	writeFileContent,
} from '../src/services/context-explorer.service';
import type {
	ContextExplorerGitContext,
	ContextRepositoryProvider,
} from '../src/services/context-explorer-git.service';
import { resolveContextExplorerGit } from '../src/services/context-explorer-git.service';

describe('context explorer worktree writes', () => {
	let root: string;
	let live: string;
	let bare: string;
	let access: ContextExplorerFileAccess;
	let liveSnapshot: Record<string, Buffer>;

	beforeEach(async () => {
		root = fs.mkdtempSync(path.join(os.tmpdir(), 'nao-context-write-'));
		live = path.join(root, 'live');
		bare = path.join(root, 'remote.git');
		const seed = path.join(root, 'seed');
		fs.mkdirSync(live);
		fs.mkdirSync(seed);
		initRepository(seed);
		writeFiles(seed, {
			'nao_config.yaml': 'name: project\n',
			'context.md': 'repository content\n',
			'generated.md': '---\ntype: generated\n---\ngenerated\n',
			'annotations.md': '---\ntype: manual\n---\nnotes\n',
			'rendered.md': 'rendered\n',
			'rendered.md.j2': 'template\n',
			'repos/source.md': 'synced\n',
			'docs/notion/page.md': 'notion\n',
			'.gitignore': 'ignored\n',
		});
		commitAll(seed);
		runGit(root, ['init', '--bare', '--quiet', '--initial-branch=main', bare]);
		runGit(seed, ['push', bare, 'main']);
		runGit(root, ['--git-dir', bare, 'symbolic-ref', 'HEAD', 'refs/heads/main']);
		writeFiles(live, {
			'nao_config.yaml': 'name: live\n',
			'context.md': 'live content\n',
			'generated.md': '---\ntype: generated\n---\nlive generated\n',
			'annotations.md': 'live notes\n',
			'rendered.md': 'live rendered\n',
			'rendered.md.j2': 'live template\n',
			'repos/source.md': 'live synced\n',
			'docs/notion/page.md': 'live notion\n',
			'untracked.md': 'live only\n',
			'.env': 'secret\n',
			'nested/.env.local': 'nested secret\n',
			'nested/repository/.git/config': 'protected\n',
		});
		liveSnapshot = snapshot(live);
		const context: ContextExplorerGitContext = {
			projectId: 'project-id',
			projectFolder: live,
			userId: 'user-1',
			user: { name: 'Test User', email: 'test@example.com' },
			token: 'token',
			configOverride: { provider: 'github', repoFullName: 'nao/context' },
			integrationAvailableOverride: true,
			providerOverride: provider(bare),
		};
		access = {
			projectFolder: live,
			git: await resolveContextExplorerGit(context),
		};
	});

	afterEach(() => {
		fs.rmSync(root, { recursive: true, force: true });
	});

	it('reads and writes tracked content only in the worktree with optimistic locking', async () => {
		const original = await readFileContent('/context.md', access);
		const result = await writeFileContent('/context.md', 'updated\n', original.hash, access);
		const updated = await readFileContent('/context.md', access);

		expect(original.content).toBe('repository content\n');
		expect(updated.content).toBe('updated\n');
		expect(result.hash).toBe(updated.hash);
		await expect(writeFileContent('/context.md', 'stale\n', original.hash, access)).rejects.toMatchObject({
			code: 'CONFLICT',
		});
		expectLiveUnchanged();
	});

	it('browses the live project read-only when no repository is connected', async () => {
		const readOnlyAccess: ContextExplorerFileAccess = {
			projectFolder: live,
			git: await resolveContextExplorerGit({
				projectId: 'project-id',
				projectFolder: live,
				userId: 'user-1',
				user: { name: 'Test User', email: 'test@example.com' },
				token: 'token',
				configOverride: null,
				integrationAvailableOverride: true,
				providerOverride: provider(bare),
			}),
		};
		const tree = await getFileTreeResponse(readOnlyAccess);
		const file = await readFileContent('/context.md', readOnlyAccess);

		expect(tree).toMatchObject({ repo: null, gitUnavailableReason: 'no-repo' });
		expect(tree.entries.map((entry) => entry.name)).toContain('context.md');
		expect(file).toMatchObject({
			content: 'live content\n',
			isEditable: false,
			reason: 'no-repo',
		});
		await expect(writeFileContent('/context.md', 'changed\n', file.hash, readOnlyAccess)).rejects.toMatchObject({
			code: 'FORBIDDEN',
		});
		expectLiveUnchanged();
	});

	it('returns every editability reason with actionable guidance in precedence order', async () => {
		const generated = await readFileContent('/generated.md', access);
		const rendered = await readFileContent('/rendered.md', access);
		const repoSource = await readFileContent('/repos/source.md', access);
		const notion = await readFileContent('/docs/notion/page.md', access);
		const untracked = await readFileContent('/untracked.md', access);

		expect(generated).toMatchObject({
			reason: 'generated',
			guidance: { actionKind: 'file', actionPath: '/annotations.md' },
		});
		expect(rendered).toMatchObject({
			reason: 'rendered-template',
			guidance: { actionKind: 'file', actionPath: '/rendered.md.j2' },
		});
		expect(repoSource).toMatchObject({
			reason: 'synced-source',
			guidance: { actionKind: 'file', actionPath: '/nao_config.yaml' },
		});
		expect(notion.reason).toBe('synced-source');
		expect(untracked).toMatchObject({
			reason: 'not-tracked',
			guidance: { message: expect.stringContaining('Add it') },
		});
		expectLiveUnchanged();
	});

	it('excludes and rejects .git and environment files across tree, read, write, and search', async () => {
		const tree = await getFileTreeResponse(access);
		const nested = tree.entries.find((entry) => entry.name === 'nested');
		const context = await readFileContent('/context.md', access);

		expect(tree.entries.map((entry) => entry.name)).not.toEqual(expect.arrayContaining(['.git', '.env']));
		expect(nested?.children?.map((entry) => entry.name)).not.toContain('.env.local');
		for (const protectedPath of ['/nested/repository/.git/config', '/.env', '/nested/.env.local']) {
			await expect(readFileContent(protectedPath, access)).rejects.toMatchObject({ code: 'FORBIDDEN' });
			await expect(writeFileContent(protectedPath, 'changed\n', context.hash, access)).rejects.toMatchObject({
				code: 'FORBIDDEN',
			});
		}
		expect((await searchFileContents('secret', live)).results).toEqual([]);
		expectLiveUnchanged();
	});

	it('rejects traversal, symlinks, oversized and non-UTF-8 files', async () => {
		const context = await readFileContent('/context.md', access);
		const repo = access.git.status === 'available' ? access.git.repo : null;
		expect(repo).not.toBeNull();
		const worktreeProject = repo!.projectPrefix
			? path.join(repo!.worktreeRoot, repo!.projectPrefix)
			: repo!.worktreeRoot;
		const outside = path.join(root, 'outside.md');
		fs.writeFileSync(outside, 'outside\n');
		fs.symlinkSync(outside, path.join(worktreeProject, 'linked.md'));
		fs.writeFileSync(path.join(worktreeProject, 'context.md'), Buffer.from([0xff, 0xfe]));

		await expect(writeFileContent('../outside.md', 'changed\n', context.hash, access)).rejects.toMatchObject({
			code: 'FORBIDDEN',
		});
		await expect(writeFileContent('/linked.md', 'changed\n', context.hash, access)).rejects.toMatchObject({
			code: 'FORBIDDEN',
		});
		await expect(
			writeFileContent('/context.md', 'a'.repeat(MAX_CONTEXT_FILE_SIZE + 1), context.hash, access),
		).rejects.toMatchObject({ code: 'BAD_REQUEST' });
		await expect(readFileContent('/context.md', access)).rejects.toMatchObject({ code: 'BAD_REQUEST' });
		expect(fs.readFileSync(outside, 'utf8')).toBe('outside\n');
		expectLiveUnchanged();
	});

	it('preserves file mode and permits only one concurrent atomic write', async () => {
		const repo = access.git.status === 'available' ? access.git.repo : null;
		const target = path.join(repo!.worktreeRoot, 'context.md');
		fs.chmodSync(target, 0o600);
		const original = await readFileContent('/context.md', access);
		const results = await Promise.allSettled([
			writeFileContent('/context.md', 'first\n', original.hash, access),
			writeFileContent('/context.md', 'second\n', original.hash, access),
		]);

		expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
		expect(results.filter((result) => result.status === 'rejected')).toHaveLength(1);
		expect(fs.statSync(target).mode & 0o777).toBe(0o600);
		expectLiveUnchanged();
	});

	it.each([
		['/generated.md', 'generated', 'file', '/annotations.md'],
		['/rendered.md', 'rendered-template', 'file', '/rendered.md.j2'],
		['/repos/source.md', 'synced-source', 'file', '/nao_config.yaml'],
		['/docs/notion/page.md', 'synced-source', 'file', '/nao_config.yaml'],
		['/untracked.md', 'not-tracked', null, null],
	])('reports guidance for %s', async (filePath, reason, actionKind, actionPath) => {
		const file = await readFileContent(filePath, access);
		expect(file.reason).toBe(reason);
		expect(file.guidance?.actionKind).toBe(actionKind);
		expect(file.guidance?.actionPath).toBe(actionPath);
	});

	it.each(['/nested/repository/.git/config', '/.env', '/nested/.env.local'])(
		'rejects protected read %s',
		async (filePath) => {
			await expect(readFileContent(filePath, access)).rejects.toMatchObject({ code: 'FORBIDDEN' });
		},
	);

	it.each(['/nested/repository/.git/config', '/.env', '/nested/.env.local'])(
		'rejects protected write %s',
		async (filePath) => {
			const context = await readFileContent('/context.md', access);
			await expect(writeFileContent(filePath, 'changed\n', context.hash, access)).rejects.toMatchObject({
				code: 'FORBIDDEN',
			});
		},
	);

	it.each(['/generated.md', '/rendered.md', '/repos/source.md', '/untracked.md'])(
		'rejects read-only write %s',
		async (filePath) => {
			const file = await readFileContent(filePath, access);
			await expect(writeFileContent(filePath, 'changed\n', file.hash, access)).rejects.toMatchObject({
				code: 'FORBIDDEN',
			});
		},
	);

	function expectLiveUnchanged(): void {
		expect(snapshot(live)).toEqual(liveSnapshot);
		expect(fs.existsSync(path.join(live, '.git'))).toBe(false);
	}
});

function provider(bare: string): ContextRepositoryProvider {
	return {
		getToken: async () => 'token',
		notConnectedMessage: 'Not connected.',
		isIntegrationAvailable: () => true,
		authenticatedRepoUrl: () => bare,
		publicRepoUrl: () => 'https://github.com/nao/context.git',
		cloneRepo: () => undefined,
		getGitInfo: () => ({ branch: 'main' }),
		getUserGitIdentity: async () => ({ name: 'Test', email: 'test@example.com' }),
		coAuthor: { name: 'nao', email: 'naoagent@getnao.io' },
		commitAllAndPushBranch: () => undefined,
		pushBranch: () => undefined,
		findOpenReviewRequest: async () => null,
		findReviewRequestByBranch: async () => null,
		openReviewRequest: async () => ({ url: 'https://github.com/nao/context/pull/1' }),
	};
}

function initRepository(folder: string): void {
	runGit(folder, ['init', '--quiet', '--initial-branch=main']);
}

function commitAll(folder: string): void {
	runGit(folder, ['add', '-A']);
	runGit(folder, ['-c', 'user.name=Test', '-c', 'user.email=test@example.com', 'commit', '--quiet', '-m', 'initial']);
}

function runGit(cwd: string, args: string[]): Buffer {
	return execFileSync('git', args, { cwd, stdio: 'pipe', timeout: 10_000 });
}

function writeFiles(root: string, files: Record<string, string>): void {
	for (const [filePath, content] of Object.entries(files)) {
		const target = path.join(root, filePath);
		fs.mkdirSync(path.dirname(target), { recursive: true });
		fs.writeFileSync(target, content);
	}
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
