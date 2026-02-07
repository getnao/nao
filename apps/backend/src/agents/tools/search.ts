import { searchFiles } from '@nao/shared/tools';
import { tool } from 'ai';
import fs from 'fs/promises';
import { glob } from 'glob';
import path from 'path';

import { getProjectFolder, isWithinProjectFolder, loadNaoignorePatterns, toVirtualPath } from '../../utils/tools';

export default tool({
	description: 'Search for files matching a glob pattern within the project.',
	inputSchema: searchFiles.InputSchema,
	outputSchema: searchFiles.OutputSchema,
	execute: async ({ pattern }) => {
		const projectFolder = getProjectFolder();

		// Sanitize pattern to prevent escaping project folder
		if (path.isAbsolute(pattern)) {
			throw new Error(`Access denied: absolute paths are not allowed in file patterns`);
		}
		if (pattern.includes('..')) {
			throw new Error(`Access denied: '..' is not allowed in file patterns`);
		}

		// Make pattern recursive if not already
		const sanitizedPattern = pattern.startsWith('**/') ? pattern : `**/${pattern}`;

		// Build ignore patterns from .naoignore
		const naoignorePatterns = loadNaoignorePatterns(projectFolder);
		const ignorePatterns = naoignorePatterns.flatMap((ignorePattern) => {
			const cleanPattern = ignorePattern.endsWith('/') ? ignorePattern.slice(0, -1) : ignorePattern;
			return [`**/${cleanPattern}`, `**/${cleanPattern}/**`];
		});

		const files = await glob(sanitizedPattern, {
			absolute: true,
			cwd: projectFolder,
			ignore: ignorePatterns,
		});

		// Filter to only files within the project folder and not in excluded dirs (double-check)
		const safeFiles = files.filter((f) => isWithinProjectFolder(f, projectFolder));

		return await Promise.all(
			safeFiles.map(async (realPath) => {
				const stats = await fs.stat(realPath);
				const virtualPath = toVirtualPath(realPath, projectFolder);

				return {
					path: virtualPath,
					dir: path.dirname(virtualPath),
					size: stats.size.toString(),
				};
			}),
		);
	},
});
