import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { CONTEXT_CONFIG_FILENAME } from '@nao/shared';

import type { DBContextRecommendation } from '../db/abstractSchema';
import * as crQueries from '../queries/context-recommendation.queries';
import * as projectQueries from '../queries/project.queries';
import * as userQueries from '../queries/user.queries';
import { ProposedEdit, ProposedEditTargetRepo } from '../types/context-recommendation';
import { resolveContextRepository } from '../utils/context-repo';
import { logger } from '../utils/logger';
import { isHumanWritableContextPath } from '../utils/nao-context-paths';
import {
	assertNoSymlinkInWritePath,
	canonicalizeWriteRoot,
	resolveWritePath,
	writeFileAtomically,
} from '../utils/safe-file-write';
import {
	checkoutNewBranch,
	commitAll,
	getRepoSubPath,
	shallowestSubPath,
	SUBPATH_SCAN_IGNORED_DIRS,
	SUBPATH_SCAN_MAX_DEPTH,
} from './git-repo';
import * as github from './github';
import * as gitlab from './gitlab';
import type { InternalRepoProvider, ReviewRequestProvider } from './review-request-provider';
import { REVIEW_REQUEST_PROVIDERS } from './review-request-provider';

export { REVIEW_REQUEST_PROVIDERS };
export type { ReviewRequestProvider };

/** Raised when the request itself is invalid (bad selection, no changes, conflicting targets). */
export class ContextPullRequestInputError extends Error {}

/** Raised when the Git provider account is not connected, so the caller must authenticate. */
export class ProviderNotConnectedError extends Error {}

export interface CreatePullRequestResult {
	url: string;
	branch: string;
}

export interface ReviewRequestEdit {
	path: string;
	newContent: string;
}

export interface RecommendationRepo {
	repoFullName: string;
	branch: string | null;
	source: 'settings' | 'deployment' | 'linked';
	provider: InternalRepoProvider;
	webUrl: string;
	subPath: string;
}

function buildRepoWebUrl(provider: InternalRepoProvider, repoFullName: string): string {
	const base = provider === 'gitlab' ? gitlab.gitlabBaseUrl() : 'https://github.com';
	return `${base}/${repoFullName}`;
}

/**
 * Resolves the Git repository used for context pull/merge requests. Only the repository
 * configured on the recommendations settings page (or via deployment env) is used; the
 * project's own folder remote is never treated as the context repository.
 */
export async function resolveRecommendationRepo(
	projectId: string,
	userId?: string,
): Promise<RecommendationRepo | null> {
	const connection = await resolveContextRepository(projectId);
	if (!connection) {
		return null;
	}
	const subPath = await resolveConfiguredRepoSubPath(projectId, connection.provider, connection.repoFullName, userId);
	return { ...connection, subPath };
}

/** Prefers the sub-path from the local project checkout, then remote detection when a user is known. */
async function resolveConfiguredRepoSubPath(
	projectId: string,
	provider: InternalRepoProvider,
	repoFullName: string,
	userId?: string,
): Promise<string> {
	const project = await projectQueries.getProjectById(projectId);
	if (project?.path) {
		return getRepoSubPath(project.path);
	}
	if (userId) {
		return detectConfiguredRepoSubPath(provider, repoFullName, userId);
	}
	return '';
}

async function detectConfiguredRepoSubPath(
	provider: InternalRepoProvider,
	repoFullName: string,
	userId: string,
): Promise<string> {
	if (provider !== 'github' && provider !== 'gitlab') {
		return '';
	}
	const token = await REVIEW_REQUEST_PROVIDERS[provider].getToken(userId);
	if (!token) {
		return '';
	}
	return provider === 'gitlab'
		? gitlab.findContextConfigSubPath(token, repoFullName)
		: github.findContextConfigSubPath(token, repoFullName);
}

/**
 * YOLO mode: opens pull requests for the highest-impact open recommendations without
 * human review and marks each one applied. Failures are logged and skipped so a single
 * bad recommendation never blocks the rest; only successful PRs count toward the cap.
 */
