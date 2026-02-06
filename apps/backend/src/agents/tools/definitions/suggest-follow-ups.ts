import type { ToolDefinition } from '../../../types/tools';
import { execute } from '../functions/suggest-follow-ups';
import { description, inputSchema, outputSchema } from '../schema/suggest-follow-ups';

export default {
	name: 'suggest_follow_ups',
	description,
	inputSchema,
	outputSchema,
	execute,
} satisfies ToolDefinition<typeof inputSchema, typeof outputSchema>;
