import fs from 'node:fs';

import type { ContextBranchCreationResult, ContextBranchInfo } from '@nao/shared/types';
import { TRPCError } from '@trpc/server';

import type { ResolvedContextRepo } from '../../utils/context-repo';
import { getContextWorktreePath, invalidateContextProjectPrefix, toRepoPath } from '../../utils/context-repo';
import type { GitIdentity } from '../../utils/git-identity';
import { withCoAuthors } from '../../utils/git-identity';
import { runGit, tryRunGit } from '../../utils/git-repo';
import type { OpenReviewRequestResult } from '../review-request-provider';
import { REVIEW_REQUEST_PROVIDERS } from '../review-request-provider';
import {
	assertCleanWorktree,
	isCleanWorktree,
	parseChangedFiles,
	readStatus,
	validateWorktreePath,
} from './changes.service';
import {
	assertSafeDestructiveWorktreeTarget,
	hasRef,
	isDirtySwitchConflict,
	normalizeVirtualPath,
	readCurrentBranch,
	readDefaultBranch,
	readDefaultBranchFromRefs,
	readDefaultBranchRef,
	readOptionalGitValue,
	runDestructiveWorktreeGit,
	runWorktreeGitMutation,
	sanitizeGitError,
	validateBranch,
} from './git-guards';
import type {
	ContextExplorerGitContext,
	ContextRepositoryProvider,
	CreateBranchAndCommitInput,
	CreateBranchAndCommitResult,
	OwnedContextBranchDeletionInput,
	OwnedContextBranchDeletionResult,
} from './types';
import { fetchContextRepository, requireContextExplorerGit, resolveAfterBranchChange } from './worktree.service';

export async function getContextBranches(
	repo: ResolvedContextRepo,
	context: Pick<ContextExplorerGitContext, 'projectId' | 'userId'>,
): Promise<ContextBranchInfo> {
	const defaultBranch = readDefaultBranch(repo);
	const currentBranch = readContextCurrentBranch(repo, defaultBranch);
	const branchOwnershipQueries = await getBranchOwnershipQueries();
	const ownedBranches = await branchOwnershipQueries.getOwnedContextBranches(context.projectId, context.userId);
	const branches = new Set([...readContextBranchNames(repo)].filter((branch) => ownedBranches.has(branch)));
	branches.add(defaultBranch);
	return {
		currentBranch,
		defaultBranch,
		aheadCommitCount: readAheadCommitCount(repo, currentBranch, defaultBranch),
		unpushedCommitCount: readUnpushedCommitCount(repo, currentBranch, defaultBranch),
		branches: [...branches].sort(),
		suggestedBranch: generateContextBranchName(repo),
	};
}

export async function switchContextBranch(
	context: ContextExplorerGitContext,
	branch: string,
): Promise<ContextBranchInfo> {
	validateBranch(branch);
	const { repo, context: availableContext } = await requireContextExplorerGit(context);
	const provider = availableContext.providerOverride ?? REVIEW_REQUEST_PROVIDERS[repo.provider];
	assertCleanWorktree(repo);
	const defaultBranch = readDefaultBranch(repo);
	try {
		if (branch === defaultBranch) {
			const defaultRef = readDefaultBranchRef(repo, defaultBranch);
			if (!defaultRef) {
				throw new TRPCError({ code: 'NOT_FOUND', message: `Branch not found: ${branch}` });
			}
			runDestructiveWorktreeGit(repo.worktreeRoot, context.projectFolder, repo.worktreeRoot, [
				'switch',
				'--detach',
				defaultRef,
			]);
		} else if (!(await isContextBranchOwnedByUser(context, branch))) {
			throw new TRPCError({ code: 'FORBIDDEN', message: 'This branch belongs to another user.' });
		} else if (hasRef(repo, `refs/heads/${branch}`)) {
			runDestructiveWorktreeGit(repo.worktreeRoot, context.projectFolder, repo.worktreeRoot, ['switch', branch]);
		} else if (hasRef(repo, `refs/remotes/origin/${branch}`)) {
			runDestructiveWorktreeGit(repo.worktreeRoot, context.projectFolder, repo.worktreeRoot, [
				'switch',
				'--track',
				'-c',
				branch,
				`origin/${branch}`,
			]);
		} else {
			throw new TRPCError({ code: 'NOT_FOUND', message: `Branch not found: ${branch}` });
		}
	} catch (error) {
		if (isDirtySwitchConflict(error)) {
			throw new TRPCError({ code: 'CONFLICT', message: 'Commit or discard changes before switching branches.' });
		}
		throw error;
	}
	invalidateContextProjectPrefix(repo.worktreeRoot);
	return getContextBranches(resolveAfterBranchChange(repo, context.projectFolder, provider), context);
}

