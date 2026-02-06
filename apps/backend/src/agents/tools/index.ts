import { mcpService } from '../../services/mcp.service';
import { type AnyToolDefinition, createTool } from '../../types/tools';
import displayChart from './definitions/display-chart';
import executeSql from './definitions/execute-sql';
import grep from './definitions/grep';
import list from './definitions/list';
import read from './definitions/read';
import search from './definitions/search';

const allTools: AnyToolDefinition[] = [displayChart, executeSql, grep, list, read, search];

const staticTools = Object.fromEntries(allTools.map((def) => [def.name, createTool(def).tool]));

/**
 * Sanitizes MCP tool schemas to be compatible with Anthropic SDK
 * - Ensures all array types have an items property
 * - Removes null from required arrays
 * - Recursively processes nested objects
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function sanitizeSchema(schema: any): any {
	if (!schema || typeof schema !== 'object') {
		return schema;
	}

	const sanitized = { ...schema };

	// Convert required: null to undefined
	if (sanitized.required === null) {
		delete sanitized.required;
	}

	// Ensure array types have items
	if (sanitized.type === 'array' && !sanitized.items) {
		sanitized.items = {};
	}

	// Recursively process properties
	if (sanitized.properties && typeof sanitized.properties === 'object') {
		sanitized.properties = Object.fromEntries(
			Object.entries(sanitized.properties).map(([key, value]) => {
				return [key, sanitizeSchema(value)];
			}),
		);
	}

	// Recursively process items
	if (sanitized.items) {
		sanitized.items = sanitizeSchema(sanitized.items);
	}

	// Recursively process additionalProperties
	if (sanitized.additionalProperties && typeof sanitized.additionalProperties === 'object') {
		sanitized.additionalProperties = sanitizeSchema(sanitized.additionalProperties);
	}

	return sanitized;
}

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
							jsonSchema: sanitizeSchema(originalJsonSchema),
						},
					},
				];
			}

			// Otherwise, sanitize the schema directly
			return [
				name,
				{
					...tool,
					inputSchema: sanitizeSchema(inputSchema),
				},
			];
		}),
	);

	return { ...staticTools, ...sanitizedMcpTools };
};

// Schema re-exports for external use
export * as displayChartSchemas from './schema/display-chart';
export * as executeSqlSchemas from './schema/execute-sql';
export * as grepSchemas from './schema/grep';
export * as listSchemas from './schema/list';
export * as readFileSchemas from './schema/read';
export * as searchFilesSchemas from './schema/search';
