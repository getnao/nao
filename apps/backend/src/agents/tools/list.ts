import { list } from '@nao/shared/tools';
import fs from 'fs/promises';
import path from 'path';

import { ListOutput, renderToModelOutput } from '../../components/tool-outputs';
import { createTool } from '../../types/tools';
import { shouldExcludeEntry, toRealPath, toVirtualPath } from '../../utils/tools';

export default createTool({
	description: 'List files and directories at the specified path.',
	inputSchema: list.InputSchema,
	outputSchema: list.OutputSchema,
	execute: async ({ path: filePath }, context) => {
		const projectFolder = context.projectFolder;
		const realPath = toRealPath(filePath, projectFolder);

		// Get the relative path of the parent directory for naoignore matching
		const parentRelativePath = path.relative(projectFolder, realPath);

		const dirEntries = await fs.readdir(realPath, { withFileTypes: true });

		// Filter out excluded entries (including .naoignore patterns)
		const filteredEntries = dirEntries.filter(
			(entry) => !shouldExcludeEntry(entry.name, parentRelativePath, projectFolder),
		);

		const entries = await Promise.all(
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
						const subEntries = await fs.readdir(fullRealPath);
						itemCount = subEntries.length;
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

		return { _version: '1' as const, entries };
	},

	toModelOutput: ({ output }) => renderToModelOutput(ListOutput({ output }), output),
});
