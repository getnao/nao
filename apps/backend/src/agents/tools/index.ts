import type { Tool } from '@ai-sdk/provider-utils';

import { mcpService } from '../../services/mcp.service';
import { sanitizeTools } from '../../utils/tools';
import displayChart from './display-chart';
import executeSql from './execute-sql';
import grep from './grep';
import list from './list';
import read from './read';
import search from './search';

export const tools = {
	display_chart: displayChart,
	execute_sql: executeSql,
	grep,
	list,
	read,
	search,
};

export const getTools = () => {
	const mcpTools = mcpService.cachedTools || {};

	const sanitizedMcpTools = Object.fromEntries(
		Object.entries(mcpTools).map(([name, tool]) => {
			const inputSchema = tool.inputSchema;

			// If it's an AI SDK schema wrapper with jsonSchema getter
			if (inputSchema && typeof inputSchema === 'object' && 'jsonSchema' in inputSchema) {
				const originalJsonSchema = inputSchema.jsonSchema;
				return [
					name,
					{
						...tool,
						inputSchema: {
							...inputSchema,
							jsonSchema: sanitizeTools(originalJsonSchema),
						},
					} as Tool,
				];
			}

			// Otherwise, sanitize the schema directly
			return [
				name,
				{
					...tool,
					inputSchema: sanitizeTools(inputSchema),
				} as Tool,
			];
		}),
	);

	return { ...tools, ...sanitizedMcpTools };
};
