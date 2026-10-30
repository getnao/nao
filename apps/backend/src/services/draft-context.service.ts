import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

import type { TestContextChange } from '../types/test-run';
import {
	fromRepoPath,
	getContextWorktreePath,
	getWorktreeProjectRoot,
	type ResolvedContextRepo,
	toRepoPath,
} from '../utils/context-repo';
import { runGit } from '../utils/git-repo';
import { assertNoSymlinkInWritePath, resolveWritePath } from '../utils/safe-file-write';
import {
	discoverLiveRepositoryRoot,
	hasCommit,
	readCurrentBranch,
	readDefaultBranch,
	readDefaultBranchRef,
	readOptionalGitValue,
} from './context-explorer-git/git-guards';

/**
 * Paths a draft cannot change: they hold connections and credentials, which must not run unreviewed,
 * or the agent loads them once per project instead of from the context folder.
 */
const PRODUCTION_ONLY_PATHS = [/^nao_config\.yaml$/, /^\.env(\..+)?$/, /^agent\/mcps\//, /^agent\/skills\//];
const SKIPPED_ENTRY_NAMES = new Set(['.git', 'node_modules']);
const PROJECT_ID_PATTERN = /^[A-Za-z0-9_-]+$/;
const DIFF_STATUS_KINDS: Record<string, TestContextChange['kind']> = { A: 'added', D: 'deleted' };

/** The user's File Explorer changes, relative to the production context they started from. */
export interface DraftContext {
	branch: string | null;
	/** The production commit the changes are compared with. */
	productionCommit: string | null;
	changes: TestContextChange[];
	/** Changes left out of the draft because those paths always come from production. */
	excludedChanges: TestContextChange[];
	/** Changed files that production also changed since the draft started, which the draft would revert. */
	outdatedPaths: string[];
}

export interface DraftContextSnapshot extends DraftContext {
	folder: string;
}

/** Users who never opened the File Explorer have no worktree, so no changes, and no clone should be made for them. */
export function hasContextWorktree(projectId: string, projectFolder: string, userId: string): boolean {
	return fs.existsSync(getContextWorktreePath(projectId, projectFolder, userId));
}

export function readDraftContext(repo: ResolvedContextRepo, projectFolder: string): DraftContext {
	const productionCommit = readProductionCommit(repo, projectFolder);
	const baseCommit = productionCommit
		? readOptionalGitValue(repo.worktreeRoot, ['merge-base', 'HEAD', productionCommit])
		: null;
	const allChanges = [...readCommittedAndStagedChanges(repo, baseCommit ?? 'HEAD'), ...readUntrackedFiles(repo)].sort(
		(left, right) => left.path.localeCompare(right.path),
	);
	const changes = allChanges.filter((change) => !isProductionOnly(change.path));
	return {
		branch: readCurrentBranch(repo),
		productionCommit,
		changes,
		excludedChanges: allChanges.filter((change) => isProductionOnly(change.path)),
		outdatedPaths:
			baseCommit && productionCommit && baseCommit !== productionCommit
				? readPathsChangedBetween(repo, baseCommit, productionCommit, changes)
				: [],
	};
}

/**
 * Copies the production context folder and applies the draft changes on top, so the copy differs from
 * production by those changes only. Untracked production content, such as synced metadata, is kept.
 */
export function createDraftContextSnapshot(input: {
	projectId: string;
	projectFolder: string;
	repo: ResolvedContextRepo;
}): DraftContextSnapshot {
	const draft = readDraftContext(input.repo, input.projectFolder);
	const folder = path.join(getSnapshotsRoot(input.projectFolder, input.projectId), randomUUID());
	try {
		copyContextFolder(path.resolve(input.projectFolder), folder);
		applyChanges(draft.changes, getWorktreeProjectRoot(input.repo), folder);
	} catch (error) {
		removeContextSnapshot(folder);
		throw error;
	}
	return { ...draft, folder };
}

export function removeContextSnapshot(folder: string): void {
	fs.rmSync(folder, { recursive: true, force: true });
}

/** Removes the snapshots an interrupted run left behind, once no run can still be using them. */
export function removeContextSnapshotsOlderThan(projectFolder: string, projectId: string, maxAgeMs: number): void {
	const root = getSnapshotsRoot(projectFolder, projectId);
	if (!fs.existsSync(root)) {
		return;
	}
	const cutoff = Date.now() - maxAgeMs;
	for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
		const folder = path.join(root, entry.name);
		if (entry.isDirectory() && fs.statSync(folder).mtimeMs < cutoff) {
			removeContextSnapshot(folder);
		}
	}
}

