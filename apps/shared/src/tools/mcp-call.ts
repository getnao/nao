import z from 'zod/v3';

export const InputSchema = z.object({
	server: z.string().describe('Name of the MCP server, matching a folder under /agent/mcps/.'),
	tool: z.string().describe('Tool name (operationId), matching a spec file under /agent/mcps/<server>/.'),
	arguments: z
		.record(z.unknown())
		.optional()
		.describe("Arguments object matching the operation's request body schema in the spec."),
});

export type Input = z.infer<typeof InputSchema>;
