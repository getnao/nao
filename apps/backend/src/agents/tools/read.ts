import { readFile } from '@nao/shared/tools';
import fs from 'fs/promises';

import { ReadOutput, renderToModelOutput } from '../../components/tool-outputs';
import { readUserFile } from '../../services/storage/user-files';
import { isStoragePath, toRealPath, toStorageRelativePath, toStorageScope } from '../../utils/tools';
import { createTool } from '../../utils/tools';

export default createTool<readFile.Input, readFile.Output>({
	description: 'Read the contents of a file at the specified path.',
	inputSchema: readFile.InputSchema,
	outputSchema: readFile.OutputSchema,
	execute: async ({ file_path }, context) => {
		const content = isStoragePath(file_path)
			? await readUserFile(toStorageScope(context), toStorageRelativePath(file_path))
			: await fs.readFile(toRealPath(file_path, context.projectFolder), 'utf-8');

		return {
			_version: '1' as const,
			content,
			numberOfTotalLines: content.split('\n').length,
		};
	},

	toModelOutput: ({ output }) => renderToModelOutput(ReadOutput({ output }), output),
});
