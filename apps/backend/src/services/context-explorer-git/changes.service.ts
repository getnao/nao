import fs from 'node:fs';

import type { ContextChangedFile, ContextFileDiff } from '@nao/shared/types';
import { TRPCError } from '@trpc/server';

import type { ResolvedContextRepo } from '../../utils/context-repo';
import {
	fromRepoPath,
	getWorktreeProjectRoot,
	normalizeProjectPath,
	readCommittedFile,
	readFileAtCommit,
	toRepoPath,
} from '../../utils/context-repo';
import { runGit, tryRunGit } from '../../utils/git-repo';
import { toRealPath } from '../../utils/tools';
import {
	decodeTextContent,
	hashContent,
	MAX_CONTEXT_FILE_SIZE,
	validateContentBuffer,
} from '../context-explorer.service';
import {
	assertSafeDestructiveWorktreeTarget,
	hasCommit,
	parseLineCount,
	runDestructiveWorktreeGit,
} from './git-guards';
import type { ContextExplorerGitContext, ContextLineCounts, ParsedContextChangedFile } from './types';
import { COMMIT_PATTERN } from './types';
import { requireContextExplorerGit, resolveContextExplorerGit } from './worktree.service';

export async function getChangedContextFiles(context: ContextExplorerGitContext): Promise<ContextChangedFile[]> {
	try {
		const resolution = await resolveContextExplorerGit(context);
		if (resolution.status === 'unavailable') {
			return [];
		}
		return readChangedFiles(resolution.repo);
	} catch {
		return [];
	}
}

export async function getContextFileDiff(
	context: ContextExplorerGitContext,
	filePath: string,
	range?: { fromCommit: string; toCommit: string },
): Promise<ContextFileDiff> {
	const { repo } = await requireContextExplorerGit(context);
	validateWorktreePath(repo, filePath);
	if (range) {
		return getHistoricalContextFileDiff(repo, filePath, range);
	}
	const projectPath = normalizeProjectPath(filePath);
	const changedFile = readChangedFiles(repo).find((entry) => entry.path === `/${projectPath}`);
	if (!changedFile) {
		throw new TRPCError({ code: 'BAD_REQUEST', message: 'This file has no changes.' });
	}
	return {
		...changedFile,
		oldContent: changedFile.kind === 'untracked' ? '' : readCommittedText(repo, projectPath),
		newContent: changedFile.kind === 'deleted' ? '' : readWorkingTreeText(repo, filePath),
	};
}

export async function discardContextFileChange(
	context: ContextExplorerGitContext,
	filePath: string,
): Promise<{ hash: string | null }> {
	const { repo } = await requireContextExplorerGit(context);
	await discardPath(repo, context.projectFolder, filePath);
	const target = toRealPath(filePath, getWorktreeProjectRoot(repo));
	return { hash: fs.existsSync(target) ? hashContent(fs.readFileSync(target)) : null };
}

export async function discardAllContextChanges(context: ContextExplorerGitContext): Promise<void> {
	const { repo } = await requireContextExplorerGit(context);
	const changedFiles = parseChangedFiles(readStatus(repo), repo);
	for (const file of changedFiles) {
		await discardPath(repo, context.projectFolder, file.path);
	}
}

function getHistoricalContextFileDiff(
	repo: ResolvedContextRepo,
	filePath: string,
	range: { fromCommit: string; toCommit: string },
): ContextFileDiff {
	validateHistoricalCommit(repo, range.fromCommit);
	validateHistoricalCommit(repo, range.toCommit);
	const projectPath = normalizeProjectPath(filePath);
	const repoPath = toRepoPath(repo, projectPath);
	const lineCounts = readHistoricalLineCounts(repo, range.fromCommit, range.toCommit, projectPath);
	const existedBefore = hasFileAtCommit(repo, range.fromCommit, repoPath);
	const existsAfter = hasFileAtCommit(repo, range.toCommit, repoPath);
	if (!existedBefore && !existsAfter) {
		throw new TRPCError({ code: 'BAD_REQUEST', message: 'This file was not found in the selected commits.' });
	}
	const kind = !existedBefore ? 'untracked' : !existsAfter ? 'deleted' : 'modified';
	return {
		path: `/${projectPath}`,
		kind,
		...lineCounts,
		oldContent: existedBefore ? readHistoricalText(repo, range.fromCommit, projectPath) : '',
		newContent: existsAfter ? readHistoricalText(repo, range.toCommit, projectPath) : '',
	};
}

