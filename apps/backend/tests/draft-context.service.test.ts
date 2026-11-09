import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
	createDraftContextSnapshot,
	readDraftContext,
	readGitDraft,
	removeContextSnapshot,
	removeContextSnapshotsOlderThan,
} from '../src/services/draft-context.service';
import type { ResolvedContextRepo } from '../src/utils/context-repo';

let root: string;
let liveFolder: string;
let worktreeRoot: string;

beforeEach(() => {
	root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'nao-draft-context-')));
	liveFolder = path.join(root, 'context');
	worktreeRoot = path.join(root, 'worktree');
	writeFiles(liveFolder, {
		'nao_config.yaml': 'project_name: live\n',
		'RULES.md': '# Rules\n',
		'docs/revenue.md': 'Revenue is net of refunds.\n',
		'docs/legacy.md': 'Old definition.\n',
		'.gitignore': 'databases/\n',
	});
	git(liveFolder, ['init', '--quiet', '--initial-branch=main']);
	commitAll(liveFolder, 'initial');
	writeFiles(liveFolder, { 'databases/orders/columns.md': '# orders\n' });
	git(liveFolder, ['worktree', 'add', '--quiet', '--detach', worktreeRoot, 'HEAD']);
});

afterEach(() => {
	fs.rmSync(root, { recursive: true, force: true });
});

describe('readDraftContext', () => {
	it('lists committed, uncommitted and new files, and sets aside the production-only ones', () => {
		git(worktreeRoot, ['switch', '--quiet', '-c', 'improve-revenue']);
		writeFiles(worktreeRoot, { 'RULES.md': '# Rules\nUse net revenue.\n' });
		commitAll(worktreeRoot, 'rules');
		writeFiles(worktreeRoot, {
			'docs/revenue.md': 'Revenue is net of refunds and taxes.\n',
			'docs/margin.md': 'Margin is revenue minus cost.\n',
			'nao_config.yaml': 'project_name: hijacked\n',
		});
		fs.rmSync(path.join(worktreeRoot, 'docs/legacy.md'));

		const draft = readDraftContext(resolvedRepo(), liveFolder);

		expect(draft.branch).toBe('improve-revenue');
		expect(draft.productionCommit).toBe(git(liveFolder, ['rev-parse', 'HEAD']).toString().trim());
		expect(draft.changes).toEqual([
			{ path: 'docs/legacy.md', kind: 'deleted' },
			{ path: 'docs/margin.md', kind: 'added' },
			{ path: 'docs/revenue.md', kind: 'modified' },
			{ path: 'RULES.md', kind: 'modified' },
		]);
		expect(draft.excludedChanges).toEqual([{ path: 'nao_config.yaml', kind: 'modified' }]);
		expect(draft.outdatedPaths).toEqual([]);
	});

	it('flags the changed files that production changed since the draft started', () => {
		writeFiles(worktreeRoot, { 'docs/revenue.md': 'Draft definition.\n', 'RULES.md': '# Draft rules\n' });
		writeFiles(liveFolder, { 'docs/revenue.md': 'Production definition.\n' });
		commitAll(liveFolder, 'production update');

		const draft = readDraftContext(resolvedRepo(), liveFolder);

		expect(draft.outdatedPaths).toEqual(['docs/revenue.md']);
	});

	it('maps paths relative to the context folder when it is a subfolder of the repository', () => {
		const subfolderRoot = path.join(root, 'mono');
		writeFiles(subfolderRoot, { 'analytics/RULES.md': '# Rules\n', 'README.md': 'Repository readme\n' });
		git(subfolderRoot, ['init', '--quiet', '--initial-branch=main']);
		commitAll(subfolderRoot, 'initial');
		const subfolderWorktree = path.join(root, 'mono-worktree');
		git(subfolderRoot, ['worktree', 'add', '--quiet', '--detach', subfolderWorktree, 'HEAD']);
		writeFiles(subfolderWorktree, { 'analytics/RULES.md': '# Rules v2\n', 'README.md': 'Changed readme\n' });

		const draft = readDraftContext(
			resolvedRepo({ worktreeRoot: subfolderWorktree, projectPrefix: 'analytics' }),
			path.join(subfolderRoot, 'analytics'),
		);

		expect(draft.changes).toEqual([{ path: 'RULES.md', kind: 'modified' }]);
	});
});

