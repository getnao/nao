import fs from 'fs/promises';
import { glob } from 'glob';
import path from 'path';

import { getProjectFolder, isWithinProjectFolder, toVirtualPath } from '../../../utils/tools';
import type { Input, Output } from '../schema/search';

export const execute = async ({ pattern }: Input): Promise<Output> => {
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

	const files = await glob(sanitizedPattern, { absolute: true, cwd: projectFolder });

	// Filter to only files within the project folder (safety net)
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
};
