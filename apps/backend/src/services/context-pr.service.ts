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
import { shallowestSubPath } from './git-repo';
import * as github from './github';
import * as gitlab from './gitlab';
import type { InternalRepoProvider, ReviewRequestProvider } from './review-request-provider';
import { REVIEW_REQUEST_PROVIDERS } from './review-request-provider';

export { REVIEW_REQUEST_PROVIDERS };
export type { ReviewRequestProvider };

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
 * Resolves the Git repository used for context pull/merge requests. The sub-path is only
 * detected when a user is provided, since it needs a token to inspect the repository tree.
 */
export async function resolveRecommendationRepo(projectId: string, userId?: string): Promise<RecommendationRepo | null> {
	const connection = await resolveContextRepository(projectId);
	if (!connection) {
		return null;
	}
	const subPath = userId
		? await detectConfiguredRepoSubPath(connection.provider, connection.repoFullName, userId)
		: '';
	return { ...connection, subPath };
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
		throw new Error('Recommendation not found.');
	}
	if (rec.fixKind !== 'patch' || !rec.proposedEdits || rec.proposedEdits.length === 0) {
		throw new Error('This recommendation has no automated changes to open as a pull request.');
	}
	if (rec.prUrl) {
		return { url: rec.prUrl, branch: rec.prBranch ?? '' };
	}

	const repo = await resolvePullRequestRepo(projectId, rec.proposedEdits);
	if (!repo) {
		throw new Error('No context repository is connected. Connect one in Settings → Git.');
	}

	const edits = filterPullRequestEdits(rec.proposedEdits);
	if (edits.length === 0) {
		throw new Error('The proposed changes only touch auto-generated files and cannot be opened as a pull request.');
	}

	const repoFullName = repo.repoFullName;
	const branch = `nao/context-${recommendationId.slice(0, 8)}-${Date.now().toString(36)}`;
	const workdir = fs.mkdtempSync(path.join(os.tmpdir(), 'nao-context-pr-'));
	const subPath = await resolveWriteSubPath(projectId, repo);

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
			body: prBody(rec, edits, subPath ?? ''),
			subPath,
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
		throw new Error('No eligible recommendations to batch. Each must have drafted changes and no existing PR.');
	}

	const repoByName = new Map<string, RecommendationRepo>();
	for (const rec of recs) {
		const repo = await resolvePullRequestRepo(projectId, rec.proposedEdits!);
		if (!repo) {
			throw new Error(
				'No GitHub or GitLab repository is configured for this project. Select one in Settings → Recommendations.',
			);
		}
		repoByName.set(repo.repoFullName, repo);
	}

	if (repoByName.size > 1) {
		throw new Error('All batched recommendations must target the same repository.');
	}

	const [repo] = repoByName.values();
	const branch = `nao/context-batch-${Date.now().toString(36)}`;
	const workdir = fs.mkdtempSync(path.join(os.tmpdir(), 'nao-context-pr-'));
	const subPath = await resolveWriteSubPath(projectId, repo);

	try {
		const { url } = await createBatchReviewRequest({
			provider: REVIEW_REQUEST_PROVIDERS[repo.provider],
			userId,
			repoFullName: repo.repoFullName,
			workdir,
			branch,
			configuredBase: repo.branch,
			subPath,
			recs,
		});

		const prCreatedAt = new Date();
		await Promise.all(
			recs.map((rec) => crQueries.setRecommendationPr(rec.id, { prUrl: url, prBranch: branch, prCreatedAt })),
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
		throw new Error(provider.notConnectedMessage);
	}
	if (!user) {
		throw new Error('User not found.');
	}

	provider.cloneRepo(token, repoFullName, workdir);
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

/** Same as `createReviewRequest`, but lands one commit per recommendation on a shared branch. */
async function createBatchReviewRequest(args: {
	provider: ReviewRequestProvider;
	userId: string;
	repoFullName: string;
	workdir: string;
	branch: string;
	configuredBase: string | null;
	subPath?: string;
	recs: DBContextRecommendation[];
}): Promise<{ url: string }> {
	const { provider, userId, repoFullName, workdir, branch, configuredBase, recs } = args;

	const [token, user] = await Promise.all([provider.getToken(userId), userQueries.getUser({ id: userId })]);
	if (token === null) {
		throw new Error(provider.notConnectedMessage);
	}
	if (!user) {
		throw new Error('User not found.');
	}

	provider.cloneRepo(token, repoFullName, workdir);
	const base = configuredBase ?? provider.getGitInfo(workdir).branch ?? 'main';
	const effectiveSubPath = resolveEffectiveSubPath(workdir, args.subPath);
	const author = await provider.getUserGitIdentity({
		token,
		user: { name: user.name, email: user.email },
	});

	let pushOutput = '';
	for (const rec of recs) {
		const edits = toReviewRequestEdits(filterPullRequestEdits(rec.proposedEdits ?? []));
		applyEdits(workdir, edits, effectiveSubPath);
		pushOutput = provider.commitAllAndPushBranch({
			token,
			repoFullName,
			dir: workdir,
			branch,
			message: commitMessage(rec),
			author,
			coAuthors: [provider.coAuthor],
		});
	}

	const reviewRequest = await provider.openReviewRequest(token, repoFullName, {
		title: batchPrTitle(recs),
		head: branch,
		base,
		body: batchPrBody(recs, effectiveSubPath),
		requester: { name: user.name, email: user.email },
		pushOutput,
	});
	if (!reviewRequest) {
		throw new Error(`Branch ${branch} was pushed successfully, but no pull request link was returned.`);
	}
	return { url: reviewRequest.url };
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
		throw new Error('A recommendation cannot open one pull request across multiple repositories.');
	}
	if (edits.some((edit) => !edit.targetRepo)) {
		throw new Error('A recommendation cannot mix context repository edits with linked repository edits.');
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

/**
 * Sub-path to write edits under. Linked repos use their own target paths as-is; context
 * repos prefer the project checkout's sub-path and otherwise fall back (`undefined`) to
 * detecting `nao_config.yaml` inside the fresh clone.
 */
async function resolveWriteSubPath(projectId: string, repo: RecommendationRepo): Promise<string | undefined> {
	if (repo.source === 'linked') {
		return '';
	}
	const project = await projectQueries.getProjectById(projectId);
	if (!project?.path) {
		return undefined;
	}
	const checkoutSubPath =
		repo.provider === 'gitlab' ? gitlab.getRepoSubPath(project.path) : github.getRepoSubPath(project.path);
	return checkoutSubPath || undefined;
}

function resolveEffectiveSubPath(workdir: string, subPath: string | undefined): string {
	if (subPath !== undefined) {
		return subPath;
	}
	return shallowestSubPath(findContextConfigDirs(workdir, workdir));
}

function findContextConfigDirs(root: string, dir: string): string[] {
	const results: string[] = [];
	for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
		if (entry.isSymbolicLink()) {
			continue;
		}
		const fullPath = path.join(dir, entry.name);
		if (entry.isDirectory()) {
			if (entry.name === '.git' || entry.name === 'node_modules') {
				continue;
			}
			results.push(...findContextConfigDirs(root, fullPath));
		} else if (entry.isFile() && entry.name === CONTEXT_CONFIG_FILENAME) {
			const relative = path.relative(root, dir);
			results.push(relative === '' ? '' : relative.split(path.sep).join('/'));
		}
	}
	return results;
}

function filterPullRequestEdits(edits: ProposedEdit[]): ProposedEdit[] {
	return edits.filter((edit) => {
		if (edit.targetRepo) {
			return true;
		}
		return isHumanWritableContextPath(edit.path);
	});
}

function applyEdits(dir: string, edits: ReviewRequestEdit[], subPath: string): void {
	const root = canonicalizeWriteRoot(dir);
	for (const edit of edits) {
		const editPath = subPath ? path.posix.join(subPath, edit.path) : edit.path;
		const target = resolveWritePath(root, editPath);
		assertNoSymlinkInWritePath(root, target, editPath);
		fs.mkdirSync(path.dirname(target), { recursive: true });
		writeFileAtomically({ content: edit.newContent, displayPath: editPath, root, target });
	}
}

function toReviewRequestEdits(edits: ProposedEdit[]): ReviewRequestEdit[] {
	return edits.map((edit) => ({
		path: edit.targetRepo?.path ?? edit.path,
		newContent: edit.newContent,
	}));
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