describe('createDraftContextSnapshot', () => {
	it('copies production with the draft changes applied, keeping untracked production content', () => {
		writeFiles(worktreeRoot, {
			'RULES.md': '# Rules\nUse net revenue.\n',
			'docs/margin.md': 'Margin is revenue minus cost.\n',
			'nao_config.yaml': 'project_name: hijacked\n',
		});
		fs.rmSync(path.join(worktreeRoot, 'docs/legacy.md'));

		const snapshot = createDraftContextSnapshot({
			projectId: 'project-1',
			projectFolder: liveFolder,
			draft: readGitDraft(resolvedRepo(), liveFolder),
		});

		expect(snapshot.folder.startsWith(path.join(root, '.nao', 'test-contexts', 'project-1'))).toBe(true);
		expect(read(snapshot.folder, 'RULES.md')).toBe('# Rules\nUse net revenue.\n');
		expect(read(snapshot.folder, 'docs/margin.md')).toBe('Margin is revenue minus cost.\n');
		expect(read(snapshot.folder, 'docs/revenue.md')).toBe('Revenue is net of refunds.\n');
		expect(read(snapshot.folder, 'nao_config.yaml')).toBe('project_name: live\n');
		expect(read(snapshot.folder, 'databases/orders/columns.md')).toBe('# orders\n');
		expect(fs.existsSync(path.join(snapshot.folder, 'docs/legacy.md'))).toBe(false);
		expect(fs.existsSync(path.join(snapshot.folder, '.git'))).toBe(false);
		expect(read(liveFolder, 'RULES.md')).toBe('# Rules\n');

		removeContextSnapshot(snapshot.folder);
		expect(fs.existsSync(snapshot.folder)).toBe(false);
	});

	it('keeps the production .naoignore, so a draft cannot expose the files it hides from the agent', () => {
		writeFiles(liveFolder, { '.naoignore': 'private/\n' });
		writeFiles(worktreeRoot, { '.naoignore': '' });

		const draft = readGitDraft(resolvedRepo(), liveFolder);
		const snapshot = createDraftContextSnapshot({ projectId: 'project-1', projectFolder: liveFolder, draft });

		expect(draft.context.excludedChanges).toEqual([{ path: '.naoignore', kind: 'added' }]);
		expect(read(snapshot.folder, '.naoignore')).toBe('private/\n');
		removeContextSnapshot(snapshot.folder);
	});

	it('does not follow a symlink of the production context out of the snapshot', () => {
		const outside = path.join(root, 'outside');
		fs.mkdirSync(outside);
		fs.symlinkSync(outside, path.join(liveFolder, 'linked'));
		writeFiles(worktreeRoot, { 'linked/escape.md': 'escaped\n' });

		expect(() =>
			createDraftContextSnapshot({
				projectId: 'project-1',
				projectFolder: liveFolder,
				draft: readGitDraft(resolvedRepo(), liveFolder),
			}),
		).toThrow();
		expect(fs.existsSync(path.join(outside, 'escape.md'))).toBe(false);
		expect(fs.readdirSync(path.join(root, '.nao', 'test-contexts', 'project-1'))).toEqual([]);
	});

	it('applies a draft that nao keeps, without a worktree', () => {
		const snapshot = createDraftContextSnapshot({
			projectId: 'project-1',
			projectFolder: liveFolder,
			draft: {
				context: {
					storage: 'nao',
					branch: null,
					productionBranch: null,
					productionCommit: null,
					changes: [
						{ path: 'RULES.md', kind: 'modified' },
						{ path: 'docs/margin.md', kind: 'added' },
					],
					excludedChanges: [],
					outdatedPaths: [],
				},
				readChangedFile: (projectPath) => Buffer.from(`draft of ${projectPath}\n`),
			},
		});

		expect(read(snapshot.folder, 'RULES.md')).toBe('draft of RULES.md\n');
		expect(read(snapshot.folder, 'docs/margin.md')).toBe('draft of docs/margin.md\n');
		expect(read(snapshot.folder, 'docs/revenue.md')).toBe('Revenue is net of refunds.\n');
		expect(read(liveFolder, 'RULES.md')).toBe('# Rules\n');
		removeContextSnapshot(snapshot.folder);
	});
});

describe('removeContextSnapshotsOlderThan', () => {
	it('removes only the snapshots older than the given age', () => {
		const snapshotsRoot = path.join(root, '.nao', 'test-contexts', 'project-1');
		writeFiles(snapshotsRoot, { 'old/RULES.md': 'old', 'recent/RULES.md': 'recent' });
		const twoDaysAgo = new Date(Date.now() - 2 * 24 * 60 * 60_000);
		fs.utimesSync(path.join(snapshotsRoot, 'old'), twoDaysAgo, twoDaysAgo);

		removeContextSnapshotsOlderThan(liveFolder, 'project-1', 24 * 60 * 60_000);

		expect(fs.readdirSync(snapshotsRoot)).toEqual(['recent']);
	});
});

function resolvedRepo(overrides: Partial<ResolvedContextRepo> = {}): ResolvedContextRepo {
	return {
		provider: 'github',
		repoFullName: 'acme/context',
		branch: null,
		source: 'settings',
		worktreeRoot,
		projectPrefix: '',
		...overrides,
	};
}

function writeFiles(folder: string, files: Record<string, string>) {
	for (const [relativePath, content] of Object.entries(files)) {
		const filePath = path.join(folder, relativePath);
		fs.mkdirSync(path.dirname(filePath), { recursive: true });
		fs.writeFileSync(filePath, content);
	}
}

function read(folder: string, relativePath: string): string {
	return fs.readFileSync(path.join(folder, relativePath), 'utf-8');
}

function commitAll(folder: string, message: string) {
	git(folder, ['add', '-A']);
	git(folder, ['-c', 'user.name=Test', '-c', 'user.email=test@example.com', 'commit', '--quiet', '-m', message]);
}

function git(cwd: string, args: string[]): Buffer {
	return execFileSync('git', args, { cwd, stdio: 'pipe', timeout: 10_000 });
}