export async function createContextBranch(
	context: ContextExplorerGitContext,
	branch: string,
): Promise<ContextBranchCreationResult> {
	validateBranch(branch);
	const { repo, context: availableContext } = await requireContextExplorerGit(context);
	const provider = availableContext.providerOverride ?? REVIEW_REQUEST_PROVIDERS[repo.provider];
	fetchContextRepository(repo, context.projectFolder, provider, availableContext.token);
	assertBranchAvailable(repo, branch);
	const { usedFallbackBase } = await createOwnedContextBranch(context, repo, branch);
	invalidateContextProjectPrefix(repo.worktreeRoot);
	const branches = await getContextBranches(resolveAfterBranchChange(repo, context.projectFolder, provider), context);
	return { ...branches, usedFallbackBase };
}

export async function createContextBranchAndCommit(
	context: ContextExplorerGitContext,
	input: CreateBranchAndCommitInput,
): Promise<CreateBranchAndCommitResult> {
	const { repo, context: availableContext } = await requireContextExplorerGit(context);
	const provider = availableContext.providerOverride ?? REVIEW_REQUEST_PROVIDERS[repo.provider];
	fetchContextRepository(repo, context.projectFolder, provider, availableContext.token);
	const branch = input.branch ?? generateContextBranchName(repo);
	validateBranch(branch);
	assertBranchAvailable(repo, branch);
	const { baseUsed, usedFallbackBase } = await createOwnedContextBranch(context, repo, branch);
	invalidateContextProjectPrefix(repo.worktreeRoot);
	const resolvedRepo = resolveAfterBranchChange(repo, context.projectFolder, provider);
	const commit = await commitSelectedChanges(resolvedRepo, context.projectFolder, availableContext, input);
	return { branch, commit, baseUsed, usedFallbackBase };
}

export async function commitContextChanges(
	context: ContextExplorerGitContext,
	input: { paths: string[]; message: string },
): Promise<{ commit: string }> {
	const { repo, context: availableContext } = await requireContextExplorerGit(context);
	const commit = await commitSelectedChanges(repo, context.projectFolder, availableContext, input);
	return { commit };
}

export function pushContextBranch(
	repo: ResolvedContextRepo,
	projectFolder: string,
	provider: ContextRepositoryProvider,
	token: string,
): { branch: string; defaultBranch: string; pushOutput: string } {
	const branch = readCurrentBranch(repo);
	const defaultBranch = readDefaultBranch(repo);
	if (!branch || branch === defaultBranch) {
		throw new TRPCError({ code: 'BAD_REQUEST', message: 'Open pull requests from a non-default branch.' });
	}
	assertSafeDestructiveWorktreeTarget(repo.worktreeRoot, projectFolder);
	try {
		const pushOutput = provider.pushBranch({
			token,
			repoFullName: repo.repoFullName,
			dir: repo.worktreeRoot,
			branch,
		});
		runDestructiveWorktreeGit(repo.worktreeRoot, projectFolder, repo.worktreeRoot, [
			'update-ref',
			`refs/remotes/origin/${branch}`,
			'HEAD',
		]);
		return { branch, defaultBranch, pushOutput };
	} catch (error) {
		throw sanitizeGitError(error, token);
	}
}

