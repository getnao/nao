import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

import { expect } from 'vitest';

import type { ContextExplorerFileAccess } from '../../src/services/context-explorer.service';
import {
	type ContextExplorerGitContext,
	type ContextRepositoryProvider,
	resolveContextExplorerGit,
} from '../../src/services/context-explorer-git.service';

export interface ContextGitFixture {
	root: string;
	bare: string;
	seed: string;
	live: string;
	context: ContextExplorerGitContext;
}

/**
 * Seeds a bare `remote.git` with `files` and creates a separate, non-Git `live` project folder,
 * so worktree operations can be checked against a live folder they must never touch.
 */
export function createContextGitFixture(
	root: string,
	files: Record<string, string> = {
		'nao_config.yaml': 'name: test\n',
		'context.md': 'repository content\n',
	},
): ContextGitFixture {
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
	writeFiles(live, { 'context.md': 'live content\n', 'nao_config.yaml': 'name: live\n' });
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

export function baseContext(
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
		user: { name: 'Test User', email: 'test@example.com' },
		token: 'test-token',
		configOverride,
		integrationAvailableOverride: true,
	};
}

/** Clones from and pushes to the local `bare` repository instead of a hosted Git provider. */
export function localProvider(
	bare: string,
	publicUrl = 'https://github.com/nao/context.git',
): ContextRepositoryProvider {
	let openReviewRequest: { kind: 'created'; url: string } | null = null;
	return {
		getToken: async () => 'test-token',
		notConnectedMessage: 'Not connected.',
		isIntegrationAvailable: () => true,
		authenticatedRepoUrl: () => bare,
		publicRepoUrl: () => publicUrl,
		cloneRepo: () => undefined,
		getGitInfo: () => ({ branch: 'main' }),
		getUserGitIdentity: async ({ user }) => user,
		coAuthor: { name: 'nao', email: 'naoagent@getnao.io' },
		commitAllAndPushBranch: () => undefined,
		pushBranch: ({ dir, branch }) => {
			runGit(dir, ['push', bare, `HEAD:refs/heads/${branch}`]);
			return '';
		},
		findOpenReviewRequest: async () => openReviewRequest,
		findReviewRequestByBranch: async () => null,
		openReviewRequest: async () => {
			openReviewRequest = { kind: 'created', url: 'https://github.com/nao/context/pull/1' };
			return openReviewRequest;
		},
	};
}

export async function fileAccess(context: ContextExplorerGitContext): Promise<ContextExplorerFileAccess> {
	return {
		projectFolder: context.projectFolder,
		git: await resolveContextExplorerGit(context),
	};
}

export function initRepository(folder: string): void {
	runGit(folder, ['init', '--quiet', '--initial-branch=main']);
}

export function commitAll(folder: string, message: string): void {
	runGit(folder, ['add', '-A']);
	runGit(folder, ['-c', 'user.name=Test', '-c', 'user.email=test@example.com', 'commit', '--quiet', '-m', message]);
}

export function runGit(cwd: string, args: string[]): Buffer {
	return execFileSync('git', args, { cwd, stdio: 'pipe', timeout: 10_000 });
}

export function writeFiles(root: string, files: Record<string, string>): void {
	for (const [filePath, content] of Object.entries(files)) {
		const target = path.join(root, filePath);
		fs.mkdirSync(path.dirname(target), { recursive: true });
		fs.writeFileSync(target, content);
	}
}

export function snapshot(root: string): Record<string, Buffer> {
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

export function expectLiveUnchanged(live: string, before: Record<string, Buffer>): void {
	expect(snapshot(live)).toEqual(before);
	expect(fs.existsSync(path.join(live, '.git'))).toBe(false);
}
