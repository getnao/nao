import type { ToolDefinition } from '../_types';
import { execute } from '../functions/execute-sql';
import { description, inputSchema, outputSchema } from '../schema/execute-sql';

export default {
	name: 'execute_sql',
	description,
	inputSchema,
	outputSchema,
	execute,
} satisfies ToolDefinition<typeof inputSchema, typeof outputSchema>;