export function getContextBranchCommitMessages(repo: ResolvedContextRepo): string[] {
	const currentBranch = readCurrentBranch(repo);
	const defaultBranch = readDefaultBranch(repo);
	if (!currentBranch || currentBranch === defaultBranch) {
		return [];
	}
	const base = readDefaultBranchRef(repo, defaultBranch);
	if (!base) {
		return [];
	}
	return runGit(repo.worktreeRoot, ['log', '--reverse', '--format=%s', `${base}..HEAD`])
		.toString()
		.split('\n')
		.map((message) => message.trim())
		.filter(Boolean);
}

export function generateContextBranchName(repo: ResolvedContextRepo, timestamp = Date.now()): string {
	const branches = readContextBranchNames(repo);
	const base = `nao/context-edits-${timestamp.toString(36)}`;
	let candidate = base;
	let suffix = 2;
	while (branches.has(candidate)) {
		candidate = `${base}-${suffix++}`;
	}
	return candidate;
}

export async function suggestContextBranchName(context: ContextExplorerGitContext): Promise<string> {
	const { repo } = await requireContextExplorerGit(context);
	return generateContextBranchName(repo);
}

export function deleteOwnedContextBranch(input: OwnedContextBranchDeletionInput): OwnedContextBranchDeletionResult {
	const worktreeRoot = getContextWorktreePath(input.projectId, input.projectFolder, input.userId);
	if (!fs.existsSync(worktreeRoot)) {
		return { status: 'deleted', reason: 'worktree-missing' };
	}
	const repo = { worktreeRoot, projectPrefix: '' };
	try {
		if (!isCleanWorktree(repo)) {
			return { status: 'skipped', reason: 'dirty-worktree' };
		}
		if (!hasRef(repo, `refs/heads/${input.branch}`)) {
			return { status: 'deleted', reason: 'branch-missing' };
		}
		const defaultBranch = readDefaultBranchFromRefs(worktreeRoot);
		const remoteBranchRef = `refs/remotes/origin/${input.branch}`;
		const comparisonRef = hasRef(repo, remoteBranchRef)
			? `origin/${input.branch}`
			: defaultBranch
				? readDefaultBranchRef(repo, defaultBranch)
				: null;
		if (!comparisonRef) {
			return { status: 'skipped', reason: 'default-ref-unavailable' };
		}
		const unpublishedCommitCount = readVerifiedCommitCount(repo, `${comparisonRef}..${input.branch}`);
		if (unpublishedCommitCount === null) {
			return { status: 'skipped', reason: 'commit-check-failed' };
		}
		if (unpublishedCommitCount > 0) {
			return { status: 'skipped', reason: 'unpublished-commits' };
		}
		if (readCurrentBranch(repo) === input.branch) {
			const defaultRef = defaultBranch ? readDefaultBranchRef(repo, defaultBranch) : null;
			if (!defaultRef) {
				return { status: 'skipped', reason: 'default-ref-unavailable' };
			}
			runDestructiveWorktreeGit(worktreeRoot, input.projectFolder, worktreeRoot, [
				'switch',
				'--detach',
				defaultRef,
			]);
		}
		runDestructiveWorktreeGit(worktreeRoot, input.projectFolder, worktreeRoot, [
			'branch',
			'-D',
			'--',
			input.branch,
		]);
		return { status: 'deleted', reason: 'branch-deleted' };
	} catch (error) {
		throw sanitizeGitError(error, input.token);
	}
}

