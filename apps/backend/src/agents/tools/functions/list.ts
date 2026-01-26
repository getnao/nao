import fs from 'fs/promises';
import path from 'path';

import { getProjectFolder, shouldExcludeEntry, toRealPath, toVirtualPath } from '../../../utils/tools';
import type { Input, Output } from '../schema/list';

export const execute = async ({ path: filePath }: Input): Promise<Output> => {
	const projectFolder = getProjectFolder();
	const realPath = toRealPath(filePath, projectFolder);

	// Get the relative path of the parent directory for naoignore matching
	const parentRelativePath = path.relative(projectFolder, realPath);

	const entries = await fs.readdir(realPath, { withFileTypes: true });

	// Filter out excluded entries (including .naoignore patterns)
	const filteredEntries = entries.filter(
		(entry) => !shouldExcludeEntry(entry.name, parentRelativePath, projectFolder),
	);

	return await Promise.all(
		filteredEntries.map(async (entry) => {
			const fullRealPath = path.join(realPath, entry.name);

			const type: 'file' | 'directory' | 'symbolic_link' | undefined = entry.isDirectory()
				? 'directory'
				: entry.isFile()
					? 'file'
					: entry.isSymbolicLink()
						? 'symbolic_link'
						: undefined;
			const size = type === 'directory' ? undefined : (await fs.stat(fullRealPath)).size.toString();

			let itemCount: number | undefined;
			if (type === 'directory') {
				try {
					const dirEntries = await fs.readdir(fullRealPath);
					itemCount = dirEntries.length;
				} catch {
					// If we can't read the directory, leave itemCount undefined
				}
			}

			return {
				path: toVirtualPath(fullRealPath, projectFolder),
				name: entry.name,
				type,
				size,
				itemCount,
			};
		}),
	);
};
