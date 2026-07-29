import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import type { ProposedEdit } from '@nao/shared/types';

import { toRepoPath } from '../utils/context-repo';
import { logger } from '../utils/logger';
import { buildContextProposedEdits } from './context-explorer-edit.service';
import { requireContextRepo } from './context-explorer-git.service';
import { createReviewRequest, REVIEW_REQUEST_PROVIDERS, ReviewRequestProvider } from './context-pr.service';

export interface ContextPullRequestResult {
	url: string;
	branch: string;
}

export async function createContextExplorerPullRequest(
	projectFolder: string,
	userId: string,
	paths: string[],
	providerOverride?: ReviewRequestProvider,
): Promise<ContextPullRequestResult> {
	const repo = requireContextRepo(projectFolder);
	const edits = await buildContextProposedEdits(projectFolder, paths);
	const branch = `nao/context-edits-${Date.now().toString(36)}`;
	const workdir = fs.mkdtempSync(path.join(os.tmpdir(), 'nao-context-pr-'));
	const provider = providerOverride ?? REVIEW_REQUEST_PROVIDERS[repo.provider];
	const title = contextPullRequestTitle(edits);

	try {
		const reviewEdits = edits.map((edit) => ({
			path: toRepoPath(repo, edit.path),
			newContent: edit.newContent,
		}));
		const { url } = await createReviewRequest({
			provider,
			userId,
			repoFullName: repo.repoFullName,
			workdir,
			branch,
			configuredBase: repo.branch,
			edits: reviewEdits,
			title,
			commitMessage: title,
			body: contextPullRequestBody(edits),
		});
		return { url, branch };
	} finally {
		try {
			fs.rmSync(workdir, { recursive: true, force: true });
		} catch (error) {
			logger.error(`Failed to clean up PR workdir ${workdir}: ${String(error)}`, { source: 'agent' });
		}
	}
}

function contextPullRequestTitle(edits: ProposedEdit[]): string {
	return edits.length === 1 ? `nao context: update ${edits[0].path}` : `nao context: update ${edits.length} files`;
}

function contextPullRequestBody(edits: ProposedEdit[]): string {
	const files = edits.map((edit) => `- \`${edit.path}\``).join('\n');
	return ['Context files edited in nao.', '', '**Files changed:**', files].join('\n');
}
