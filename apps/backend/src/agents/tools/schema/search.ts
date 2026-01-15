import z from 'zod/v3';

export const description = 'Search for files matching a glob pattern within the project.';

export const inputSchema = z.object({
	pattern: z.string().describe('The pattern to search for. Can be a glob pattern.'),
});

export const outputSchema = z.array(
	z.object({
		path: z.string(),
		dir: z.string(),
		size: z.string(),
	}),
);

export type Input = z.infer<typeof inputSchema>;
export type Output = z.infer<typeof outputSchema>;
