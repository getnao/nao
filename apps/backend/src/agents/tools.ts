import { tool } from 'ai';
import fs from 'fs/promises';
import { glob } from 'glob';
import path from 'path';
import z from 'zod/v3';

export const tools = {
	getWeather: tool({
		description: 'Get the current weather for a specified city. Use this when the user asks about weather.',
		inputSchema: z.object({
			city: z.string().describe('The city to get the weather for'),
		}),
		outputSchema: z.object({
			condition: z.string(),
			temperature: z.string(),
			humidity: z.string(),
			wind: z.string(),
		}),
		execute: async ({ city }) => {
			await new Promise((resolve) => setTimeout(resolve, 3000));
			return {
				condition: 'sunny',
				temperature: '20°C',
				humidity: '50%',
				wind: '10 km/h',
			};
		},
	}),
	read_file: tool({
		description: 'Read the contents of a file at a given path.',
		inputSchema: z.object({
			file_path: z.string(),
		}),
		outputSchema: z.object({
			content: z.string(),
			numberOfTotalLines: z.number(),
		}),
		execute: async ({ file_path }) => {
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
	}),
	search_files: tool({
		description: 'Search for files matching a specific pattern and return their paths.',
		inputSchema: z.object({
			file_pattern: z.string(),
		}),
		outputSchema: z.array(
			z.object({
				absoluteFilePath: z.string(),
				relativeFilePath: z.string(),
				relativeDirPath: z.string(),
				size: z.string().optional(),
			}),
		),
		execute: async ({ file_pattern }) => {
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
	}),
	list_directory: tool({
		description: 'List the contents of a directory at a given path.',
		inputSchema: z.object({
			path: z.string(),
		}),
		outputSchema: z.array(
			z.object({
				path: z.string(),
				name: z.string(),
				type: z.enum(['file', 'directory', 'symbolic_link']).or(z.undefined()),
				size: z.string().or(z.undefined()),
			}),
		),
		execute: async ({ path: dirPath }) => {
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
	}),
	grep_codebase: tool({
		description: 'Search the codebase for a specific pattern and return matching lines with context.',
		inputSchema: z.object({
			pattern: z.string(),
			include: z.array(z.string()),
			exclude: z.array(z.string()),
			case_sensitive: z.boolean(),
		}),
		outputSchema: z.array(
			z.object({
				line: z.number(),
				text: z.string(),
				matchCount: z.number(),
				absolutePath: z.string(),
				relativePath: z.string(),
			}),
		),
		execute: async ({ pattern, include, exclude, case_sensitive }) => {
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

				const results: Array<{
					line: number;
					text: string;
					matchCount: number;
					absolutePath: string;
					relativePath: string;
				}> = [];

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
						continue;
					}
				}

				return results;
			} catch (error) {
				throw new Error(`Error grepping codebase with pattern ${pattern}: ${error}`);
			}
		},
	}),
	execute_sql: tool({
		description: 'Execute a SQL query against the connected database and return the results.',
		inputSchema: z.object({
			sql_query: z.string(),
			connection_type: z
				.enum(['bigquery', 'snowflake', 'postgres', 'redshift', 'databricks', 'duckdb', 'athena', 'clickhouse'])
				.optional(),
		}),
		outputSchema: z.object({
			columns: z.array(z.string()),
			rows: z.array(z.any()).optional(),
		}),
		execute: async ({ sql_query: query }) => {
			const response = await fetch(`${process.env.FASTAPI_URL}/execute_sql`, {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
				},
				// TO DO : replace with only the query and get the project_id and credentials_path from cli config
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
		},
	}),
};
