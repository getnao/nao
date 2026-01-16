import type { ToolDefinition } from '../_types';
import { execute } from '../functions/list';
import { description, inputSchema, outputSchema } from '../schema/list';

export default {
	name: 'list',
	description,
	inputSchema,
	outputSchema,
	execute,
} satisfies ToolDefinition<typeof inputSchema, typeof outputSchema>;