async function commitSelectedChanges(
	repo: ResolvedContextRepo,
	projectFolder: string,
	context: ContextExplorerGitContext & { token: string },
	input: { paths: string[]; message: string },
): Promise<string> {
	await assertCommitBranch(repo, context);
	const changedPaths = new Set(parseChangedFiles(readStatus(repo), repo).map((file) => file.path));
	const paths = [...new Set(input.paths.map(normalizeVirtualPath))];
	if (paths.length === 0 || paths.some((filePath) => !changedPaths.has(filePath))) {
		throw new TRPCError({ code: 'BAD_REQUEST', message: 'Select one or more changed context files to commit.' });
	}
	const repoPaths = paths.map((filePath) => {
		validateWorktreePath(repo, filePath);
		return toRepoPath(repo, filePath);
	});
	const provider = context.providerOverride ?? REVIEW_REQUEST_PROVIDERS[repo.provider];
	const author = await provider.getUserGitIdentity({ token: context.token, user: context.user });
	runWorktreeGitMutation(repo.worktreeRoot, projectFolder, repo.worktreeRoot, ['add', '--', ...repoPaths]);
	if (tryRunGit(repo.worktreeRoot, ['diff', '--cached', '--quiet'])) {
		throw new TRPCError({ code: 'BAD_REQUEST', message: 'The selected files have no changes to commit.' });
	}
	runGitWithIdentity(
		repo,
		projectFolder,
		['commit', '--quiet', '-m', withCoAuthors(input.message, [provider.coAuthor])],
		author,
	);
	return runGit(repo.worktreeRoot, ['rev-parse', 'HEAD']).toString().trim();
}

async function assertCommitBranch(
	repo: ResolvedContextRepo,
	context: Pick<ContextExplorerGitContext, 'projectId' | 'userId'>,
): Promise<void> {
	const branch = readCurrentBranch(repo);
	const defaultBranch = readDefaultBranch(repo);
	if (!branch || branch === defaultBranch || !(await isContextBranchOwnedByUser(context, branch))) {
		throw new TRPCError({
			code: 'BAD_REQUEST',
			message: 'Create a branch before committing context changes.',
		});
	}
}

