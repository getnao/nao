import type { ToolDefinition } from '../_types';
import { execute } from '../functions/grep';
import { description, inputSchema, outputSchema } from '../schema/grep';

export default {
	name: 'grep',
	description,
	inputSchema,
	outputSchema,
	execute,
} satisfies ToolDefinition<typeof inputSchema, typeof outputSchema>;
