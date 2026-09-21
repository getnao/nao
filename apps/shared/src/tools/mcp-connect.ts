import z from 'zod/v3';

export const InputSchema = z.object({
	server: z.string().describe('Name of the MCP server, matching a folder under /agent/mcps/.'),
});

export type Input = z.infer<typeof InputSchema>;
