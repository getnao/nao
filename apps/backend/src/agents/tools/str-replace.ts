import { isBinaryDocument } from '@nao/shared/attachments';
import { strReplace } from '@nao/shared/tools';

import { renderToModelOutput, StrReplaceOutput } from '../../components/tool-outputs';
import { isStorageEnabled, relativePathFromKey } from '../../services/storage';
import { readUserFile, writeUserFile } from '../../services/storage/user-files';
import {
	customStoryAuthoringError,
	isCustomStoriesEnabled,
	readStoryMountFile,
	writeStoryMountFile,
} from '../../services/story-mount';
import type { ToolContext } from '../../types/tools';
import { withKeyedLock } from '../../utils/keyed-lock';
import { isStoriesPath, STORIES_MOUNT } from '../../utils/story-mount';
import {
	createTool,
	isStoragePath,
	STORAGE_MOUNT,
	toStorageRelativePath,
	toStorageScope,
	toStorageVirtualPath,
} from '../../utils/tools';

export function buildStrReplaceToolDescription({
	storage = isStorageEnabled(),
	customStories = isCustomStoriesEnabled(),
}: { storage?: boolean; customStories?: boolean } = {}): string {
	const targets = [
		...(storage ? [`/${STORAGE_MOUNT}`] : []),
		...(customStories ? [`/${STORIES_MOUNT}/<story>/…`] : []),
	];
	const formattingHint = customStories
		? ' Story files are reformatted with Prettier on every save, so read a file before editing it rather than relying on the content you sent.'
		: '';
	return `Edit an existing text file under ${targets.join(' or under ')} by replacing one exact snippet with another. Prefer it over write for any change to a file that already exists: only the snippet travels, not the whole file. old_string must match the current content exactly (whitespace and indentation included) and, unless replace_all is true, exactly once.${formattingHint}`;
}

export default createTool<strReplace.Input, strReplace.Output>({
	description: buildStrReplaceToolDescription(),
	inputSchema: strReplace.InputSchema,
	outputSchema: strReplace.OutputSchema,
	execute: async ({ file_path, ...edit }, context) => {
		if (isStoriesPath(file_path)) {
			const authoringError = customStoryAuthoringError(context.userGroupFeatures);
			if (authoringError) {
				throw new Error(`Cannot edit '${file_path}': ${authoringError}`);
			}
			return { _version: '1' as const, ...(await editStoryFile(file_path, edit, context)) };
		}
		if (isStoragePath(file_path)) {
			return { _version: '1' as const, ...(await editStorageFile(file_path, edit, context)) };
		}
		throw new Error(`Cannot edit '${file_path}': ${editableTargetsHint()}. Project context files are read-only.`);
	},

	toModelOutput: ({ output }) => renderToModelOutput(StrReplaceOutput({ output }), output),
});

type Edit = Omit<strReplace.Input, 'file_path'>;
type Edited = Omit<strReplace.Output, '_version'>;

const editStoryFile = async (filePath: string, edit: Edit, context: ToolContext): Promise<Edited> => {
	return withKeyedLock(`str-replace:story:${context.chatId}:${filePath}`, async () => {
		const current = await readStoryMountFile(context.chatId, filePath);
		const { content, replacements } = strReplace.applyReplacement(current, edit);
		return { ...(await writeStoryMountFile(context.chatId, filePath, content)), replacements };
	});
};

const editStorageFile = async (filePath: string, edit: Edit, context: ToolContext): Promise<Edited> => {
	const scope = toStorageScope(context);
	const relativePath = toStorageRelativePath(filePath);
	if (isBinaryDocument(relativePath)) {
		throw new Error(
			`Cannot edit '${filePath}': it is not a text file. Use write to save a new text version instead.`,
		);
	}
	return withKeyedLock(`str-replace:storage:${scope.projectId}:${scope.userId}:${relativePath}`, async () => {
		const current = await readUserFile(scope, relativePath);
		const { content, replacements } = strReplace.applyReplacement(current, edit);
		const object = await writeUserFile(scope, relativePath, content);
		return {
			path: toStorageVirtualPath(relativePathFromKey(scope, object.key)),
			size: object.size,
			replacements,
		};
	});
};

const editableTargetsHint = (): string => {
	const targets = [
		...(isStorageEnabled() ? [`/${STORAGE_MOUNT}`] : []),
		...(isCustomStoriesEnabled() ? [`/${STORIES_MOUNT}/<story>`] : []),
	];
	return `only files under ${targets.join(' or ')} can be edited`;
};