export async function autoCreateRecommendationPullRequests(
	projectId: string,
	userId: string,
	maxPullRequests: number,
): Promise<number> {
	const open = await crQueries.listRecommendations(projectId, 'open');
	const contextRepo = await resolveRecommendationRepo(projectId);
	const candidates = open.filter(
		(rec) =>
			rec.fixKind === 'patch' &&
			(rec.proposedEdits?.length ?? 0) > 0 &&
			!rec.prUrl &&
			canOpenPullRequest(rec.proposedEdits ?? [], contextRepo),
	);

	let created = 0;
	for (const rec of candidates) {
		if (created >= maxPullRequests) {
			break;
		}
		try {
			const pr = await createRecommendationPullRequest(projectId, rec.id, userId);
			await crQueries.setRecommendationStatus({ id: rec.id, projectId, status: 'applied', userId });
			created++;
			logger.info(`Auto-created context PR ${pr.url} for recommendation ${rec.id}`, { source: 'agent' });
		} catch (err) {
			logger.warn(`Auto PR creation failed for recommendation ${rec.id}: ${String(err)}`, {
				source: 'agent',
			});
		}
	}
	return created;
}

/**
 * Opens a pull request for a recommendation's proposed edits.
 *
 * Works against a fresh, disposable clone so the live project at `project.path` is
 * never mutated: clone → branch → write the proposed file contents → commit → push →
 * create or link to a review request. Only human-written files are ever written.
 */
export async function createRecommendationPullRequest(
	projectId: string,
	recommendationId: string,
	userId: string,
): Promise<CreatePullRequestResult> {
	const rec = await crQueries.getRecommendationById(projectId, recommendationId);
	if (!rec) {
		throw new ContextPullRequestInputError('Recommendation not found.');
	}
	if (rec.fixKind !== 'patch' || !rec.proposedEdits || rec.proposedEdits.length === 0) {
		throw new ContextPullRequestInputError(
			'This recommendation has no automated changes to open as a pull request.',
		);
	}
	if (rec.prUrl) {
		return { url: rec.prUrl, branch: rec.prBranch ?? '' };
	}

	const repo = await resolvePullRequestRepo(projectId, rec.proposedEdits);
	if (!repo) {
		throw new ContextPullRequestInputError('No context repository is connected. Connect one in Settings → Git.');
	}

	const edits = filterPullRequestEdits(rec.proposedEdits);
	if (edits.length === 0) {
		throw new ContextPullRequestInputError(
			'The proposed changes only touch auto-generated files and cannot be opened as a pull request.',
		);
	}

	const repoFullName = repo.repoFullName;
	const branch = `nao/context-${recommendationId.slice(0, 8)}-${Date.now().toString(36)}`;
	const workdir = fs.mkdtempSync(path.join(os.tmpdir(), 'nao-context-pr-'));

	try {
		const { url } = await createReviewRequest({
			provider: REVIEW_REQUEST_PROVIDERS[repo.provider],
			userId,
			repoFullName,
			workdir,
			branch,
			configuredBase: repo.branch,
			edits: toReviewRequestEdits(edits),
			title: prTitle(rec),
			commitMessage: commitMessage(rec),
			body: prBody(rec, edits, repo.subPath),
			subPath: repo.subPath,
		});

		const prCreatedAt = new Date();
		await crQueries.setRecommendationPr(rec.id, { prUrl: url, prBranch: branch, prCreatedAt });
		return { url, branch };
	} finally {
		try {
			fs.rmSync(workdir, { recursive: true, force: true });
		} catch (err) {
			logger.error(`Failed to clean up PR workdir ${workdir}: ${String(err)}`, { source: 'agent' });
		}
	}
}

