import fs from 'fs/promises';
import { glob } from 'glob';
import path from 'path';

export const search_files = async (file_pattern: string) => {
	const files = await glob(file_pattern, { absolute: true });

	return await Promise.all(
		files.map(async (absoluteFilePath) => {
			const stats = await fs.stat(absoluteFilePath);
			const relativeFilePath = path.relative(process.cwd(), absoluteFilePath);
			const relativeDirPath = path.dirname(relativeFilePath);

			return {
				absoluteFilePath,
				relativeFilePath,
				relativeDirPath,
				size: stats.size.toString(),
			};
		}),
	);
};
