import { fromRepoPath, type ResolvedContextRepo } from '../utils/context-repo';
import { tryRunGit } from '../utils/git-repo';
import type { ContextExplorerFileAccess } from './context-explorer.service';

export interface RecentContextChange {
	/** The File Explorer path, with a leading slash. */
	path: string;
	changedAt: string;
	author: string;
	message: string;
}

const COMMIT_LIMIT = 50;
const CHANGE_LIMIT = 30;
const RECORD_SEPARATOR = '\u001e';
const FIELD_SEPARATOR = '\u001f';
const NUL = '\u0000';

export function listRecentContextChanges(access: ContextExplorerFileAccess): RecentContextChange[] | null {
	if (access.git.status !== 'available') {
		return null;
	}
	const { repo } = access.git;
	const output = tryRunGit(repo.worktreeRoot, [
		'-c',
		'core.quotePath=false',
		'log',
		'-z',
		`--max-count=${COMMIT_LIMIT}`,
		`--format=${RECORD_SEPARATOR}%cI${FIELD_SEPARATOR}%an${FIELD_SEPARATOR}%s`,
		'--name-only',
		'--',
		repo.projectPrefix || '.',
	]);
	return output ? parseRecentContextChanges(output.toString(), repo) : [];
}

/**
 * Keeps the latest commit of each file, from the output of `git log -z --name-only` with separated records: each
 * record is its header, then the paths of its files, all ended by NUL so a path keeps its spaces, tabs and newlines.
 */
export function parseRecentContextChanges(
	output: string,
	repo: Pick<ResolvedContextRepo, 'projectPrefix'>,
): RecentContextChange[] {
	const changesByPath = new Map<string, RecentContextChange>();
	for (const record of output.split(RECORD_SEPARATOR).slice(1)) {
		const [header, ...filePaths] = record.split(NUL);
		const [changedAt, author, message] = header.split(FIELD_SEPARATOR);
		for (const repoPath of filePaths.map(stripNameListBreak).filter(Boolean)) {
			const projectPath = fromRepoPath(repo, repoPath);
			if (projectPath && !changesByPath.has(projectPath) && changesByPath.size < CHANGE_LIMIT) {
				changesByPath.set(projectPath, { path: `/${projectPath}`, changedAt, author, message: message ?? '' });
			}
		}
	}
	return [...changesByPath.values()];
}

/** Git starts the list of file paths of a commit on a new line, which belongs to the list rather than to its first path. */
function stripNameListBreak(path: string, index: number): string {
	return index === 0 ? path.replace(/^\n/, '') : path;
}
