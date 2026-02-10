import { list } from '@nao/shared/tools';
import { tool } from 'ai';
import fs from 'fs/promises';
import path from 'path';

import { getProjectFolder, shouldExcludeEntry, toRealPath, toVirtualPath } from '../../utils/tools';

export default tool({
	description: 'List files and directories at the specified path.',
	inputSchema: list.InputSchema,
	outputSchema: list.OutputSchema,
	execute: async ({ path: filePath }) => {
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
	},
});