function readContextBranchNames(repo: ResolvedContextRepo): Set<string> {
	const output = runGit(repo.worktreeRoot, [
		'for-each-ref',
		'--exclude=refs/remotes/origin/HEAD',
		'--format=%(refname:short)',
		'refs/heads',
		'refs/remotes/origin',
	]);
	return new Set(
		output
			.toString()
			.split('\n')
			.map((ref) => ref.trim().replace(/^origin\//, ''))
			.filter((ref) => ref && ref !== 'HEAD'),
	);
}

function assertBranchAvailable(repo: ResolvedContextRepo, branch: string): void {
	if (readContextBranchNames(repo).has(branch)) {
		throw new TRPCError({ code: 'CONFLICT', message: `Branch already exists: ${branch}` });
	}
}

function readContextCurrentBranch(repo: ResolvedContextRepo, defaultBranch: string): string | null {
	const currentBranch = readCurrentBranch(repo);
	if (currentBranch) {
		return currentBranch;
	}
	const defaultRef = readDefaultBranchRef(repo, defaultBranch);
	const head = readOptionalGitValue(repo.worktreeRoot, ['rev-parse', 'HEAD']);
	const defaultHead = defaultRef ? readOptionalGitValue(repo.worktreeRoot, ['rev-parse', defaultRef]) : null;
	return head && head === defaultHead ? defaultBranch : null;
}

function readAheadCommitCount(repo: ResolvedContextRepo, currentBranch: string | null, defaultBranch: string): number {
	if (!currentBranch || currentBranch === defaultBranch) {
		return 0;
	}
	const base = readDefaultBranchRef(repo, defaultBranch);
	if (!base) {
		return 0;
	}
	return readCommitCount(repo, `${base}..HEAD`);
}

function readUnpushedCommitCount(
	repo: ResolvedContextRepo,
	currentBranch: string | null,
	defaultBranch: string,
): number {
	if (!currentBranch || currentBranch === defaultBranch) {
		return 0;
	}
	const remoteBranchRef = `refs/remotes/origin/${currentBranch}`;
	const base = hasRef(repo, remoteBranchRef) ? `origin/${currentBranch}` : readDefaultBranchRef(repo, defaultBranch);
	return base ? readCommitCount(repo, `${base}..HEAD`) : 0;
}

function readCommitCount(repo: ResolvedContextRepo, range: string): number {
	const count = Number(readOptionalGitValue(repo.worktreeRoot, ['rev-list', '--count', range]));
	return Number.isSafeInteger(count) && count >= 0 ? count : 0;
}

function readVerifiedCommitCount(repo: Pick<ResolvedContextRepo, 'worktreeRoot'>, range: string): number | null {
	const value = readOptionalGitValue(repo.worktreeRoot, ['rev-list', '--count', range]);
	if (!value || !/^\d+$/.test(value)) {
		return null;
	}
	const count = Number(value);
	return Number.isSafeInteger(count) ? count : null;
}

export async function findOpenContextReviewRequest(
	provider: ContextRepositoryProvider,
	token: string,
	repoFullName: string,
	currentBranch: string | null,
	defaultBranch: string,
	projectId: string,
	userId: string,
): Promise<OpenReviewRequestResult | null> {
	if (!currentBranch || currentBranch === defaultBranch) {
		return null;
	}
	try {
		return await provider.findOpenReviewRequest({
			token,
			repoFullName,
			branch: currentBranch,
			projectId,
			userId,
		});
	} catch {
		return null;
	}
}

function runGitWithIdentity(
	repo: ResolvedContextRepo,
	projectFolder: string,
	args: string[],
	identity: GitIdentity,
): Buffer {
	return runDestructiveWorktreeGit(repo.worktreeRoot, projectFolder, repo.worktreeRoot, args, identity);
}

async function createOwnedContextBranch(
	context: ContextExplorerGitContext,
	repo: ResolvedContextRepo,
	branch: string,
): Promise<{ baseUsed: string; usedFallbackBase: boolean }> {
	await claimBranchOwnership(context, branch);
	try {
		const currentHead = runGit(repo.worktreeRoot, ['rev-parse', 'HEAD']).toString().trim();
		let baseUsed = `origin/${readDefaultBranch(repo)}`;
		let usedFallbackBase = false;
		try {
			runDestructiveWorktreeGit(repo.worktreeRoot, context.projectFolder, repo.worktreeRoot, [
				'switch',
				'-c',
				branch,
				baseUsed,
			]);
		} catch (error) {
			if (hasRef(repo, `refs/heads/${branch}`) || !isDirtySwitchConflict(error)) {
				throw error;
			}
			baseUsed = currentHead;
			usedFallbackBase = true;
			runDestructiveWorktreeGit(repo.worktreeRoot, context.projectFolder, repo.worktreeRoot, [
				'switch',
				'-c',
				branch,
				currentHead,
			]);
		}
		return { baseUsed, usedFallbackBase };
	} catch (error) {
		const branchOwnershipQueries = await getBranchOwnershipQueries();
		await branchOwnershipQueries.releaseContextBranch(context.projectId, branch, context.userId);
		if (isDirtySwitchConflict(error)) {
			throw new TRPCError({
				code: 'CONFLICT',
				message: 'This branch cannot be created without overwriting your uncommitted changes.',
			});
		}
		throw error;
	}
}

async function claimBranchOwnership(
	context: Pick<ContextExplorerGitContext, 'projectId' | 'userId'>,
	branch: string,
): Promise<void> {
	const branchOwnershipQueries = await getBranchOwnershipQueries();
	const claimed = await branchOwnershipQueries.claimContextBranch(context.projectId, branch, context.userId);
	if (!claimed) {
		throw new TRPCError({ code: 'CONFLICT', message: `Branch already belongs to another user: ${branch}` });
	}
}

async function getBranchOwnershipQueries() {
	return import('../../queries/context-branch-ownership.queries');
}

async function isContextBranchOwnedByUser(
	context: Pick<ContextExplorerGitContext, 'projectId' | 'userId'>,
	branch: string,
): Promise<boolean> {
	const branchOwnershipQueries = await getBranchOwnershipQueries();
	return branchOwnershipQueries.isContextBranchOwnedByUser(context.projectId, branch, context.userId);
}
