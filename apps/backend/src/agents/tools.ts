import { tool } from 'ai';
import z from 'zod/v3';

import { execute_sql } from './tools/execute_sql';
import { grep_codebase } from './tools/grep_codebase';
import { list_directory } from './tools/list_directory';
import { read_file } from './tools/read_file';
import { search_files } from './tools/search_files';

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
			return await read_file(file_path);
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
			return await search_files(file_pattern);
		},
	}),
	list_directory: tool({
		description: 'List the contents of a directory at a given path.',
		inputSchema: z.object({
			dir_path: z.string(),
		}),
		outputSchema: z.array(
			z.object({
				path: z.string(),
				name: z.string(),
				type: z.enum(['file', 'directory', 'symbolic_link']).optional(),
				size: z.string().optional(),
			}),
		),
		execute: async ({ dir_path }) => {
			return await list_directory(dir_path);
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
		execute: async ({ ...config }) => {
			return await grep_codebase(config);
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
			return await execute_sql(query);
		},
	}),
};
