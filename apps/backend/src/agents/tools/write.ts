import { writeFile } from '@nao/shared/tools';

import { renderToModelOutput, WriteOutput } from '../../components/tool-outputs';
import { env } from '../../env';
import { isStorageEnabled, relativePathFromKey } from '../../services/storage';
import { writeUserFile } from '../../services/storage/user-files';
import { customStoryAuthoringError, isCustomStoriesEnabled, writeStoryMountFile } from '../../services/story-mount';
import type { ToolContext } from '../../types/tools';
import { isStoriesPath, STORIES_MOUNT } from '../../utils/story-mount';
import {
	createTool,
	isStoragePath,
	STORAGE_MOUNT,
	toStorageRelativePath,
	toStorageScope,
	toStorageVirtualPath,
} from '../../utils/tools';

export function buildWriteToolDescription({
	storage = isStorageEnabled(),
	customStories = isCustomStoriesEnabled(),
	canReplace = true,
}: { storage?: boolean; customStories?: boolean; canReplace?: boolean } = {}): string {
	const targets = [
		...(storage
			? [
					`/${STORAGE_MOUNT}, where files are kept for later (a file may not exceed ${env.NAO_STORAGE_MAX_FILE_SIZE_MB} MB)`,
				]
			: []),
		...(customStories
			? [`/${STORIES_MOUNT}/<story>/…, the draft files of a custom story created with the story tool`]
			: []),
	];
	const replaceHint = canReplace
		? ' Use it to create a file or rewrite most of one; to change part of an existing file, use str_replace instead of sending the whole content again.'
		: '';
	return `Save a text file under ${targets.join(' or under ')}. Missing folders are created and an existing file is overwritten.${replaceHint} Everything else in the tree is read-only.`;
}

export default createTool<writeFile.Input, writeFile.Output>({
	description: buildWriteToolDescription(),
	inputSchema: writeFile.InputSchema,
	outputSchema: writeFile.OutputSchema,
	execute: async ({ file_path, content }, context) => {
		if (isStoriesPath(file_path)) {
			const authoringError = customStoryAuthoringError(context.userGroupFeatures);
			if (authoringError) {
				throw new Error(`Cannot write '${file_path}': ${authoringError}`);
			}
			return { _version: '1' as const, ...(await writeStoryMountFile(context.chatId, file_path, content)) };
		}
		if (isStoragePath(file_path)) {
			return { _version: '1' as const, ...(await writeStorageFile(file_path, content, context)) };
		}
		throw new Error(`Cannot write '${file_path}': ${writableTargetsHint()}. Project context files are read-only.`);
	},

	toModelOutput: ({ output }) => renderToModelOutput(WriteOutput({ output }), output),
});

const writeStorageFile = async (
	filePath: string,
	content: string,
	context: ToolContext,
): Promise<{ path: string; size: number }> => {
	const scope = toStorageScope(context);
	const object = await writeUserFile(scope, toStorageRelativePath(filePath), content);
	return { path: toStorageVirtualPath(relativePathFromKey(scope, object.key)), size: object.size };
};

const writableTargetsHint = (): string => {
	const targets = [
		...(isStorageEnabled() ? [`/${STORAGE_MOUNT}`] : []),
		...(isCustomStoriesEnabled() ? [`/${STORIES_MOUNT}/<story>`] : []),
	];
	return `only files under ${targets.join(' or ')} can be written`;
};
