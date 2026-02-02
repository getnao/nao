import type { ToolDefinition } from '../../../types/tools';
import { execute } from '../functions/read';
import { description, inputSchema, outputSchema } from '../schema/read';

export default {
	name: 'read',
	description,
	inputSchema,
	outputSchema,
	execute: (args, context) => execute(args, context),
} satisfies ToolDefinition<typeof inputSchema, typeof outputSchema>;
