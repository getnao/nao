import path from 'path';

import { getContextFileReads } from '../queries/context-file-reads.queries';

export interface MostReadContextFile {
	/** The File Explorer path, with a leading slash. */
	path: string;
	readCount: number;
}

const WINDOW_DAYS = 30;
/** High enough that the spellings of one file are all fetched before they are merged and ranked. */
const RAW_PATH_LIMIT = 5_000;
const MOST_READ_LIMIT = 50;
const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * The files the agent read most in the last 30 days. The agent writes the same file in several ways, like
 * `RULES.md` and `/RULES.md`, so its paths are merged under the File Explorer path.
 */
export async function getMostReadContextFiles(
	projectId: string,
	now = new Date(),
): Promise<{ windowDays: number; files: MostReadContextFile[] }> {
	const since = new Date(now.getTime() - WINDOW_DAYS * DAY_MS);
	const reads = await getContextFileReads(projectId, since, RAW_PATH_LIMIT);
	const filesByPath = new Map<string, MostReadContextFile>();

	for (const read of reads) {
		const explorerPath = toExplorerPath(read.filePath);
		if (!explorerPath) {
			continue;
		}
		const file = filesByPath.get(explorerPath) ?? { path: explorerPath, readCount: 0 };
		file.readCount += read.readCount;
		filesByPath.set(explorerPath, file);
	}

	const files = [...filesByPath.values()]
		.sort((left, right) => right.readCount - left.readCount || left.path.localeCompare(right.path))
		.slice(0, MOST_READ_LIMIT);
	return { windowDays: WINDOW_DAYS, files };
}

export function toExplorerPath(agentPath: string): string | null {
	const relativePath = path.posix.normalize(agentPath.trim().replace(/^\/+/, ''));
	if (!relativePath || relativePath === '.' || relativePath.startsWith('..')) {
		return null;
	}
	return `/${relativePath.replace(/\/$/, '')}`;
}
