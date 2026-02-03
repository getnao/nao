import type { ToolDefinition } from '../../../types/tools';
import { execute } from '../functions/display-chart';
import { description, inputSchema, outputSchema } from '../schema/display-chart';

export default {
	name: 'display_chart',
	description,
	inputSchema,
	outputSchema,
	execute: (args, _context) => execute(args, _context),
} satisfies ToolDefinition<typeof inputSchema, typeof outputSchema>;