function validateHistoricalCommit(repo: ResolvedContextRepo, commit: string): void {
	if (!COMMIT_PATTERN.test(commit) || !hasCommit(repo.worktreeRoot, commit)) {
		throw new TRPCError({ code: 'BAD_REQUEST', message: 'Invalid historical commit range.' });
	}
}

function hasFileAtCommit(repo: ResolvedContextRepo, commit: string, repoPath: string): boolean {
	return tryRunGit(repo.worktreeRoot, ['cat-file', '-e', `${commit}:${repoPath}`]) !== null;
}

function readHistoricalLineCounts(
	repo: ResolvedContextRepo,
	fromCommit: string,
	toCommit: string,
	projectPath: string,
): ContextLineCounts {
	const output = runGit(repo.worktreeRoot, [
		'diff',
		'--numstat',
		'-z',
		'--no-renames',
		fromCommit,
		toCommit,
		'--',
		toRepoPath(repo, projectPath),
	]);
	for (const record of output.toString().split('\0')) {
		const firstTab = record.indexOf('\t');
		const secondTab = record.indexOf('\t', firstTab + 1);
		if (firstTab < 0 || secondTab < 0 || fromRepoPath(repo, record.slice(secondTab + 1)) !== projectPath) {
			continue;
		}
		return {
			additions: parseLineCount(record.slice(0, firstTab)),
			deletions: parseLineCount(record.slice(firstTab + 1, secondTab)),
		};
	}
	throw new TRPCError({ code: 'BAD_REQUEST', message: 'This file did not change in the selected commit range.' });
}

function readHistoricalText(repo: ResolvedContextRepo, commit: string, projectPath: string): string {
	const content = readFileAtCommit(repo, commit, projectPath, MAX_CONTEXT_FILE_SIZE);
	validateContentBuffer(content);
	return decodeTextContent(content);
}

async function discardPath(repo: ResolvedContextRepo, projectFolder: string, filePath: string): Promise<void> {
	validateWorktreePath(repo, filePath);
	const repoPath = toRepoPath(repo, filePath);
	if (tryRunGit(repo.worktreeRoot, ['ls-files', '--error-unmatch', '--', repoPath]) !== null) {
		runDestructiveWorktreeGit(repo.worktreeRoot, projectFolder, repo.worktreeRoot, [
			'restore',
			'--source=HEAD',
			'--staged',
			'--worktree',
			'--',
			repoPath,
		]);
		return;
	}
	const target = toRealPath(filePath, getWorktreeProjectRoot(repo));
	assertSafeDestructiveWorktreeTarget(repo.worktreeRoot, projectFolder);
	const stat = fs.lstatSync(target);
	if (!stat.isFile() && !stat.isSymbolicLink()) {
		throw new TRPCError({ code: 'FORBIDDEN', message: 'Only individual files can be discarded.' });
	}
	fs.unlinkSync(target);
}

export function readStatus(repo: Pick<ResolvedContextRepo, 'worktreeRoot' | 'projectPrefix'>): Buffer {
	return runGit(repo.worktreeRoot, [
		'status',
		'--porcelain=v1',
		'-z',
		'--untracked-files=all',
		'--',
		repo.projectPrefix || '.',
	]);
}

function readChangedFiles(repo: ResolvedContextRepo): ContextChangedFile[] {
	const files = parseChangedFiles(readStatus(repo), repo);
	const lineCounts = readChangedLineCounts(repo, files);
	return files.map((file) => ({
		...file,
		...(lineCounts.get(file.path) ?? { additions: null, deletions: null }),
	}));
}

function readChangedLineCounts(
	repo: ResolvedContextRepo,
	files: ParsedContextChangedFile[],
): Map<string, ContextLineCounts> {
	const lineCounts = new Map<string, ContextLineCounts>();
	const output = tryRunGit(repo.worktreeRoot, [
		'diff',
		'--numstat',
		'-z',
		'--no-renames',
		'HEAD',
		'--',
		repo.projectPrefix || '.',
	]);
	if (output) {
		addTrackedLineCounts(lineCounts, output, repo);
	}
	for (const file of files) {
		if (file.kind === 'untracked' && !lineCounts.has(file.path)) {
			lineCounts.set(file.path, readUntrackedLineCounts(repo, file.path));
		}
	}
	return lineCounts;
}

