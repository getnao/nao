import { readdirSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

import { createTool } from './_types';

const __dirname = dirname(fileURLToPath(import.meta.url));

type ToolModule = {
	tool: ReturnType<typeof createTool>['tool'];
};

async function loadTools(): Promise<Record<string, ToolModule['tool']>> {
	const schemaDir = join(__dirname, 'schema');

	const schemaFiles = readdirSync(schemaDir).filter((f) => f.endsWith('.ts'));

	const tools: Record<string, ToolModule['tool']> = {};

	for (const file of schemaFiles) {
		const toolName = file.replace('.ts', '');
		const toolKey = toolName.replace(/-/g, '_');

		const [schema, func] = await Promise.all([
			import(`./schema/${toolName}.ts`),
			import(`./functions/${toolName}.ts`),
		]);

		const toolDef = createTool({
			name: toolKey,
			description: schema.description ?? `Tool: ${toolKey}`,
			inputSchema: schema.inputSchema,
			outputSchema: schema.outputSchema,
			execute: func.execute,
		});

		tools[toolKey] = toolDef.tool;
	}

	return tools;
}

export const tools = await loadTools();

export * as executeSqlSchemas from './schema/execute-sql';
export * as listSchemas from './schema/list';
export * as readFileSchemas from './schema/read';
export * as searchFilesSchemas from './schema/search';
