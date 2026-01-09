import fs from 'fs/promises';

export const read_file = async (file_path: string) => {
	const content = await fs.readFile(file_path, 'utf-8');
	const numberOfTotalLines = content.split('\n').length;

	return {
		content,
		numberOfTotalLines,
	};
};