function addTrackedLineCounts(
	lineCounts: Map<string, ContextLineCounts>,
	output: Buffer,
	repo: ResolvedContextRepo,
): void {
	for (const record of output.toString().split('\0')) {
		const firstTab = record.indexOf('\t');
		const secondTab = record.indexOf('\t', firstTab + 1);
		if (firstTab < 0 || secondTab < 0) {
			continue;
		}
		const projectPath = fromRepoPath(repo, record.slice(secondTab + 1));
		if (!projectPath) {
			continue;
		}
		lineCounts.set(`/${projectPath}`, {
			additions: parseLineCount(record.slice(0, firstTab)),
			deletions: parseLineCount(record.slice(firstTab + 1, secondTab)),
		});
	}
}

function readUntrackedLineCounts(repo: ResolvedContextRepo, filePath: string): ContextLineCounts {
	try {
		const content = fs.readFileSync(toRealPath(filePath, getWorktreeProjectRoot(repo)));
		if (content.includes(0)) {
			return { additions: null, deletions: null };
		}
		let additions = 0;
		for (const byte of content) {
			if (byte === 10) {
				additions++;
			}
		}
		if (content.length > 0 && content.at(-1) !== 10) {
			additions++;
		}
		return { additions, deletions: 0 };
	} catch {
		return { additions: null, deletions: null };
	}
}

export function parseChangedFiles(output: Buffer, repo: ResolvedContextRepo): ParsedContextChangedFile[] {
	const records = output.toString().split('\0');
	const files = new Map<string, ParsedContextChangedFile>();
	for (let index = 0; index < records.length; index++) {
		const record = records[index];
		if (!record || record.length < 4) {
			continue;
		}
		const status = record.slice(0, 2);
		const repoPath = record.slice(3);
		if (status.includes('R') || status.includes('C')) {
			const source = records[++index];
			addChangedFile(files, repo, repoPath, 'untracked');
			if (status.includes('R') && source) {
				addChangedFile(files, repo, source, 'deleted');
			}
		} else {
			addChangedFile(files, repo, repoPath, statusKind(status));
		}
	}
	return [...files.values()].sort((left, right) => left.path.localeCompare(right.path));
}

function addChangedFile(
	files: Map<string, ParsedContextChangedFile>,
	repo: ResolvedContextRepo,
	repoPath: string,
	kind: ContextChangedFile['kind'],
): void {
	const projectPath = fromRepoPath(repo, repoPath);
	if (projectPath) {
		files.set(`/${projectPath}`, { path: `/${projectPath}`, kind });
	}
}

function statusKind(status: string): ContextChangedFile['kind'] {
	return status === '??' || status.includes('A') ? 'untracked' : status.includes('D') ? 'deleted' : 'modified';
}

function readCommittedText(repo: ResolvedContextRepo, projectPath: string): string {
	const content = readCommittedFile(repo, projectPath, MAX_CONTEXT_FILE_SIZE);
	validateContentBuffer(content);
	return decodeTextContent(content);
}

function readWorkingTreeText(repo: ResolvedContextRepo, filePath: string): string {
	const target = toRealPath(filePath, getWorktreeProjectRoot(repo));
	const content = fs.readFileSync(target);
	validateContentBuffer(content);
	return decodeTextContent(content);
}

export function validateWorktreePath(repo: ResolvedContextRepo, filePath: string): void {
	toRealPath(filePath, getWorktreeProjectRoot(repo));
}

export function assertCleanWorktree(repo: ResolvedContextRepo): void {
	if (!isCleanWorktree(repo)) {
		throw new TRPCError({ code: 'CONFLICT', message: 'Commit or discard changes before switching branches.' });
	}
}

export function isCleanWorktree(repo: Pick<ResolvedContextRepo, 'worktreeRoot' | 'projectPrefix'>): boolean {
	return readStatus(repo).length === 0;
}
