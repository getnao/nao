export const INITIAL_PULL_FILE_LIMIT = 3;

export function formatChangedFileCount(count: number): string {
	return `${count} ${count === 1 ? 'file' : 'files'} changed`;
}

export function getVisiblePullFiles<T>(files: T[], expanded: boolean): T[] {
	return expanded ? files : files.slice(0, INITIAL_PULL_FILE_LIMIT);
}

export function getHiddenPullFileCount(fileCount: number): number {
	return Math.max(0, fileCount - INITIAL_PULL_FILE_LIMIT);
}
