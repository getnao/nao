import fs from 'fs/promises';

import { getProjectFolder, toRealPath } from '../../../utils/tools';
import type { Input, Output } from '../schema/read';

export const execute = async ({ file_path }: Input): Promise<Output> => {
	const projectFolder = getProjectFolder();
	const realPath = toRealPath(file_path, projectFolder);

	const content = await fs.readFile(realPath, 'utf-8');
	const numberOfTotalLines = content.split('\n').length;

	return {
		content,
		numberOfTotalLines,
	};
};
