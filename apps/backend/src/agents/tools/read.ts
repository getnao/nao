import { isBinaryDocument } from '@nao/shared/attachments';
import { readFile } from '@nao/shared/tools';
import fs from 'fs/promises';

import { ReadOutput, renderToModelOutput } from '../../components/tool-outputs';
import { renderProjectTextForAgent } from '../../services/agent-visible-project-file.service';
import { toReadableText } from '../../services/file-text';
import { assertProjectContextPathAllowed } from '../../services/project-context-path-access.service';
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
			: await readProjectFile(resolveAllowedProjectPath(file_path, context), context);

		return {
			_version: '1' as const,
			content,
			numberOfTotalLines: content.split('\n').length,
		};
	},

	toModelOutput: ({ output }) => renderToModelOutput(ReadOutput({ output }), output),
});

function resolveAllowedProjectPath(filePath: string, context: ToolContext): { realPath: string; virtualPath: string } {
	const canonical = resolveCanonicalProjectPath(filePath, context.projectFolder);
	assertProjectContextPathAllowed(context, filePath, canonical.virtualPath, 'file');
	return canonical;
}

/** Only non-text formats need their bytes inspected, so plain files keep the cheaper path. */
const readProjectFile = async (
	file: { realPath: string; virtualPath: string },
	context: ToolContext,
): Promise<string> => {
	const { realPath, virtualPath } = file;
	if (!isBinaryDocument(realPath)) {
		const content = renderProjectTextForAgent(virtualPath, await fs.readFile(realPath, 'utf-8'), context);
		if (content === null) {
			throw new Error('RULES.md could not be rendered safely.');
		}
		return content;
	}

	return toReadableText(realPath, await fs.readFile(realPath));
};
