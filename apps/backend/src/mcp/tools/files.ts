import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

import grepTool from '../../agents/tools/grep';
import listTool from '../../agents/tools/list';
import { retrieveProjectById } from '../../queries/project.queries';
import { logger } from '../../utils/logger';
import type { McpContext } from '../logging';
import { withLogging } from '../logging';

function makeExecutionOptions(projectFolder: string) {
	const context = { projectFolder, chatId: '', agentSettings: null, envVars: {}, queryResults: new Map() };
	return { toolCallId: '', messages: [] as [], experimental_context: context };
}

export function registerFileTools(server: McpServer, ctx: McpContext): void {
	server.registerTool(
		'grep',
		{
			title: 'Search Files',
			description:
				'Search for text patterns in project files using regex. Respects .gitignore and .naoignore. Returns matching lines with file paths and line numbers.',
			inputSchema: {
				pattern: z.string().describe('The regex pattern to search for in file contents.'),
				path: z.string().optional().describe('File or directory path to search in. Defaults to project root.'),
				glob: z.string().optional().describe('Glob pattern to filter files (e.g. "*.ts", "*.{js,jsx}").'),
				case_insensitive: z.boolean().optional().describe('Case insensitive search. Defaults to false.'),
				context_lines: z.number().optional().describe('Lines of context to show around each match.'),
				max_results: z.number().optional().describe('Maximum matches to return (default 100, max 500).'),
			},
		},
		withLogging(
			'grep',
			ctx,
			async ({ pattern, path: searchPath, glob, case_insensitive, context_lines, max_results }) => {
				try {
					const project = await retrieveProjectById(ctx.projectId);
					const result = await grepTool.execute!(
						{
							pattern,
							path: searchPath,
							glob,
							case_insensitive,
							context_lines,
							max_results: Math.min(Math.max(Math.floor(max_results ?? 100), 1), 500),
						},
						makeExecutionOptions(project.path!),
					);
					return { content: [{ type: 'text' as const, text: JSON.stringify(result) }], toolOutput: result };
				} catch (error) {
					const message = error instanceof Error ? error.message : String(error);
					logger.error(`MCP grep error: ${message}`, {
						source: 'tool',
						context: { pattern, userId: ctx.userId },
					});
					return { content: [{ type: 'text' as const, text: `Search error: ${message}` }], isError: true };
				}
			},
		),
	);

	server.registerTool(
		'ls',
		{
			title: 'List Files',
			description:
				'List files and directories at the specified path within the project. Returns entry names, types, and sizes.',
			inputSchema: {
				path: z.string().optional().describe('Directory path to list. Defaults to project root ("/").'),
			},
		},
		withLogging('ls', ctx, async ({ path: filePath }) => {
			try {
				const project = await retrieveProjectById(ctx.projectId);
				const result = await listTool.execute!({ path: filePath ?? '/' }, makeExecutionOptions(project.path!));
				return { content: [{ type: 'text' as const, text: JSON.stringify(result) }], toolOutput: result };
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				logger.error(`MCP ls error: ${message}`, {
					source: 'tool',
					context: { path: filePath, userId: ctx.userId },
				});
				return { content: [{ type: 'text' as const, text: `List error: ${message}` }], isError: true };
			}
		}),
	);
}
