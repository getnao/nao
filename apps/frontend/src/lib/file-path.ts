export const getFileName = (filePath?: string): string | undefined => {
	return filePath?.split('/').filter(Boolean).pop() ?? filePath;
};

export const isMarkdownPath = (filePath: string): boolean => {
	const extension = filePath.split('.').pop()?.toLowerCase();
	return extension === 'md' || extension === 'mdx' || extension === 'markdown';
};

/** The last folders of a file's path, `key=value` folders shown by their value, to hint where it is in a list. */
export const getFolderHint = (filePath: string, depth = 2): string => {
	return getParentFolders(filePath).slice(-depth).map(getFolderLabel).join('/');
};

/** Short label for where a context file comes from: the `schema.table` of a synced database file, or its parent folder. */
export const getReadContextLabel = (filePath?: string): string | null => {
	if (!filePath) {
		return null;
	}

	const schemaMatch = filePath.match(/\/schema=([^/]+)/);
	const tableMatch = filePath.match(/\/table=([^/]+)/);
	if (schemaMatch && tableMatch) {
		return `${schemaMatch[1]}.${tableMatch[1]}`;
	}

	const pathSegments = filePath.split('/').filter(Boolean);
	if (pathSegments.length < 2) {
		return null;
	}

	const parentDir = pathSegments[pathSegments.length - 2];
	if (!parentDir || parentDir.includes('=')) {
		return null;
	}

	return parentDir;
};

/**
 * The shortest trail of parent folders telling a file apart from the others of the same name, keyed by path,
 * with `key=value` folders shown by their value. Files with a unique name have no entry.
 */
export const getDistinguishingFolders = (filePaths: string[]): Map<string, string> => {
	const distinguishingFolders = new Map<string, string>();
	for (const filePath of filePaths) {
		const namesakes = filePaths.filter(
			(otherPath) => otherPath !== filePath && getFileName(otherPath) === getFileName(filePath),
		);
		if (namesakes.length === 0) {
			continue;
		}
		const folders = getParentFolders(filePath);
		let depth = 1;
		while (
			depth < folders.length &&
			namesakes.some(
				(otherPath) => getFolderTrail(getParentFolders(otherPath), depth) === getFolderTrail(folders, depth),
			)
		) {
			depth++;
		}
		const trail = folders.slice(-depth).map(getFolderLabel).join('/');
		if (trail) {
			distinguishingFolders.set(filePath, trail);
		}
	}
	return distinguishingFolders;
};

function getParentFolders(filePath: string): string[] {
	return filePath.split('/').filter(Boolean).slice(0, -1);
}

function getFolderTrail(folders: string[], depth: number): string {
	return folders.slice(-depth).join('/');
}

function getFolderLabel(folder: string): string {
	const separatorIndex = folder.indexOf('=');
	return separatorIndex === -1 ? folder : folder.slice(separatorIndex + 1);
}
