import type { ToolDefinition } from '../../../types/tools';
import { execute } from '../functions/list';
import { description, inputSchema, outputSchema } from '../schema/list';

export default {
	name: 'list',
	description,
	inputSchema,
	outputSchema,
	execute: (args, context) => execute(args, context),
} satisfies ToolDefinition<typeof inputSchema, typeof outputSchema>;
