import type { DBTestRun } from '../db/abstractSchema';
import { createSafeFileAccess, createStrictFileAccess } from './context-explorer-access.service';
import { type DraftSource, hasContextWorktree, readGitDraft } from './draft-context.service';
import { hasContextRepository, readNaoDraft } from './nao-draft.service';
import { startChangesRun, startComparisonRun, startTestRun, type StartTestRunInput } from './test-runner.service';
import type { UpstreamBranchRef } from './upstream-context.service';

const NO_DRAFT_MESSAGE = 'Edit context files in the File Explorer to compare your changes with the default branch.';

/**
 * `production` runs against the production context, `changes` against it with the changes, and `compare` against
 * both side by side.
 */
export type TestRunMode = 'production' | 'changes' | 'compare';

export interface DraftReader {
	projectId: string;
	projectFolder: string;
	user: { id: string; name: string; email: string };
}

/** Raised when the user has no context changes a run could test, with a message the user can act on. */
export class MissingDraftError extends Error {}

/**
 * Starts a run in the mode picked. The changes are those of `upstream`, a branch of a repository synced into the
 * context, or else the user's File Explorer changes.
 */
export async function startRunInMode(input: {
	mode: TestRunMode;
	run: StartTestRunInput;
	upstream?: UpstreamBranchRef;
	reader: DraftReader;
}): Promise<DBTestRun> {
	if (input.mode === 'production') {
		return startTestRun(input.run);
	}
	const startContextChangesRun = input.mode === 'compare' ? startComparisonRun : startChangesRun;
	if (input.upstream) {
		return startContextChangesRun({ ...input.run, upstream: input.upstream });
	}
	return startContextChangesRun({ ...input.run, draft: await requireUserDraft(input.reader) });
}

/** Without a context repository nao keeps the draft, otherwise it is the user's File Explorer worktree. */
export async function readUserDraft(
	{ projectId, projectFolder, user }: DraftReader,
	createFileAccess: typeof createSafeFileAccess,
): Promise<DraftSource | { message: string }> {
	if (!(await hasContextRepository(projectId))) {
		return readNaoDraft({ projectId, userId: user.id }, projectFolder);
	}
	if (!hasContextWorktree(projectId, projectFolder, user.id)) {
		return { message: NO_DRAFT_MESSAGE };
	}
	const access = await createFileAccess(projectId, projectFolder, user);
	if (access.git.status === 'unavailable') {
		return { message: access.git.message };
	}
	return readGitDraft(access.git.repo, projectFolder);
}

/** Read strictly, as the run copies the changes into its context. */
async function requireUserDraft(reader: DraftReader): Promise<DraftSource> {
	const draft = await readUserDraft(reader, createStrictFileAccess);
	if ('message' in draft) {
		throw new MissingDraftError(draft.message);
	}
	return draft;
}
