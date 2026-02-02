import type { ToolDefinition } from '../../../types/tools';
import { execute } from '../functions/execute-sql';
import { description, inputSchema, outputSchema } from '../schema/execute-sql';

export default {
	name: 'execute_sql',
	description,
	inputSchema,
	outputSchema,
	execute: (args, context) => execute(args, context),
} satisfies ToolDefinition<typeof inputSchema, typeof outputSchema>;
