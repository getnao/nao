import fs from 'fs/promises';
import { glob } from 'glob';
import path from 'path';

import { PythonBridge } from '../python-bridge';
import { ToolTypes } from './types';

export const toolAgentHandler = {
	readFile: async (input: ToolTypes['read_file']['in']): Promise<ToolTypes['read_file']['out']> => {
		const { file_path } = input;

		try {
			const content = await fs.readFile(file_path, 'utf-8');
			const numberOfTotalLines = content.split('\n').length;

			return {
				content,
				numberOfTotalLines,
			};
		} catch (error) {
			throw new Error(`Error reading file at ${file_path}: ${error}`);
		}
	},

	searchFiles: async (input: ToolTypes['search_files']['in']): Promise<ToolTypes['search_files']['out']> => {
		const { file_pattern } = input;

		try {
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
		} catch (error) {
			throw new Error(`Error searching files with pattern ${file_pattern}: ${error}`);
		}
	},

	listDirectory: async (input: ToolTypes['list_directory']['in']): Promise<ToolTypes['list_directory']['out']> => {
		const { path: dirPath } = input;

		try {
			const entries = await fs.readdir(dirPath, { withFileTypes: true });

			return await Promise.all(
				entries.map(async (entry) => {
					const fullPath = path.join(dirPath, entry.name);

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
		} catch (error) {
			throw new Error(`Error listing directory at ${dirPath}: ${error}`);
		}
	},

	grepCodebase: async (input: ToolTypes['grep_codebase']['in']): Promise<ToolTypes['grep_codebase']['out']> => {
		const { pattern, include, exclude, case_sensitive } = input;

		try {
			const flags = case_sensitive ? 'g' : 'gi';
			const regex = new RegExp(pattern, flags);

			// Get all files matching include patterns and not matching exclude patterns
			const includeFiles = await Promise.all(include.map((p) => glob(p, { absolute: true })));
			const allIncludeFiles = includeFiles.flat();

			const excludeFiles =
				exclude.length > 0 ? await Promise.all(exclude.map((p) => glob(p, { absolute: true }))) : [];
			const allExcludeFiles = new Set(excludeFiles.flat());

			const filesToSearch = allIncludeFiles.filter((file) => !allExcludeFiles.has(file));

			const results: ToolTypes['grep_codebase']['out'] = [];

			for (const absolutePath of filesToSearch) {
				try {
					const content = await fs.readFile(absolutePath, 'utf-8');
					const lines = content.split('\n');
					const relativePath = path.relative(process.cwd(), absolutePath);

					lines.forEach((lineText, index) => {
						const matches = lineText.match(regex);
						if (matches) {
							results.push({
								line: index + 1,
								text: lineText,
								matchCount: matches.length,
								absolutePath,
								relativePath,
							});
						}
					});
				} catch {
					// Skip files that can't be read (e.g., binary files)
					continue;
				}
			}

			return results;
		} catch (error) {
			throw new Error(`Error grepping codebase with pattern ${pattern}: ${error}`);
		}
	},

	executeSql: async (input: ToolTypes['execute_sql']['in']): Promise<ToolTypes['execute_sql']['out']> => {
		const { sql_query: query } = input;

		const response = await fetch(`${process.env.FASTAPI_URL}/execute_sql`, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
			},
			body: JSON.stringify({
				sql: query,
				project_id: 'nao-corp',
				credentials_path: '/Users/mateolebrassancho/Downloads/nao-corp-1693265c8499.json',
			}),
		});

		if (!response.ok) {
			throw new Error(`Error executing SQL query: ${response.statusText}`);
		}

		return response.json();

		// const bq = new PythonBridge();
		// try {
		// 	const result = await bq.executeSql({
		// 		sql: query,
		// 		project_id: 'nao-corp',
		// 		credentials_path: '/Users/mateolebrassancho/Downloads/nao-corp-1693265c8499.json',
		// 	});
		// 	return result;
		// } finally {
		// 	await bq.close();
		// }
	},
};
