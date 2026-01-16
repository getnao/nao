import type { ToolDefinition } from '../_types';
import { execute } from '../functions/read';
import { description, inputSchema, outputSchema } from '../schema/read';

export default {
	name: 'read',
	description,
	inputSchema,
	outputSchema,
	execute,
} satisfies ToolDefinition<typeof inputSchema, typeof outputSchema>;
