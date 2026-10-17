export const getFileName = (filePath?: string): string | undefined => {
	return filePath?.split('/').filter(Boolean).pop() ?? filePath;
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
