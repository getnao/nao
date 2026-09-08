import { isBinaryDocument } from '@nao/shared/attachments';
import { readFile } from '@nao/shared/tools';
import fs from 'fs/promises';

import { ReadOutput, renderToModelOutput } from '../../components/tool-outputs';
import { assertContextPathAllowed } from '../../services/context-access';
import { toReadableText } from '../../services/file-text';
import { readUserFile } from '../../services/storage/user-files';
import type { ToolContext } from '../../types/tools';
import { isStoragePath, resolveCanonicalProjectPath, toStorageRelativePath, toStorageScope } from '../../utils/tools';
import { createTool } from '../../utils/tools';

export default createTool<readFile.Input, readFile.Output>({
	description: 'Read the contents of a file at the specified path.',
	inputSchema: readFile.InputSchema,
	outputSchema: readFile.OutputSchema,
	execute: async ({ file_path }, context) => {
		const content = isStoragePath(file_path)
			? await readUserFile(toStorageScope(context), toStorageRelativePath(file_path))
			: await readProjectFile(resolveAllowedProjectPath(file_path, context));

		return {
			_version: '1' as const,
			content,
			numberOfTotalLines: content.split('\n').length,
		};
	},

	toModelOutput: ({ output }) => renderToModelOutput(ReadOutput({ output }), output),
});

function resolveAllowedProjectPath(filePath: string, context: ToolContext): string {
	const canonical = resolveCanonicalProjectPath(filePath, context.projectFolder);
	assertContextPathAllowed(context.warehouseTableAccess, canonical.virtualPath);
	return canonical.realPath;
}

/** Only non-text formats need their bytes inspected, so plain files keep the cheaper path. */
const readProjectFile = async (realPath: string): Promise<string> => {
	if (!isBinaryDocument(realPath)) {
		return fs.readFile(realPath, 'utf-8');
	}

	return toReadableText(realPath, await fs.readFile(realPath));
};