function readProductionCommit(repo: ResolvedContextRepo, projectFolder: string): string | null {
	const liveRepositoryRoot = discoverLiveRepositoryRoot(projectFolder);
	const liveCommit = liveRepositoryRoot ? readOptionalGitValue(liveRepositoryRoot, ['rev-parse', 'HEAD']) : null;
	if (liveCommit && hasCommit(repo.worktreeRoot, liveCommit)) {
		return liveCommit;
	}
	const defaultRef = readDefaultBranchRefSafely(repo);
	return defaultRef ? readOptionalGitValue(repo.worktreeRoot, ['rev-parse', defaultRef]) : null;
}

function readDefaultBranchRefSafely(repo: ResolvedContextRepo): string | null {
	try {
		return readDefaultBranchRef(repo, readDefaultBranch(repo));
	} catch {
		return null;
	}
}

function readCommittedAndStagedChanges(repo: ResolvedContextRepo, baseCommit: string): TestContextChange[] {
	const output = runGit(repo.worktreeRoot, [
		'diff',
		'--name-status',
		'-z',
		'--no-renames',
		baseCommit,
		'--',
		repo.projectPrefix || '.',
	]);
	const records = output.toString().split('\0');
	const changes: TestContextChange[] = [];
	for (let index = 0; index + 1 < records.length; index += 2) {
		const projectPath = fromRepoPath(repo, records[index + 1]);
		if (projectPath) {
			changes.push({ path: projectPath, kind: DIFF_STATUS_KINDS[records[index]] ?? 'modified' });
		}
	}
	return changes;
}

function readUntrackedFiles(repo: ResolvedContextRepo): TestContextChange[] {
	const output = runGit(repo.worktreeRoot, [
		'ls-files',
		'--others',
		'--exclude-standard',
		'-z',
		'--',
		repo.projectPrefix || '.',
	]);
	return output
		.toString()
		.split('\0')
		.flatMap((repoPath) => {
			const projectPath = repoPath ? fromRepoPath(repo, repoPath) : null;
			return projectPath ? [{ path: projectPath, kind: 'added' as const }] : [];
		});
}

function readPathsChangedBetween(
	repo: ResolvedContextRepo,
	fromCommit: string,
	toCommit: string,
	changes: TestContextChange[],
): string[] {
	if (changes.length === 0) {
		return [];
	}
	const output = runGit(repo.worktreeRoot, [
		'diff',
		'--name-only',
		'-z',
		'--no-renames',
		fromCommit,
		toCommit,
		'--',
		...changes.map((change) => toRepoPath(repo, change.path)),
	]);
	return output
		.toString()
		.split('\0')
		.flatMap((repoPath) => {
			const projectPath = repoPath ? fromRepoPath(repo, repoPath) : null;
			return projectPath ? [projectPath] : [];
		});
}

function isProductionOnly(projectPath: string): boolean {
	return PRODUCTION_ONLY_PATHS.some((pattern) => pattern.test(projectPath));
}

function getSnapshotsRoot(projectFolder: string, projectId: string): string {
	if (!PROJECT_ID_PATTERN.test(projectId)) {
		throw new Error('Invalid project id for a context snapshot path.');
	}
	return path.join(path.dirname(path.resolve(projectFolder)), '.nao', 'test-contexts', projectId);
}

function copyContextFolder(source: string, target: string): void {
	fs.mkdirSync(target, { recursive: true });
	for (const entry of fs.readdirSync(source, { withFileTypes: true })) {
		if (SKIPPED_ENTRY_NAMES.has(entry.name)) {
			continue;
		}
		const sourcePath = path.join(source, entry.name);
		const targetPath = path.join(target, entry.name);
		if (entry.isDirectory()) {
			copyContextFolder(sourcePath, targetPath);
		} else if (entry.isSymbolicLink()) {
			fs.symlinkSync(fs.readlinkSync(sourcePath), targetPath);
		} else if (entry.isFile()) {
			fs.copyFileSync(sourcePath, targetPath, fs.constants.COPYFILE_FICLONE);
		}
	}
}

function applyChanges(changes: TestContextChange[], draftRoot: string, snapshotFolder: string): void {
	for (const change of changes) {
		const target = resolveWritePath(snapshotFolder, change.path);
		assertNoSymlinkInWritePath(snapshotFolder, path.dirname(target), change.path);
		fs.rmSync(target, { force: true });
		if (change.kind === 'deleted') {
			continue;
		}
		const source = resolveWritePath(draftRoot, change.path);
		if (fs.lstatSync(source, { throwIfNoEntry: false })?.isFile()) {
			fs.mkdirSync(path.dirname(target), { recursive: true });
			fs.copyFileSync(source, target);
		}
	}
}
