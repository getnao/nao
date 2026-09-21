import { list } from '@nao/shared/tools';
import fs from 'fs/promises';
import path from 'path';

import { ListOutput, renderToModelOutput } from '../../components/tool-outputs';
import {
	assertProjectContextPathAllowed,
	isDocsProjectPath,
	isProjectContextPathAllowed,
} from '../../services/project-context-path-access.service';
import { isStorageEnabled } from '../../services/storage';
import { listUserDirectory } from '../../services/storage/user-files';
import { isCustomStoriesEnabled, listStoryMount } from '../../services/story-mount';
import type { ToolContext } from '../../types/tools';
import { isStoriesPath, STORIES_MOUNT, toStoriesVirtualPath } from '../../utils/story-mount';
import {
	isStoragePath,
	resolveCanonicalProjectPath,
	shouldExcludeEntry,
	STORAGE_MOUNT,
	toStorageRelativePath,
	toStorageScope,
	toStorageVirtualPath,
} from '../../utils/tools';
import { createTool } from '../../utils/tools';

export default createTool<list.Input, list.Output>({
	description: 'List files and directories at the specified path.',
	inputSchema: list.InputSchema,
	outputSchema: list.OutputSchema,
	execute: async ({ path: filePath }, context) => {
		return { _version: '1' as const, entries: await listAnywhere(filePath, context) };
	},

	toModelOutput: ({ output }) => renderToModelOutput(ListOutput({ output }), output),
});

const listAnywhere = (virtualPath: string, context: ToolContext): Promise<list.Entry[]> => {
	if (isStoriesPath(virtualPath)) {
		return listStoryMount(context.chatId, virtualPath);
	}
	if (isStoragePath(virtualPath)) {
		return listStorage(virtualPath, context);
	}
	return listProjectFolder(virtualPath, context);
};

const listStorage = async (virtualPath: string, context: ToolContext): Promise<list.Entry[]> => {
	const entries = await listUserDirectory(toStorageScope(context), toStorageRelativePath(virtualPath));

	return entries.map((entry) => ({
		path: toStorageVirtualPath(entry.relativePath),
		name: entry.name,
		type: entry.type,
		size: entry.size?.toString(),
		itemCount: entry.itemCount,
	}));
};

const listProjectFolder = async (virtualPath: string, context: ToolContext): Promise<list.Entry[]> => {
	const projectFolder = context.projectFolder;
	const canonical = resolveCanonicalProjectPath(virtualPath, projectFolder);
	assertProjectContextPathAllowed(context, virtualPath, canonical.virtualPath, 'directory');
	const realPath = canonical.realPath;

	// Get the relative path of the parent directory for naoignore matching
	const parentRelativePath = canonical.virtualPath.replace(/^\/+/, '');

	const dirEntries = await fs.readdir(realPath, { withFileTypes: true });

	// Filter out excluded entries (including .naoignore patterns)
	const filteredEntries = dirEntries.filter((entry) => {
		const childPath = path.posix.join(canonical.virtualPath, entry.name);
		return (
			!shouldExcludeEntry(entry.name, parentRelativePath, projectFolder) &&
			!(entry.isSymbolicLink() && isDocsProjectPath(childPath)) &&
			isAllowedProjectEntry(childPath, context, entry.isDirectory() ? 'directory' : 'file')
		);
	});

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
					const subEntries = await fs.readdir(fullRealPath, { withFileTypes: true });
					const childParentPath = path.posix.join(parentRelativePath, entry.name);
					itemCount = subEntries.filter((subEntry) => {
						const childPath = path.posix.join(canonical.virtualPath, entry.name, subEntry.name);
						return (
							!shouldExcludeEntry(subEntry.name, childParentPath, projectFolder) &&
							!(subEntry.isSymbolicLink() && isDocsProjectPath(childPath)) &&
							isAllowedProjectEntry(childPath, context, subEntry.isDirectory() ? 'directory' : 'file')
						);
					}).length;
				} catch {
					// If we can't read the directory, leave itemCount undefined
				}
			}

			return {
				path: path.posix.join(canonical.virtualPath, entry.name),
				name: entry.name,
				type,
				size,
				itemCount,
			};
		}),
	);

	const isRoot = parentRelativePath === '';
	return isRoot ? [...entries, ...mountEntries()] : entries;
};

function isAllowedProjectEntry(virtualPath: string, context: ToolContext, kind: 'file' | 'directory'): boolean {
	try {
		const canonical = resolveCanonicalProjectPath(virtualPath, context.projectFolder);
		return isProjectContextPathAllowed(context, virtualPath, canonical.virtualPath, kind);
	} catch {
		return false;
	}
}

/** Permanent storage and custom stories show up as ordinary folders at the root of the tree. */
const mountEntries = (): list.Entry[] => {
	return [
		...(isStorageEnabled()
			? [{ path: toStorageVirtualPath(''), name: STORAGE_MOUNT, type: 'directory' as const }]
			: []),
		...(isCustomStoriesEnabled()
			? [{ path: toStoriesVirtualPath(), name: STORIES_MOUNT, type: 'directory' as const }]
			: []),
	];
};
