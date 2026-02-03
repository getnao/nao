import fs from 'fs/promises';

import type { ToolContext } from '../../../types/tools';
import { getProjectFolder, toRealPath } from '../../../utils/tools';
import type { Input, Output } from '../schema/read';

export const execute = async ({ file_path }: Input, context?: ToolContext): Promise<Output> => {
	const projectFolder = context?.projectPath ?? getProjectFolder();
	const realPath = toRealPath(file_path, projectFolder);

	const content = await fs.readFile(realPath, 'utf-8');
	const numberOfTotalLines = content.split('\n').length;

	return {
		content,
		numberOfTotalLines,
	};
};