/** Opens a single pull request that batches multiple recommendations, one commit each. */
export async function createBatchRecommendationPullRequest(
	projectId: string,
	recommendationIds: string[],
	userId: string,
): Promise<CreatePullRequestResult> {
	const allRecs = await Promise.all(recommendationIds.map((id) => crQueries.getRecommendationById(projectId, id)));
	const recs = allRecs.filter(
		(rec): rec is DBContextRecommendation =>
			rec !== null && rec.fixKind === 'patch' && (rec.proposedEdits?.length ?? 0) > 0 && !rec.prUrl,
	);

	if (recs.length === 0) {
		throw new ContextPullRequestInputError(
			'No eligible recommendations to batch. Each must have drafted changes and no existing PR.',
		);
	}

	const repoByKey = new Map<string, RecommendationRepo>();
	for (const rec of recs) {
		const repo = await resolvePullRequestRepo(projectId, rec.proposedEdits!);
		if (!repo) {
			throw new ContextPullRequestInputError(
				'No context repository is connected. Connect one in Settings → Git.',
			);
		}
		repoByKey.set(`${repo.provider}:${repo.repoFullName}@${repo.branch ?? ''}`, repo);
	}

	if (repoByKey.size > 1) {
		throw new ContextPullRequestInputError(
			'All batched recommendations must target the same repository and branch.',
		);
	}

	const [repo] = repoByKey.values();
	const branch = `nao/context-batch-${Date.now().toString(36)}`;
	const workdir = fs.mkdtempSync(path.join(os.tmpdir(), 'nao-context-pr-'));

	try {
		const { url, committedRecIds } = await createBatchReviewRequest({
			provider: REVIEW_REQUEST_PROVIDERS[repo.provider],
			userId,
			repoFullName: repo.repoFullName,
			workdir,
			branch,
			configuredBase: repo.branch,
			subPath: repo.subPath,
			recs,
		});

		const prCreatedAt = new Date();
		await Promise.all(
			committedRecIds.map((id) =>
				crQueries.setRecommendationPr(id, { prUrl: url, prBranch: branch, prCreatedAt }),
			),
		);
		return { url, branch };
	} finally {
		try {
			fs.rmSync(workdir, { recursive: true, force: true });
		} catch (err) {
			logger.error(`Failed to clean up batch PR workdir ${workdir}: ${String(err)}`, { source: 'agent' });
		}
	}
}

/**
 * Clones the repo, applies the edits as a commit on a new branch, pushes it, and opens the
 * review request. Identical across providers except for the token lookup and how the review
 * request itself is created — both captured by `provider`.
 */
export async function createReviewRequest(args: {
	provider: ReviewRequestProvider;
	userId: string;
	repoFullName: string;
	workdir: string;
	branch: string;
	configuredBase: string | null;
	edits: ReviewRequestEdit[];
	title: string;
	commitMessage: string;
	body: string;
	subPath?: string;
}): Promise<{ url: string }> {
	const { provider, userId, repoFullName, workdir, branch, configuredBase, edits, title, commitMessage, body } = args;

	const [token, user] = await Promise.all([provider.getToken(userId), userQueries.getUser({ id: userId })]);
	if (token === null) {
		throw new ProviderNotConnectedError(provider.notConnectedMessage);
	}
	if (!user) {
		throw new Error('User not found.');
	}

	provider.cloneRepo(token, repoFullName, workdir, configuredBase ?? undefined);
	const base = configuredBase ?? provider.getGitInfo(workdir).branch ?? 'main';
	const effectiveSubPath = resolveEffectiveSubPath(workdir, args.subPath);

	applyEdits(workdir, edits, effectiveSubPath);

	const author = await provider.getUserGitIdentity({
		token,
		user: { name: user.name, email: user.email },
	});
	const pushOutput = provider.commitAllAndPushBranch({
		token,
		repoFullName,
		dir: workdir,
		branch,
		message: commitMessage,
		author,
		coAuthors: [provider.coAuthor],
	});

	const reviewRequest = await provider.openReviewRequest(token, repoFullName, {
		title,
		head: branch,
		base,
		body,
		requester: { name: user.name, email: user.email },
		pushOutput,
	});
	if (!reviewRequest) {
		throw new Error(`Branch ${branch} was pushed successfully, but no pull request link was returned.`);
	}
	return { url: reviewRequest.url };
}

/**
 * Clones the repo once, then creates one commit per recommendation, pushes a single branch,
 * and opens one review request that covers all committed recommendations.
 */
