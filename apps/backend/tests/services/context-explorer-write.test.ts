import fs from 'node:fs';
import path from 'node:path';

import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
	process.env.MODE = 'test';
	process.env.NAO_MODE = 'self-hosted';
	process.env.NAO_DEFAULT_PROJECT_PATH = '';
	process.env.NAO_CONTEXT_SOURCE = 'local';
});

const mocks = vi.hoisted(() => ({
	publishManagedGithubRepositoryUpdate: vi.fn(),
	logError: vi.fn(),
}));

vi.mock('../../src/services/managed-github-repository', async (importOriginal) => ({
	...(await importOriginal<typeof import('../../src/services/managed-github-repository')>()),
	publishManagedGithubRepositoryUpdate: mocks.publishManagedGithubRepositoryUpdate,
}));
vi.mock('../../src/utils/logger', async (importOriginal) => {
	const original = await importOriginal<typeof import('../../src/utils/logger')>();
	return { ...original, logger: { ...original.logger, error: mocks.logError } };
});

import type { ContextExplorerFileAccess } from '../../src/services/context-explorer.service';
import {
	createDraftFile,
	getFileTree,
	MAX_CONTEXT_FILE_SIZE,
	readFileContent,
	readFileHeads,
	searchFileContents,
	writeFileContent,
} from '../../src/services/context-explorer.service';
import { resolveContextExplorerGit } from '../../src/services/context-explorer-git.service';
import { ManagedGithubPublishUncertainError } from '../../src/services/managed-github-repository';
import { getWorktreeProjectRoot } from '../../src/utils/context-repo';
import { contextWorktreeLockKey, withKeyedLock } from '../../src/utils/keyed-lock';
import { isIgnoredByNaoignore } from '../../src/utils/tools';
import {
	commitAll,
	type ContextGitFixture,
	createContextGitFixture,
	expectLiveUnchanged,
	fileAccess,
	initRepository,
	snapshot,
	writeFiles,
} from '../helpers/context-git-fixture';
import { useTemporaryFolders } from '../helpers/temporary-folders';

