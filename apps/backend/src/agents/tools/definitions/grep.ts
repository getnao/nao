import type { ToolDefinition } from '../../../types/tools';
import { execute } from '../functions/grep';
import { description, inputSchema, outputSchema } from '../schema/grep';

export default {
	name: 'grep',
	description,
	inputSchema,
	outputSchema,
	execute: (args, context) => execute(args, context),
} satisfies ToolDefinition<typeof inputSchema, typeof outputSchema>;
