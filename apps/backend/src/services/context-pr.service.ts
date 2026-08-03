import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import type { RepoProvider } from '@nao/shared/types';

import type { DBContextRecommendation } from '../db/abstractSchema';
import * as crQueries from '../queries/context-recommendation.queries';
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
import * as gitlab from './gitlab';
import type { ReviewRequestProvider } from './review-request-provider';
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
	source: 'settings' | 'linked';
	provider: RepoProvider;
	webUrl: string;
}

export async function resolveRecommendationRepo(projectId: string): Promise<RecommendationRepo | null> {
	return resolveContextRepository(projectId);
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
 * open the PR via the GitHub API. Only human-written files are ever written.
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
			body: prBody(rec, edits),
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
}): Promise<{ url: string }> {
	const { provider, userId, repoFullName, workdir, branch, configuredBase, edits, title, commitMessage, body } = args;

	const token = await provider.getToken(userId);
	if (!token) {
		throw new Error(provider.notConnectedMessage);
	}

	provider.cloneRepo(token, repoFullName, workdir);
	const base = configuredBase ?? provider.getGitInfo(workdir).branch ?? 'main';

	applyEdits(workdir, edits);

	const author = await provider.getUserGitIdentity(token);
	provider.commitAllAndPushBranch({
		token,
		repoFullName,
		dir: workdir,
		branch,
		message: commitMessage,
		author,
		coAuthors: [provider.coAuthor],
	});

	return provider.openReviewRequest(token, repoFullName, {
		title,
		head: branch,
		base,
		body,
	});
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
		webUrl: `${target.provider === 'gitlab' ? gitlab.gitlabBaseUrl() : 'https://github.com'}/${target.repoFullName}`,
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

function applyEdits(dir: string, edits: ReviewRequestEdit[]): void {
	const root = canonicalizeWriteRoot(dir);
	for (const edit of edits) {
		const editPath = edit.path;
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

function commitMessage(rec: DBContextRecommendation): string {
	return `${prTitle(rec)}\n\n${rec.summary}`;
}

function prBody(rec: DBContextRecommendation, edits: ProposedEdit[]): string {
	const files = edits
		.map((edit) => {
			if (edit.targetRepo) {
				return `- \`${edit.targetRepo.repoFullName}:${edit.targetRepo.path}\` (from \`${edit.path}\`)`;
			}
			return `- \`${edit.path}\``;
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