describe('context explorer worktree writes', () => {
	const createTemporaryFolder = useTemporaryFolders();
	let fixture: ContextGitFixture;
	let access: ContextExplorerFileAccess;
	let liveSnapshot: Record<string, Buffer>;

	beforeEach(async () => {
		fixture = createContextGitFixture(createTemporaryFolder('nao-context-write-'), {
			'nao_config.yaml': 'name: project\n',
			'context.md': 'repository content\n',
			'generated.md': '---\ntype: generated\n---\ngenerated\n',
			'annotations.md': '---\ntype: manual\n---\nnotes\n',
			'rendered.md': 'rendered\n',
			'rendered.md.j2': 'template\n',
			'repos/source.md': 'synced\n',
			'docs/notion/page.md': 'notion\n',
			'docs/confluence/page.md': 'confluence\n',
			'docs/obsidian/note.md': 'obsidian\n',
			'.gitignore': 'ignored\n',
		});
		writeFiles(fixture.live, {
			'nao_config.yaml': 'name: live\n',
			'context.md': 'live content\n',
			'generated.md': '---\ntype: generated\n---\nlive generated\n',
			'annotations.md': 'live notes\n',
			'rendered.md': 'live rendered\n',
			'rendered.md.j2': 'live template\n',
			'repos/source.md': 'live synced\n',
			'docs/notion/page.md': 'live notion\n',
			'docs/confluence/page.md': 'live confluence\n',
			'docs/obsidian/note.md': 'live obsidian\n',
			'untracked.md': 'live only\n',
			'.env': 'secret\n',
			'nested/.env.local': 'nested secret\n',
			'nested/repository/.git/config': 'protected\n',
		});
		liveSnapshot = snapshot(fixture.live);
		access = await fileAccess(fixture.context);
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
		expectLiveUnchanged(fixture.live, liveSnapshot);
	});

	it('reads the head of each file where the explorer reads it, leaving out the files it cannot read', async () => {
		const heads = await readFileHeads(['/context.md', '/untracked.md', '/missing.md', '/../outside.md'], access);

		expect(heads).toEqual([
			{ path: '/context.md', content: 'repository content\n' },
			{ path: '/untracked.md', content: 'live only\n' },
		]);
	});

	it('creates new files as editable worktree drafts without touching the live project', async () => {
		const created = await createDraftFile('/tests/new/revenue.yml', 'name: revenue\n', access);
		const draft = await readFileContent('/tests/new/revenue.yml', access);
		const updated = await writeFileContent('/tests/new/revenue.yml', 'name: updated\n', draft.hash, access);

		expect(draft).toMatchObject({ content: 'name: revenue\n', isEditable: true, hash: created.hash });
		expect((await readFileContent('/tests/new/revenue.yml', access)).hash).toBe(updated.hash);
		await expect(createDraftFile('/tests/new/revenue.yml', 'again\n', access)).rejects.toMatchObject({
			code: 'CONFLICT',
		});
		await expect(createDraftFile('/untracked.md', 'shadow\n', access)).rejects.toMatchObject({
			code: 'CONFLICT',
		});
		await expect(createDraftFile('/.env.test', 'secret\n', access)).rejects.toMatchObject({ code: 'FORBIDDEN' });
		await expect(createDraftFile('../outside.yml', 'outside\n', access)).rejects.toMatchObject({
			code: 'FORBIDDEN',
		});
		expectLiveUnchanged(fixture.live, liveSnapshot);
	});

	it('shows the tests folder despite .naoignore while keeping it hidden from the agent', async () => {
		writeFiles(fixture.live, {
			'.naoignore': 'tests/\nprivate/\n',
			'tests/revenue.yml': 'prompt: What is the revenue?\n',
			'private/notes.md': 'What is the revenue?\n',
		});

		const tree = await getFileTree(fixture.live);
		const test = await readFileContent('/tests/revenue.yml', access);
		const search = await searchFileContents('revenue', fixture.live);

		expect(tree.map((entry) => entry.name)).toContain('tests');
		expect(tree.map((entry) => entry.name)).not.toContain('private');
		expect(test.content).toBe('prompt: What is the revenue?\n');
		await expect(readFileContent('/private/notes.md', access)).rejects.toMatchObject({ code: 'FORBIDDEN' });
		expect(search.results.map((result) => result.path)).toEqual(['/tests/revenue.yml']);
		expect(isIgnoredByNaoignore('tests/revenue.yml', fixture.live)).toBe(true);
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
		expectLiveUnchanged(fixture.live, liveSnapshot);
	});

	it('excludes and rejects .git and environment files across tree, read, write, and search', async () => {
		const tree = await getFileTree(fixture.live);
		const nested = tree.find((entry) => entry.name === 'nested');
		const context = await readFileContent('/context.md', access);

		expect(tree.map((entry) => entry.name)).not.toEqual(expect.arrayContaining(['.git', '.env']));
		expect(nested?.children?.map((entry) => entry.name)).not.toContain('.env.local');
		for (const protectedPath of ['/nested/repository/.git/config', '/.env', '/nested/.env.local']) {
			await expect(readFileContent(protectedPath, access)).rejects.toMatchObject({ code: 'FORBIDDEN' });
			await expect(writeFileContent(protectedPath, 'changed\n', context.hash, access)).rejects.toMatchObject({
				code: 'FORBIDDEN',
			});
		}
		expect((await searchFileContents('secret', fixture.live)).results).toEqual([]);
		expectLiveUnchanged(fixture.live, liveSnapshot);
	});

	it('rejects traversal, symlinks, oversized and non-UTF-8 files', async () => {
		const context = await readFileContent('/context.md', access);
		const repo = access.git.status === 'available' ? access.git.repo : null;
		expect(repo).not.toBeNull();
		const worktreeProject = repo!.projectPrefix
			? path.join(repo!.worktreeRoot, repo!.projectPrefix)
			: repo!.worktreeRoot;
		const outside = path.join(fixture.root, 'outside.md');
		fs.writeFileSync(outside, 'outside\n');
		fs.symlinkSync(outside, path.join(worktreeProject, 'linked.md'));
		fs.symlinkSync(fixture.root, path.join(worktreeProject, 'linked-dir'), 'dir');
		fs.writeFileSync(path.join(worktreeProject, 'context.md'), Buffer.from([0xff, 0xfe]));

		await expect(writeFileContent('../outside.md', 'changed\n', context.hash, access)).rejects.toMatchObject({
			code: 'FORBIDDEN',
		});
		await expect(writeFileContent('/linked.md', 'changed\n', context.hash, access)).rejects.toMatchObject({
			code: 'FORBIDDEN',
		});
		await expect(
			writeFileContent('/linked-dir/outside.md', 'changed\n', context.hash, access),
		).rejects.toMatchObject({ code: 'FORBIDDEN' });
		await expect(readFileContent('/linked-dir/outside.md', access)).rejects.toMatchObject({ code: 'FORBIDDEN' });
		await expect(
			writeFileContent('/context.md', 'a'.repeat(MAX_CONTEXT_FILE_SIZE + 1), context.hash, access),
		).rejects.toMatchObject({ code: 'BAD_REQUEST' });
		await expect(readFileContent('/context.md', access)).rejects.toMatchObject({ code: 'BAD_REQUEST' });
		expect(fs.readFileSync(outside, 'utf8')).toBe('outside\n');
		expectLiveUnchanged(fixture.live, liveSnapshot);
	});

	it('waits for the worktree lock, preserves file mode, and permits only one concurrent write', async () => {
		const repo = access.git.status === 'available' ? access.git.repo : null;
		const worktreeRoot = getWorktreeProjectRoot(repo!);
		const target = path.join(worktreeRoot, 'context.md');
		fs.chmodSync(target, 0o600);
		const original = await readFileContent('/context.md', access);
		let releaseLock: () => void = () => undefined;
		let lockAcquired: () => void = () => undefined;
		const acquired = new Promise<void>((resolve) => {
			lockAcquired = resolve;
		});
		const heldLock = withKeyedLock(contextWorktreeLockKey('project-id', 'user-1'), async () => {
			lockAcquired();
			await new Promise<void>((resolve) => {
				releaseLock = resolve;
			});
		});
		await acquired;
		let writesSettled = false;
		const writes = Promise.allSettled([
			writeFileContent('/context.md', 'first\n', original.hash, access),
			writeFileContent('/context.md', 'second\n', original.hash, access),
		]).finally(() => {
			writesSettled = true;
		});
		await new Promise<void>((resolve) => setImmediate(resolve));
		expect(writesSettled).toBe(false);
		releaseLock();
		await heldLock;
		const results = await writes;

		expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
		expect(results.filter((result) => result.status === 'rejected')).toHaveLength(1);
		expect(fs.statSync(target).mode & 0o777).toBe(0o600);
		expectLiveUnchanged(fixture.live, liveSnapshot);
	});

	it.each([
		['/docs/notion/page.md', 'synced-source', 'file', '/nao_config.yaml'],
		['/docs/confluence/page.md', 'synced-source', 'file', '/nao_config.yaml'],
		['/docs/obsidian/note.md', 'synced-source', 'file', '/nao_config.yaml'],
		['/untracked.md', 'not-tracked', null, null],
	])('reports guidance for %s', async (filePath, reason, actionKind, actionPath) => {
		const file = await readFileContent(filePath, access);
		expect(file.reason).toBe(reason);
		expect(file.guidance?.actionKind).toBe(actionKind);
		expect(file.guidance?.actionPath).toBe(actionPath);
	});

	it.each(['/generated.md', '/rendered.md', '/repos/source.md', '/untracked.md'])(
		'rejects read-only write %s',
		async (filePath) => {
			const file = await readFileContent(filePath, access);
			await expect(writeFileContent(filePath, 'changed\n', file.hash, access)).rejects.toMatchObject({
				code: 'FORBIDDEN',
			});
		},
	);
	it('saves nao-managed projects in place and publishes the file to main', async () => {
		const managed = await createManagedAccess();
		mocks.publishManagedGithubRepositoryUpdate.mockResolvedValueOnce(true);

		const original = await readFileContent('/context.md', managed.access);
		const result = await writeFileContent('/context.md', 'edited\n', original.hash, managed.access);

		expect(original).toMatchObject({ content: 'managed content\n', isEditable: true });
		expect(fs.readFileSync(path.join(managed.folder, 'context.md'), 'utf8')).toBe('edited\n');
		expect(result.hash).toBe((await readFileContent('/context.md', managed.access)).hash);
		expect(mocks.publishManagedGithubRepositoryUpdate).toHaveBeenCalledWith({
			projectDir: managed.folder,
			repoFullName: 'nao-org/nao-project',
			paths: ['context.md'],
			message: 'Update context.md',
			author: { name: 'Test User', email: 'test@example.com' },
		});
		expect((await readFileContent('/scratch.md', managed.access)).reason).toBe('not-tracked');
	});

	it('restores a nao-managed file when publishing it fails', async () => {
		const managed = await createManagedAccess();
		mocks.publishManagedGithubRepositoryUpdate.mockRejectedValueOnce(new Error('push rejected'));

		const original = await readFileContent('/context.md', managed.access);

		await expect(writeFileContent('/context.md', 'edited\n', original.hash, managed.access)).rejects.toMatchObject({
			code: 'INTERNAL_SERVER_ERROR',
		});
		expect(fs.readFileSync(path.join(managed.folder, 'context.md'), 'utf8')).toBe('managed content\n');
	});

	it('keeps a nao-managed edit locally when the push result is uncertain', async () => {
		const managed = await createManagedAccess();
		mocks.publishManagedGithubRepositoryUpdate.mockRejectedValueOnce(
			new ManagedGithubPublishUncertainError('Could not verify the push'),
		);
		const original = await readFileContent('/context.md', managed.access);

		await expect(writeFileContent('/context.md', 'edited\n', original.hash, managed.access)).rejects.toMatchObject({
			code: 'INTERNAL_SERVER_ERROR',
			message: expect.stringContaining('saved locally'),
		});

		expect(fs.readFileSync(path.join(managed.folder, 'context.md'), 'utf8')).toBe('edited\n');
	});

	it('creates and publishes new files in nao-managed projects', async () => {
		const managed = await createManagedAccess();
		mocks.publishManagedGithubRepositoryUpdate.mockResolvedValueOnce(true);

		const result = await createDraftFile('/agent/skills/revenue.md', '# Revenue\n', managed.access);

		expect(fs.readFileSync(path.join(managed.folder, 'agent/skills/revenue.md'), 'utf8')).toBe('# Revenue\n');
		expect(result.hash).toMatch(/^[a-f0-9]{64}$/);
		expect(mocks.publishManagedGithubRepositoryUpdate).toHaveBeenCalledWith({
			projectDir: managed.folder,
			repoFullName: 'nao-org/nao-project',
			paths: ['agent/skills/revenue.md'],
			message: 'Add agent/skills/revenue.md',
			author: { name: 'Test User', email: 'test@example.com' },
		});
	});

	it('removes a new nao-managed file when publishing fails', async () => {
		const managed = await createManagedAccess();
		mocks.publishManagedGithubRepositoryUpdate.mockRejectedValueOnce(new Error('push rejected'));
		const filePath = path.join(managed.folder, 'agent/skills/revenue.md');

		await expect(createDraftFile('/agent/skills/revenue.md', '# Revenue\n', managed.access)).rejects.toMatchObject({
			code: 'INTERNAL_SERVER_ERROR',
		});

		expect(fs.existsSync(filePath)).toBe(false);
	});

	async function createManagedAccess(): Promise<{ folder: string; access: ContextExplorerFileAccess }> {
		const folder = path.join(fixture.root, 'managed');
		fs.mkdirSync(folder);
		initRepository(folder);
		writeFiles(folder, { 'nao_config.yaml': 'name: managed\n', 'context.md': 'managed content\n' });
		commitAll(folder, 'Initial');
		writeFiles(folder, { 'scratch.md': 'not committed\n' });
		const git = await resolveContextExplorerGit({
			projectId: 'project-id',
			projectFolder: folder,
			userId: 'user-1',
			user: { name: 'Test User', email: 'test@example.com' },
			token: null,
			configOverride: null,
		});
		return {
			folder,
			access: {
				projectFolder: folder,
				git,
				draftOwner: { projectId: 'project-id', userId: 'user-1' },
				managedRepository: {
					repoFullName: 'nao-org/nao-project',
					author: { name: 'Test User', email: 'test@example.com' },
				},
			},
		};
	}
});
