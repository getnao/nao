import { searchFiles } from '@nao/shared/tools';
import fs from 'fs/promises';
import { glob } from 'glob';
import { minimatch } from 'minimatch';
import path from 'path';

import { renderToModelOutput, SearchOutput } from '../../components/tool-outputs';
import { isDocsProjectPath, isProjectContextPathAllowed } from '../../services/project-context-path-access.service';
import { isStorageEnabled, relativePathFromKey } from '../../services/storage';
import { findUserFiles } from '../../services/storage/user-files';
import type { ToolContext } from '../../types/tools';
import {
	loadNaoignorePatterns,
	resolveCanonicalProjectPath,
	STORAGE_MOUNT,
	toStorageScope,
	toStorageVirtualPath,
	toVirtualPath,
} from '../../utils/tools';
import { createTool } from '../../utils/tools';

export default createTool<searchFiles.Input, searchFiles.Output>({
	description: 'Search for files matching a glob pattern within the project.',
	inputSchema: searchFiles.InputSchema,
	outputSchema: searchFiles.OutputSchema,
	execute: async ({ pattern }, context) => {
		// Sanitize pattern to prevent escaping the tree
		if (path.isAbsolute(pattern)) {
			throw new Error(`Access denied: absolute paths are not allowed in file patterns`);
		}
		if (pattern.includes('..')) {
			throw new Error(`Access denied: '..' is not allowed in file patterns`);
		}

		// Make pattern recursive if not already
		const recursivePattern = pattern.startsWith('**/') ? pattern : `**/${pattern}`;

		const [projectFiles, storageFiles] = await Promise.all([
			searchProjectFolder(recursivePattern, context),
			searchStorage(recursivePattern, context),
		]);

		return { _version: '1' as const, files: [...projectFiles, ...storageFiles] };
	},

	toModelOutput: ({ output }) => renderToModelOutput(SearchOutput({ output }), output),
});

const searchStorage = async (recursivePattern: string, context: ToolContext): Promise<searchFiles.File[]> => {
	if (!isStorageEnabled()) {
		return [];
	}

	const scope = toStorageScope(context);
	const objects = await findUserFiles(scope, (relativePath) =>
		minimatch(`${STORAGE_MOUNT}/${relativePath}`, recursivePattern, { dot: true }),
	);

	return objects.map((object) => {
		const virtualPath = toStorageVirtualPath(relativePathFromKey(scope, object.key));
		return {
			path: virtualPath,
			dir: path.dirname(virtualPath),
			size: object.size.toString(),
		};
	});
};

const searchProjectFolder = async (recursivePattern: string, context: ToolContext): Promise<searchFiles.File[]> => {
	const projectFolder = context.projectFolder;
	// Build ignore patterns from .naoignore
	const naoignorePatterns = loadNaoignorePatterns(projectFolder);
	const ignorePatterns = naoignorePatterns.flatMap((ignorePattern) => {
		const cleanPattern = ignorePattern.endsWith('/') ? ignorePattern.slice(0, -1) : ignorePattern;
		return [`**/${cleanPattern}`, `**/${cleanPattern}/**`];
	});

	const matchedPaths = await glob(recursivePattern, {
		absolute: true,
		cwd: projectFolder,
		ignore: ignorePatterns,
	});

	const files = await Promise.all(
		matchedPaths.map(async (matchedPath): Promise<searchFiles.File | null> => {
			try {
				const virtualPath = toVirtualPath(matchedPath, projectFolder);
				if (isDocsProjectPath(virtualPath) && (await fs.lstat(matchedPath)).isSymbolicLink()) {
					return null;
				}
				const canonical = resolveCanonicalProjectPath(virtualPath, projectFolder);
				const stats = await fs.stat(canonical.realPath);
				if (
					!isProjectContextPathAllowed(
						context,
						virtualPath,
						canonical.virtualPath,
						stats.isDirectory() ? 'directory' : 'file',
					)
				) {
					return null;
				}
				return {
					path: canonical.virtualPath,
					dir: path.dirname(canonical.virtualPath),
					size: stats.size.toString(),
				};
			} catch {
				return null;
			}
		}),
	);
	return files.filter((file): file is searchFiles.File => file !== null);
};