async function createBatchReviewRequest(args: {
	provider: ReviewRequestProvider;
	userId: string;
	repoFullName: string;
	workdir: string;
	branch: string;
	configuredBase: string | null;
	subPath: string;
	recs: DBContextRecommendation[];
}): Promise<{ url: string; committedRecIds: string[] }> {
	const { provider, userId, repoFullName, workdir, branch, configuredBase, subPath, recs } = args;

	const [token, user] = await Promise.all([provider.getToken(userId), userQueries.getUser({ id: userId })]);
	if (token === null) {
		throw new ProviderNotConnectedError(provider.notConnectedMessage);
	}
	if (!user) {
		throw new Error('User not found.');
	}

	provider.cloneRepo(token, repoFullName, workdir, configuredBase ?? undefined);
	const base = configuredBase ?? provider.getGitInfo(workdir).branch ?? 'main';
	const author = await provider.getUserGitIdentity({
		token,
		user: { name: user.name, email: user.email },
	});
	const effectiveSubPath = resolveEffectiveSubPath(workdir, subPath);

	checkoutNewBranch(workdir, branch);

	const committedRecIds: string[] = [];
	for (const rec of recs) {
		const edits = toReviewRequestEdits(filterPullRequestEdits(rec.proposedEdits ?? []));
		if (edits.length === 0) {
			continue;
		}
		applyEdits(workdir, edits, effectiveSubPath);
		const committed = commitAll(workdir, {
			message: commitMessage(rec),
			author,
			coAuthors: [provider.coAuthor],
		});
		if (committed) {
			committedRecIds.push(rec.id);
		}
	}

	if (committedRecIds.length === 0) {
		throw new ContextPullRequestInputError(
			'No file changes remain after filtering. All proposed edits target auto-generated files.',
		);
	}

	const pushOutput = provider.pushBranch({ token, repoFullName, dir: workdir, branch });

	const committedRecs = recs.filter((rec) => committedRecIds.includes(rec.id));
	const reviewRequest = await provider.openReviewRequest(token, repoFullName, {
		title: batchPrTitle(committedRecs),
		head: branch,
		base,
		body: batchPrBody(committedRecs, effectiveSubPath),
		requester: { name: user.name, email: user.email },
		pushOutput,
	});
	if (!reviewRequest) {
		throw new Error(`Branch ${branch} was pushed successfully, but no pull request link was returned.`);
	}
	return { url: reviewRequest.url, committedRecIds };
}

/**
 * Edits without a linked-repo target are written to the context repository, so they can
 * only become a pull request when one is connected. Skipping the others up front avoids
 * a guaranteed failure (and a misleading warning) per context-only recommendation.
 */
function canOpenPullRequest(edits: ProposedEdit[], contextRepo: RecommendationRepo | null): boolean {
	const needsContextRepo = edits.some((edit) => !edit.targetRepo);
	return !needsContextRepo || contextRepo !== null;
}

function resolvePullRequestRepo(projectId: string, edits: ProposedEdit[]): Promise<RecommendationRepo | null> {
	const targetRepos = new Map<string, ProposedEditTargetRepo>();
	for (const edit of edits) {
		if (edit.targetRepo) {
			targetRepos.set(edit.targetRepo.repoFullName, edit.targetRepo);
		}
	}

	if (targetRepos.size === 0) {
		return resolveRecommendationRepo(projectId);
	}
	if (targetRepos.size > 1) {
		throw new ContextPullRequestInputError(
			'A recommendation cannot open one pull request across multiple repositories.',
		);
	}
	if (edits.some((edit) => !edit.targetRepo)) {
		throw new ContextPullRequestInputError(
			'A recommendation cannot mix context repository edits with linked repository edits.',
		);
	}

	const [target] = targetRepos.values();
	return Promise.resolve({
		repoFullName: target.repoFullName,
		branch: target.branch,
		source: 'linked',
		provider: target.provider,
		webUrl: buildRepoWebUrl(target.provider, target.repoFullName),
		subPath: '',
	});
}

function filterPullRequestEdits(edits: ProposedEdit[]): ProposedEdit[] {
	return edits.filter((edit) => {
		if (edit.targetRepo) {
			return true;
		}
		return isHumanWritableContextPath(edit.path);
	});
}

function toReviewRequestEdits(edits: ProposedEdit[]): ReviewRequestEdit[] {
	return edits.map((edit) => ({
		path: edit.targetRepo?.path ?? edit.path,
		newContent: edit.newContent,
	}));
}

function applyEdits(dir: string, edits: ReviewRequestEdit[], subPath: string): void {
	assertValidSubPath(subPath);
	const root = canonicalizeWriteRoot(dir);
	for (const edit of edits) {
		const editPath = subPath ? path.posix.join(subPath, edit.path) : edit.path;
		const target = resolveWritePath(root, editPath);
		assertNoSymlinkInWritePath(root, target, editPath);
		fs.mkdirSync(path.dirname(target), { recursive: true });
		writeFileAtomically({ content: edit.newContent, displayPath: editPath, root, target });
	}
}

