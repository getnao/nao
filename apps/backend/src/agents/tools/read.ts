import { readFile } from '@nao/shared/tools';
import fs from 'fs/promises';

import { ReadOutput, renderToModelOutput } from '../../components/tool-outputs';
import { createTool } from '../../types/tools';
import { toRealPath } from '../../utils/tools';

export default createTool({
	description: `Read a file.`,
	inputSchema: readFile.InputSchema,
	outputSchema: readFile.OutputSchema,

	execute: async ({ file_path, start_line, limit }, context) => {
		const projectFolder = context.projectFolder;
		const realPath = toRealPath(file_path, projectFolder);

		const content = await fs.readFile(realPath, 'utf-8');
		const allLines = content.split('\n');
		const numberOfTotalLines = allLines.length;

		if (start_line != null && start_line > numberOfTotalLines) {
			throw new Error(
				`Start line ${start_line} is greater than the number of total lines ${numberOfTotalLines}.`,
			);
		}

		const startIdx = (start_line ?? 1) - 1;
		const sliced = allLines.slice(startIdx, limit != null ? startIdx + limit : undefined);

		return {
			_version: '2' as const,
			content: sliced.join('\n'),
			startLine: startIdx + 1,
			numberOfTotalLines,
		};
	},

	toModelOutput: ({ output }) => renderToModelOutput(ReadOutput({ output }), output),
});
