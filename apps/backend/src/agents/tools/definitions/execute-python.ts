import type { ToolDefinition } from '../../../types/tools';
import { execute } from '../functions/execute-python';
import { description, inputSchema, outputSchema } from '../schema/execute-python';

export default {
	name: 'execute_python',
	description,
	inputSchema,
	outputSchema,
	execute,
} satisfies ToolDefinition<typeof inputSchema, typeof outputSchema>;