/** Prefers the sub-path known from the project's local git checkout, but only when the cloned context repo actually holds `nao_config.yaml` there. */
function resolveEffectiveSubPath(repoDir: string, knownSubPath: string | undefined): string {
	if (knownSubPath && cloneHasContextConfig(repoDir, knownSubPath)) {
		return knownSubPath;
	}
	return detectContextSubPath(repoDir);
}

function cloneHasContextConfig(repoDir: string, subPath: string): boolean {
	try {
		return fs.statSync(path.join(repoDir, subPath, CONTEXT_CONFIG_FILENAME)).isFile();
	} catch {
		return false;
	}
}

/** Returns the directory holding `nao_config.yaml` relative to the repo root ('' when at root). */
function detectContextSubPath(repoDir: string): string {
	const matches: string[] = [];

	const walk = (dir: string, depth: number): void => {
		if (depth > SUBPATH_SCAN_MAX_DEPTH) {
			return;
		}
		let entries: fs.Dirent[];
		try {
			entries = fs.readdirSync(dir, { withFileTypes: true });
		} catch {
			return;
		}
		for (const entry of entries) {
			if (entry.isFile() && entry.name === CONTEXT_CONFIG_FILENAME) {
				matches.push(path.relative(repoDir, dir).split(path.sep).join('/'));
			}
		}
		for (const entry of entries) {
			if (entry.isDirectory() && !entry.isSymbolicLink() && !SUBPATH_SCAN_IGNORED_DIRS.has(entry.name)) {
				walk(path.join(dir, entry.name), depth + 1);
			}
		}
	};

	walk(repoDir, 0);

	const shallowest = shallowestSubPath(matches);
	if (matches.length > 1) {
		logger.warn(
			`Multiple ${CONTEXT_CONFIG_FILENAME} files found in context repository; using "${shallowest || '<root>'}".`,
			{ source: 'agent' },
		);
	}
	return shallowest;
}

function assertValidSubPath(subPath: string): void {
	if (!subPath) {
		return;
	}
	if (path.isAbsolute(subPath)) {
		throw new Error('Invalid monorepo sub-path: absolute paths are not allowed.');
	}
	if (path.normalize(subPath).startsWith('..')) {
		throw new Error('Invalid monorepo sub-path: path traversal is not allowed.');
	}
}

function prTitle(rec: DBContextRecommendation): string {
	return `nao context: ${rec.title}`;
}

function batchPrTitle(recs: DBContextRecommendation[]): string {
	return `nao context: ${recs.length} recommendations`;
}

function commitMessage(rec: DBContextRecommendation): string {
	return `${prTitle(rec)}\n\n${rec.summary}`;
}

function prBody(rec: DBContextRecommendation, edits: ProposedEdit[], subPath: string): string {
	const files = edits
		.map((edit) => {
			if (edit.targetRepo) {
				return `- \`${edit.targetRepo.repoFullName}:${edit.targetRepo.path}\` (from \`${edit.path}\`)`;
			}
			const realPath = subPath ? path.posix.join(subPath, edit.path) : edit.path;
			return `- \`${realPath}\``;
		})
		.join('\n');
	return [
		'Proposed by **nao** context recommendations.',
		'',
		`**Why:** ${rec.summary}`,
		'',
		`**Fix:** ${rec.suggestedAction}`,
		'',
		'**Files changed:**',
		files,
		'',
		'_Review carefully — this change was drafted automatically from real usage signals._',
	].join('\n');
}

function batchPrBody(recs: DBContextRecommendation[], subPath: string): string {
	const sections = recs.map((rec) => {
		const edits = filterPullRequestEdits(rec.proposedEdits!);
		const files = edits
			.map((edit) => {
				if (edit.targetRepo) {
					return `  - \`${edit.targetRepo.repoFullName}:${edit.targetRepo.path}\``;
				}
				const realPath = subPath ? path.posix.join(subPath, edit.path) : edit.path;
				return `  - \`${realPath}\``;
			})
			.join('\n');
		return [`### ${rec.title}`, `**Why:** ${rec.summary}`, `**Fix:** ${rec.suggestedAction}`, files].join('\n');
	});

	return [
		`Proposed by **nao** context recommendations — ${recs.length} batched.`,
		'',
		...sections.flatMap((s) => [s, '']),
		'_Review carefully — these changes were drafted automatically from real usage signals._',
	].join('\n');
}
