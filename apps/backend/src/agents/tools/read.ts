import { readFile } from '@nao/shared/tools';
import fs from 'fs/promises';

import { ReadOutput, renderToModelOutput } from '../../components/tool-outputs';
import { createTool } from '../../types/tools';
import { toRealPath } from '../../utils/tools';

export default createTool({
	description: 'Read the contents of a file at the specified path.',
	inputSchema: readFile.InputSchema,
	outputSchema: readFile.OutputSchema,
	execute: async ({ file_path }, context) => {
		const projectFolder = context.projectFolder;
		const realPath = toRealPath(file_path, projectFolder);

		const content = await fs.readFile(realPath, 'utf-8');
		const numberOfTotalLines = content.split('\n').length;

		return {
			_version: '1' as const,
			content,
			numberOfTotalLines,
		};
	},

	toModelOutput: ({ output }) => renderToModelOutput(ReadOutput({ output }), output),
});
