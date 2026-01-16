import type { ToolDefinition } from '../_types';
import { execute } from '../functions/search';
import { description, inputSchema, outputSchema } from '../schema/search';

export default {
	name: 'search',
	description,
	inputSchema,
	outputSchema,
	execute,
} satisfies ToolDefinition<typeof inputSchema, typeof outputSchema>;
