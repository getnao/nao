import fs from 'fs/promises';
import path from 'path';

export const list_directory = async (dir_path: string) => {
	const entries = await fs.readdir(dir_path, { withFileTypes: true });

	return await Promise.all(
		entries.map(async (entry) => {
			const fullPath = path.join(dir_path, entry.name);

			const type = entry.isDirectory()
				? 'directory'
				: entry.isFile()
					? 'file'
					: entry.isSymbolicLink()
						? 'symbolic_link'
						: undefined;
			const size = type === 'directory' ? undefined : (await fs.stat(fullPath)).size.toString();

			return {
				path: fullPath,
				name: entry.name,
				type,
				size,
			};
		}),
	);
};

// inputSchema: z.object({
// 			dir_path: z.string(),
// 		}),
// 		outputSchema: z.array(
// 			z.object({
// 				path: z.string(),
// 				name: z.string(),
// 				type: z.enum(['file', 'directory', 'symbolic_link']).optional(),
// 				size: z.string().optional(),
// 			}),
// 		),
// 		execute: async ({ dir_path }) => {
// 			return await list_directory(dir_path);
// 		},
